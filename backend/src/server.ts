import { logger } from './logger';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import path from 'path';
import { existsSync } from 'fs';
import { DB_PATH, getScryfallCache, pickUsdForFinish } from './scryfall-cache';
import { closeDb, ensureSchema } from './db';
import { promoteAdminsAtBoot } from './admin/bootstrap';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { syncRouter } from './routes/sync';
import { gamesRouter } from './routes/games';
import { gameResultsRouter } from './routes/game-results';
import { combosRouter } from './routes/combos';
import { sharesRouter } from './routes/shares';
import { createShareLandingHandler } from './shares/og';
import { offlineRouter } from './routes/offline';
import { scannerRouter } from './routes/scanner';
import { friendsRouter } from './routes/friends';
import { usersRouter } from './routes/users';
import { getMatcher } from './scanner/matcher';
import { lastSuccessfulIngestAt, runScheduledIngest } from './combos/ingest';
import {
  resolveCards,
  fetchCardsByIds,
  fetchPrintings,
  getCardById,
  fetchRulings,
} from './scryfall';
import { runScryfallBulkIngest } from './scryfall-bulk';
import { errorMessage } from './error-utils';
import { dedupePreservingOrder } from './utils';
import { getSetMap } from './sets';
import { parseImport } from './parsers';
import { resolveDeckRows } from './deck-import';
import { ImportTooLargeError, MAX_QTY_PER_ROW, MAX_TOTAL_CARDS } from './import-limits';
import {
  searchProducts,
  getProductDeck,
  getCachedCommanderSummary,
  setCachedCommanderSummary,
  type ProductCommanderSummary,
} from './products';
import { productToDeckSections, productToPhysicalRows, countPhysicalCards } from './product-map';
import { mergeCard } from './merge-card';
import type { DeckImportResponse, EnrichedCard, UploadResponse } from './types';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3737;

const app = express();
const cache = getScryfallCache();

// Trust the immediate nginx reverse-proxy so express-rate-limit uses the
// real client IP (from X-Forwarded-For) rather than the proxy's internal IP.
// Without this, express-rate-limit v7+ throws a ValidationError when it
// detects X-Forwarded-For headers without trust proxy configured, which
// closes the connection before sending a response and causes nginx to 502.
app.set('trust proxy', 1);

// This app serves both the JSON API and the static web SPA, so the CSP has
// to cover the browser app. Ported from the old frontend/nginx.conf policy
// (that nginx hop is retired now that Express serves the bundle directly).
// Kept Report-Only — the SPA has an inline theme script + blob workers (OCR)
// and pulls WASM / fonts / Scryfall imagery; observe violation reports before
// promoting to an enforcing Content-Security-Policy.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      reportOnly: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'", 'blob:', "'wasm-unsafe-eval'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'blob:', 'https://*.scryfall.io', 'https://*.scryfall.com'],
        'connect-src': [
          "'self'",
          'https://api.scryfall.com',
          'https://json.edhrec.com',
          'https://*.scryfall.io',
          'https://cdn.jsdelivr.net',
          'https://unpkg.com',
          'https://tessdata.projectnaptha.com',
        ],
        'worker-src': ["'self'", 'blob:'],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'frame-ancestors': ["'none'"],
      },
    },
    hsts: { maxAge: 31_536_000, includeSubDomains: true },
    frameguard: { action: 'deny' },
  })
);
// Permissions-Policy isn't a helmet default. Mirror nginx.conf: deny what the
// app never uses; camera stays default-allowed for the in-browser scanner.
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), payment=()');
  next();
});
app.use(cookieParser());

app.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.path.startsWith('/api/')) return next();
  const start = Date.now();
  res.on('finish', () => {
    const len = res.getHeader('content-length');
    // Strip query string — OAuth callback URLs contain the auth code.
    const url = req.originalUrl.split('?')[0];
    logger.info(
      `[req] ${req.method} ${url} ${res.statusCode} ${Date.now() - start}ms${len ? ` ${len}b` : ''}`
    );
  });
  next();
});

// 60/min because the client now splits big collection imports into chunks
// of ~500 lines (lib/api.ts). At 500/chunk this covers up to ~30k-card
// imports without users tripping the limiter mid-upload; it's still tight
// enough to throttle abusive single-IP scripting.
const importLimiter = rateLimit({ windowMs: 60_000, max: 60 });
const priceLimiter = rateLimit({ windowMs: 60_000, max: 30 });
const productLimiter = rateLimit({ windowMs: 60_000, max: 60 });

/** Scryfall card UUID — validates the :id path param on the rulings route. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Kept ABOVE the sync snapshot cap (MAX_SNAPSHOT_BYTES, 64MB) so an oversize
// collection is rejected by the sync route with a friendly, actionable message
// rather than a raw body-parser 413.
app.use(express.json({ limit: '72mb' }));

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/sync', syncRouter);
app.use('/api/games', gamesRouter);
app.use('/api/game-results', gameResultsRouter);
app.use('/api/combos', combosRouter);
app.use('/api/shares', sharesRouter);
app.use('/api/offline', offlineRouter);
app.use('/api/scanner', scannerRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/users', usersRouter);

/**
 * One-time backfill: resolve printing IDs (scryfallId) → oracle IDs from the
 * existing Scryfall cache. Lets clients with old EnrichedCards (saved before
 * we started persisting oracleId) join against the combo dataset without a
 * full re-import. Capped at 1000 ids per call.
 */
app.post('/api/cards/oracle-ids', priceLimiter, (req: Request, res: Response) => {
  const raw = (req.body && (req.body as { scryfallIds?: unknown }).scryfallIds) as unknown;
  if (!Array.isArray(raw)) {
    return res.status(400).json({ error: 'Body must be { scryfallIds: string[] }.' });
  }
  const ids = Array.from(
    new Set(raw.filter((x): x is string => typeof x === 'string' && x.length > 0))
  ).slice(0, 1000);
  const cached = cache.getMany(ids);
  const oracleIds: Record<string, string> = {};
  for (const id of ids) {
    const card = cached.get(id);
    if (card?.oracle_id) oracleIds[id] = card.oracle_id;
  }
  res.json({ oracleIds });
});

/**
 * Returns Scryfall rulings for a card by Scryfall UUID, cached in SQLite with a 7-day TTL.
 * - 200 { rulings: Ruling[] } on success (empty array if card has no rulings or Scryfall 404)
 * - 400 if :id is not a plausible Scryfall UUID
 * - 502/500 on upstream/transient failure
 */
app.get(
  '/api/cards/:id/rulings',
  rateLimit({ windowMs: 60_000, max: 60 }),
  async (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    if (!UUID_RE.test(id)) {
      return res.status(400).json({ error: 'id must be a Scryfall UUID' });
    }

    const cached = cache.getRulings(id);
    if (cached !== null) {
      return res.json({ rulings: cached });
    }

    try {
      const rulings = await fetchRulings(id);
      cache.setRulings(id, rulings);
      res.json({ rulings });
    } catch (err) {
      logger.error('[rulings] fetch failed:', err);
      const message = errorMessage(err);
      res.status(502).json({ error: `Failed to fetch rulings: ${message}` });
    }
  }
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, cache: cache.stats() });
});

/**
 * Digital Asset Links statement for the Android App Link that returns the
 * Google OAuth callback into the installed APK. Android fetches this on
 * install (and periodically) and verifies the SHA-256 fingerprints listed
 * here against the APK's signing cert before the `autoVerify` intent
 * filter is allowed to claim https://spellcontrol.com/oauth/callback URLs.
 *
 * Set `ANDROID_APP_FINGERPRINTS` to a comma-separated list of fingerprints
 * (debug + release). Hex bytes may be upper- or lower-case, with or
 * without colon separators — we normalize to the colon-separated upper
 * form Google's tooling emits. If the env is unset the endpoint returns
 * 404 so an unconfigured deployment doesn't advertise a half-broken
 * statement (matches the opt-in shape of the `GOOGLE_*` SSO env).
 */
app.get('/.well-known/assetlinks.json', (_req: Request, res: Response) => {
  const raw = process.env.ANDROID_APP_FINGERPRINTS;
  if (!raw) return res.status(404).json({ error: 'Not configured.' });
  const fingerprints = raw
    .split(',')
    .map((f) =>
      f
        .trim()
        .replace(/[^0-9a-fA-F]/g, '')
        .toUpperCase()
    )
    .filter((f) => f.length === 64)
    .map((f) => f.match(/.{2}/g)!.join(':'));
  if (fingerprints.length === 0) {
    return res.status(404).json({ error: 'Not configured.' });
  }
  res.type('application/json').json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.spellcontrol.app',
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ]);
});

app.get('/api/sets', async (_req: Request, res: Response) => {
  try {
    const sets = await getSetMap();
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ sets });
  } catch (err) {
    logger.error('[sets] fetch failed:', err);
    res.status(502).json({ error: 'Failed to fetch set list from Scryfall.' });
  }
});

/**
 * Searches the MTGJSON preconstructed-product catalog (T17). `q` matches product
 * names; `type` is a comma-separated MTGJSON type filter (e.g. "Commander Deck").
 */
app.get('/api/products', productLimiter, async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const typeParam = req.query.type;
    const types =
      typeof typeParam === 'string' && typeParam.trim()
        ? typeParam.split(',').map((t) => t.trim())
        : undefined;
    const products = await searchProducts(q, { types });
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ products });
  } catch (err) {
    logger.error('[products] search failed:', err);
    res.status(502).json({ error: 'Failed to fetch product list from MTGJSON.' });
  }
});

/**
 * Resolves a single product's decklist into the import shape. Returns the
 * playable deck (commander + 99, ready for the deck-import flow) plus `extras`
 * — the physical cards that ship in the box but aren't part of the 100
 * (display/etched commanders, tokens, sideboard) — for the collection-add path.
 */
app.get('/api/products/:fileName', productLimiter, async (req: Request, res: Response) => {
  try {
    const fileName = String(req.params.fileName ?? '');
    const deckFile = await getProductDeck(fileName);
    if (!deckFile) {
      return res
        .status(404)
        .json({ error: 'Product not found. Newly released products may not be catalogued yet.' });
    }

    // Playable deck (commander + 99) for "add as a deck".
    const { commanderRows, companionRows, deckRows } = productToDeckSections(deckFile);
    const sections = await resolveDeckRows(commanderRows, companionRows, deckRows, cache);

    const deck: DeckImportResponse = {
      commander: sections.commander,
      companion: sections.companion,
      cards: sections.cards,
      unresolvedNames: dedupePreservingOrder(sections.unresolvedNames),
      // Precons carry a commander zone → default the import dialog to Commander.
      detectedFormat: commanderRows.length > 0 ? 'commander' : '',
      cardCount:
        sections.cards.length + (sections.commander ? 1 : 0) + (sections.companion ? 1 : 0),
    };

    // Every physical card across every zone (finish-accurate) for "add to the
    // collection" — includes the display/etched commanders + tokens the deck omits.
    const physicalRows = productToPhysicalRows(deckFile);
    const physicalResolved = await resolveCards(physicalRows, cache);
    const physicalCards = physicalRows
      .map((row, i) => {
        const card = physicalResolved.resolved[i];
        if (!card) return null;
        return {
          card,
          quantity: Math.max(1, row.quantity || 1),
          finish: row.finish ?? 'nonfoil',
          zone: row.sourceCategory ?? 'mainBoard',
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    res.set('Cache-Control', 'public, max-age=3600');
    res.json({
      product: {
        fileName,
        code: deckFile.code,
        name: deckFile.name,
        type: deckFile.type,
        releaseDate: deckFile.releaseDate ?? '',
      },
      deck,
      physicalCards,
      unresolvedNames: dedupePreservingOrder(physicalResolved.unresolvedNames),
      physicalCardCount: countPhysicalCards(deckFile),
    });
  } catch (err) {
    if (err instanceof ImportTooLargeError) {
      return res.status(413).json({ error: err.message });
    }
    logger.error('[products] resolve failed:', err);
    res.status(502).json({ error: 'Failed to resolve product decklist.' });
  }
});

/**
 * Compact commander preview for a product — name + color identity + small image
 * — for lazy enrichment of the product search rows (T17). Resolves only the
 * commander (not the whole deck), and caches the tiny result long-lived so a
 * scroll/re-search is instant. Returns `{ commander: null }` for products with
 * no commander zone (non-commander products).
 */
app.get('/api/products/:fileName/summary', productLimiter, async (req: Request, res: Response) => {
  try {
    const fileName = String(req.params.fileName ?? '');
    const cached = getCachedCommanderSummary(fileName);
    if (cached !== undefined) {
      res.set('Cache-Control', 'public, max-age=86400');
      return res.json({ commander: cached });
    }

    const deckFile = await getProductDeck(fileName);
    if (!deckFile) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    const { commanderRows } = productToDeckSections(deckFile);
    let summary: ProductCommanderSummary | null = null;
    if (commanderRows.length > 0) {
      const resolved = await resolveCards([commanderRows[0]], cache);
      const card = resolved.resolved[0];
      if (card) {
        summary = {
          name: card.name,
          colorIdentity: card.color_identity ?? [],
          // Full small card image — rendered as a card-shaped row thumbnail,
          // matching the deck list. Fall back to the front face for DFC commanders.
          image: card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small ?? null,
        };
      }
    }
    setCachedCommanderSummary(fileName, summary);
    res.set('Cache-Control', 'public, max-age=86400');
    res.json({ commander: summary });
  } catch (err) {
    logger.error('[products] summary failed:', err);
    res.status(502).json({ error: 'Failed to resolve product summary.' });
  }
});

/**
 * Unified import endpoint. Accepts either:
 *   - multipart/form-data with field "file" (CSV/TSV/text)
 *   - application/json with { text: string }
 *
 * Auto-detects format (ManaBox, Archidekt, Moxfield, generic CSV, MTGA, plain text)
 * and resolves cards via Scryfall by ID, name+set+collector, or name as available.
 */
app.post(
  '/api/import',
  importLimiter,
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const text = await readImportText(req);
      if (!text) {
        return res
          .status(400)
          .json({ error: 'Provide either a file (multipart) or JSON body { text: string }' });
      }

      const parseResult = parseImport(text);
      if (parseResult.rows.length === 0) {
        return res.status(400).json({
          error:
            'No cards found in the input. Try uploading a CSV from a supported tool, or pasting card names one per line.',
        });
      }

      // Resolve the parsed (unexpanded) rows: resolveCards dedupes by identifier
      // anyway, so quantity has no bearing on the network calls. Expanding only
      // afterward — during the merge — avoids materializing a second, potentially
      // huge ImportRow[] just to throw it away (a 2000-copy row would otherwise be
      // 2000 duplicate objects before dedup collapsed them again).
      const { resolved, unresolvedNames } = await resolveCards(parseResult.rows, cache);

      let hits = 0;
      let misses = 0;
      let total = 0;
      const cards: EnrichedCard[] = [];
      parseResult.rows.forEach((row, i) => {
        const sCard = resolved[i];
        const qty = Math.min(MAX_QTY_PER_ROW, Math.max(1, row.quantity || 1));
        for (let q = 0; q < qty; q++) {
          if (total >= MAX_TOTAL_CARDS) {
            throw new ImportTooLargeError(
              `Import exceeds the ${MAX_TOTAL_CARDS.toLocaleString()}-card limit. ` +
                `Split it into smaller files.`
            );
          }
          total++;
          if (sCard) hits++;
          else misses++;
          cards.push(mergeCard(row, sCard));
        }
      });

      const response: UploadResponse = {
        cards,
        totalRows: total,
        scryfallHits: hits,
        scryfallMisses: misses,
        unresolvedNames: dedupePreservingOrder(unresolvedNames),
        detectedFormat: parseResult.format,
      };

      res.json(response);
    } catch (err) {
      if (err instanceof ImportTooLargeError) {
        return res.status(413).json({ error: err.message });
      }
      logger.error('[import] error:', err);
      const message = errorMessage(err);
      res.status(500).json({
        error: `Import failed: ${message}. Please check your file format and try again.`,
      });
    }
  }
);

/**
 * Deck-oriented import endpoint. Parses the same formats as /api/import but
 * returns ScryfallCard objects grouped by section (commander / companion / deck).
 * Text-format section headers ("Commander", "Companion", "Sideboard", "Deck")
 * are used to auto-detect the commander when present.
 */
app.post(
  '/api/import-deck',
  importLimiter,
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const text = await readImportText(req);
      if (!text) {
        return res
          .status(400)
          .json({ error: 'Provide either a file (multipart) or JSON body { text: string }' });
      }

      const parseResult = parseImport(text);
      if (parseResult.rows.length === 0) {
        return res.status(400).json({
          error:
            'No cards found in the input. Paste a deck list with one card per line, or upload an export file.',
        });
      }

      const commanderRows = parseResult.rows.filter((r) => r.section === 'commander');
      const companionRows = parseResult.rows.filter((r) => r.section === 'companion');
      const deckRows = parseResult.rows.filter(
        (r) =>
          r.section !== 'commander' &&
          r.section !== 'companion' &&
          r.section !== 'sideboard' &&
          r.section !== 'maybeboard'
      );

      // Resolve each expanded row independently so distinct printings of the
      // same name (e.g. Plains FDN #272 vs FDN #282) stay distinct in the deck.
      // Two-pass resolution (collectorNumber fallback) lives in resolveDeckRows,
      // shared with the MTGJSON product import path.
      const sections = await resolveDeckRows(commanderRows, companionRows, deckRows, cache);

      const response: DeckImportResponse = {
        commander: sections.commander,
        companion: sections.companion,
        cards: sections.cards,
        unresolvedNames: dedupePreservingOrder(sections.unresolvedNames),
        detectedFormat: parseResult.format,
        cardCount:
          sections.cards.length + (sections.commander ? 1 : 0) + (sections.companion ? 1 : 0),
      };

      res.json(response);
    } catch (err) {
      if (err instanceof ImportTooLargeError) {
        return res.status(413).json({ error: err.message });
      }
      logger.error('[import-deck] error:', err);
      const message = errorMessage(err);
      res.status(500).json({
        error: `Deck import failed: ${message}. Please check the format and try again.`,
      });
    }
  }
);

/**
 * Refreshes Scryfall market prices for a set of cards without re-importing.
 * Body: { scryfallIds: string[] } (capped at 1000).
 * Response: { prices: Record<scryfallId, { usd: number, pricedAt: number }> }
 *
 * Only resolved ids appear in the response. The frontend treats absent ids as
 * "still no price" rather than zeroing them out. Foil-vs-non-foil disambiguation
 * is intentionally skipped — the response gives a single usd per id, and the
 * frontend stamps it on every copy of that printing.
 */
/**
 * Fetches all printings of a card by name from Scryfall. Returns full
 * ScryfallCard objects so the frontend can show set, images, prices, and
 * finishes for each printing. Caches results in the existing SQLite layer.
 */
app.get(
  '/api/cards/:name/printings',
  rateLimit({ windowMs: 60_000, max: 60 }),
  async (req: Request, res: Response) => {
    try {
      const rawName = req.params.name;
      const cardName = decodeURIComponent(
        typeof rawName === 'string' ? rawName : rawName[0]
      ).trim();
      if (!cardName) {
        return res.status(400).json({ error: 'Card name is required.' });
      }

      const setParam = typeof req.query.set === 'string' ? req.query.set : undefined;
      const cards = await fetchPrintings(cardName, setParam);
      if (cards.length > 0) {
        cache.setMany(cards);
      }

      res.json({ printings: cards });
    } catch (err) {
      logger.error('[printings] error:', err);
      const message = errorMessage(err);
      res.status(500).json({ error: `Failed to fetch printings: ${message}` });
    }
  }
);

/**
 * Single-card fetch by Scryfall id. Used by the v2 camera scanner: the
 * on-device matcher resolves a Scryfall UUID per scan, and the frontend
 * needs the full card payload (name, image, prices) to render. Cache-first
 * via {@link getCardById} so a rapid scanning session doesn't hammer
 * Scryfall.
 *
 * Response: { card: ScryfallCard | null }. `null` means Scryfall doesn't
 * know the id (or returned an error).
 */
app.get(
  '/api/cards/by-id/:id',
  rateLimit({ windowMs: 60_000, max: 240 }),
  async (req: Request, res: Response) => {
    try {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return res.status(400).json({ error: 'id must be a Scryfall UUID' });
      }
      const card = await getCardById(id, cache);
      res.json({ card });
    } catch (err) {
      logger.error('[cards/by-id] error:', err);
      const message = errorMessage(err);
      res.status(500).json({ error: `by-id lookup failed: ${message}` });
    }
  }
);

app.post('/api/refresh-prices', priceLimiter, async (req: Request, res: Response) => {
  try {
    const raw = (req.body && (req.body as { scryfallIds?: unknown }).scryfallIds) as unknown;
    if (!Array.isArray(raw)) {
      return res.status(400).json({ error: 'Body must be { scryfallIds: string[] }.' });
    }

    const ids = Array.from(
      new Set(raw.filter((x): x is string => typeof x === 'string' && x.length > 0))
    ).slice(0, 1000);

    if (ids.length === 0) {
      return res.json({ prices: {} });
    }

    const cards = await fetchCardsByIds(ids, cache);

    const now = Date.now();
    // Return the price for EACH finish (the client picks the one matching the
    // owned copy). The request is per-printing (scryfallId) and finish-agnostic
    // because a single printing serves nonfoil + foil + etched copies; sending
    // all three avoids a foil silently showing the non-foil price. `usd` is the
    // non-foil baseline; a client that ignores the foil fields degrades to the
    // old behaviour. Emit an entry if ANY finish has a price.
    const prices: Record<
      string,
      { usd: number; usdFoil: number; usdEtched: number; pricedAt: number }
    > = {};
    for (const card of cards) {
      const usd = pickUsdForFinish(card, 'nonfoil');
      const usdFoil = pickUsdForFinish(card, 'foil');
      const usdEtched = pickUsdForFinish(card, 'etched');
      if (usd > 0 || usdFoil > 0 || usdEtched > 0) {
        prices[card.id] = { usd, usdFoil, usdEtched, pricedAt: now };
      }
    }

    res.json({ prices });
  } catch (err) {
    logger.error('[refresh-prices] error:', err);
    const message = errorMessage(err);
    res.status(500).json({ error: `Price refresh failed: ${message}.` });
  }
});

/**
 * Picks a single usd value from a Scryfall card's price block. Prefers the
 * non-foil price, falling back to etched then foil. Mirrors the non-foil branch
 * of resolvePrice — refresh does not know each row's foil flag, so we pick a
 * sensible single value and stamp it on every copy of the printing.
 */
/**
 * Pulls the import text from whichever request shape was sent.
 */
/**
 * Rejects inputs with more lines than any real collection could have BEFORE
 * the parser builds a row object per line. Every parser is line-oriented, so a
 * 20MB file of single-character lines (~10M lines) would otherwise allocate
 * ~10M ImportRow objects in a 256MB container. Counted with an early-exiting
 * loop so the guard itself can't be turned into the bomb.
 */
function assertLineCountWithinLimit(text: string): void {
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      if (++lines > MAX_TOTAL_CARDS) {
        throw new ImportTooLargeError(
          `Import has too many lines (limit ${MAX_TOTAL_CARDS.toLocaleString()}). ` +
            `Split it into smaller files.`
        );
      }
    }
  }
}

async function readImportText(req: Request): Promise<string | null> {
  if (req.file) {
    const text = req.file.buffer.toString('utf-8');
    assertLineCountWithinLimit(text);
    return text;
  }
  if (req.body && typeof req.body.text === 'string' && req.body.text.trim()) {
    assertLineCountWithinLimit(req.body.text);
    return req.body.text;
  }
  return null;
}

/**
 * Serve the built web SPA. The Dockerfile copies `frontend/dist` to
 * `backend/public`; in local dev / tests that directory doesn't exist (Vite
 * serves the frontend on its own port), so the whole block is skipped and the
 * backend stays API-only. Registered AFTER every /api route so nothing here
 * can shadow the API, and before the error handler so it stays last.
 */
const SPA_DIR = path.join(__dirname, '..', 'public');
if (existsSync(SPA_DIR)) {
  // Share-landing routes need to render before the SPA static handler so
  // we can inject per-share OG/Twitter meta + a robots:noindex into the
  // shell. Scrapers (Discord/Slack/iMessage/Twitter) don't run JS, so
  // adding these from React at runtime wouldn't reach them. Registered
  // before express.static so the dynamic response wins over the static
  // index.html, but after every /api/* route so nothing here can shadow
  // the API surface.
  app.get('/s/:token', createShareLandingHandler(SPA_DIR));

  app.use(
    express.static(SPA_DIR, {
      setHeaders: (res, filePath) => {
        // Hashed asset filenames are content-addressed → cache forever.
        // index.html must always revalidate so a deploy's new bundle lands.
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    })
  );
  // SPA history fallback: any GET that didn't match a static file or an /api
  // route gets index.html, so client-side routes (/decks, /collection, …)
  // and hard refreshes deep-link correctly. /api/* misses fall through to a
  // 404. /s/:token is handled above, before the static layer.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(SPA_DIR, 'index.html'));
  });
}

app.use((err: Error, _req: Request, res: Response, _next: unknown) => {
  if ((err as NodeJS.ErrnoException & { code?: string }).code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File is too large. Maximum size is 20 MB.' });
    return;
  }
  logger.error('[server] unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong on the server. Try again in a moment.' });
});

/**
 * Kicks off the combo dataset refresh. Skips when a successful run finished
 * within the last 20h so a redeploy doesn't immediately repull the bulk feed.
 * Schedules the next attempt 24h out — the dataset is small enough that a
 * single setInterval is sufficient; no queue or external scheduler needed.
 */
function scheduleComboIngest(): void {
  const TWENTY_HOURS = 20 * 60 * 60 * 1000;
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  const tick = async () => {
    try {
      const lastAt = await lastSuccessfulIngestAt();
      if (lastAt && Date.now() - lastAt < TWENTY_HOURS) {
        logger.info('[combos] skipping ingest — last successful run was recent');
      } else {
        await runScheduledIngest();
      }
    } catch (err) {
      logger.error('[combos] schedule tick failed:', err);
    }
  };

  // Fire once on boot (gated by lastAt), then every 24h.
  void tick();
  setInterval(() => void tick(), TWENTY_FOUR_HOURS);
}

/**
 * Kicks off the Scryfall bulk-card refresh: pulls the daily `default_cards` dump
 * into the SQLite cache so imports resolve locally. Like the combo schedule it's
 * a single setInterval — the ingest's own meta-file recency guard skips a re-pull
 * when a redeploy lands within 20h of the last run. Runs in the background so the
 * first ingest (a few minutes streaming ~450MB) never blocks boot; until it
 * finishes, imports fall back to the live Scryfall path as before.
 */
function scheduleScryfallBulkIngest(): void {
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  const tick = () => {
    runScryfallBulkIngest(cache, DB_PATH).catch((err) => {
      logger.error('[scryfall-bulk] schedule tick failed:', err);
    });
  };
  tick();
  setInterval(tick, TWENTY_FOUR_HOURS);
}

async function start() {
  await ensureSchema();
  await promoteAdminsAtBoot();
  const server = app.listen(PORT, () => {
    logger.info(`[server] listening on http://localhost:${PORT}`);
    logger.info(`[server] cache db: ${DB_PATH}`);
    logger.info(`[server] cache stats:`, cache.stats());
  });

  if (process.env.COMBOS_INGEST_DISABLED !== '1') {
    scheduleComboIngest();
  }

  if (process.env.SCRYFALL_BULK_INGEST_DISABLED !== '1') {
    scheduleScryfallBulkIngest();
  }

  // Eagerly load the scanner matcher (pHash + embedding DBs + ONNX session) so
  // a deploy with missing data files surfaces here at boot rather than on the
  // first user scan. Fire-and-forget — the route handler still awaits
  // `getMatcher()` on every request, so listening doesn't have to block on
  // the ~1s ONNX session create. A `null` resolve means the data files aren't
  // present (logged inside `getMatcher`); a rejection is unexpected and gets
  // surfaced loudly so monitoring can catch it.
  if (process.env.SCANNER_PRELOAD_DISABLED !== '1') {
    const dataDir =
      process.env.SCANNER_DATA_DIR || path.resolve(__dirname, '..', 'data', 'scanner');
    void getMatcher(dataDir).then(
      (matcher) => {
        if (matcher) {
          const { hashDb, embeddingDb } = matcher.stats();
          logger.info(
            `[server] scanner matcher preloaded — hashes=${hashDb}, embeddings=${embeddingDb}`
          );
        }
      },
      (err) => logger.error('[server] scanner matcher preload failed:', err)
    );
  }

  // The Scryfall oracle bulk is built lazily on the first request to
  // /api/offline/oracle-cards (the route returns 503 + Retry-After while it
  // streams in). The daily refresh interval is armed automatically by
  // bulk-cache after that first successful build, so there's no boot-time
  // hook here. Set OFFLINE_BULK_DISABLED=1 to opt out of the daily refresh.

  function shutdown() {
    logger.info('\n[server] shutting down...');
    server.closeAllConnections();
    server.close(async () => {
      // Guard the async close: an unawaited rejection here (e.g. closeDb throws)
      // would become an unhandled rejection and crash instead of exiting cleanly.
      try {
        cache.close();
        await closeDb();
        process.exit(0);
      } catch (err) {
        logger.error('[server] error during shutdown:', err);
        process.exit(1);
      }
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  logger.error('[server] failed to start:', err);
  process.exit(1);
});
