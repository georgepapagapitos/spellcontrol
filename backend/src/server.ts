import { logger } from './logger';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import path from 'path';
import { existsSync } from 'fs';
import { ScryfallCache } from './cache';
import { closeDb, ensureSchema } from './db';
import { promoteAdminsAtBoot } from './admin/bootstrap';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { syncRouter } from './routes/sync';
import { gamesRouter } from './routes/games';
import { combosRouter } from './routes/combos';
import { sharesRouter } from './routes/shares';
import { createShareLandingHandler } from './shares/og';
import { offlineRouter } from './routes/offline';
import { lastSuccessfulIngestAt, runScheduledIngest } from './combos/ingest';
import {
  resolveCards,
  fetchCardsByIds,
  fetchPrintings,
  identifyCardByName,
  getCardBySetAndNumber,
} from './scryfall';
import { getSetMap } from './sets';
import { parseImport } from './parsers';
import { sliceResolvedDeckImport } from './deck-import';
import { mergeCard } from './merge-card';
import type { ImportRow } from './parsers/types';
import type { DeckImportResponse, EnrichedCard, ScryfallCard, UploadResponse } from './types';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3737;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'scryfall-cache.db');

const app = express();
const cache = new ScryfallCache(DB_PATH);

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

const importLimiter = rateLimit({ windowMs: 60_000, max: 20 });
const priceLimiter = rateLimit({ windowMs: 60_000, max: 30 });

// Kept ABOVE the sync snapshot cap (MAX_SNAPSHOT_BYTES, 64MB) so an oversize
// collection is rejected by the sync route with a friendly, actionable message
// rather than a raw body-parser 413.
app.use(express.json({ limit: '72mb' }));

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/sync', syncRouter);
app.use('/api/games', gamesRouter);
app.use('/api/combos', combosRouter);
app.use('/api/shares', sharesRouter);
app.use('/api/offline', offlineRouter);

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

      const expanded = expandByQuantity(parseResult.rows);
      const { resolved, unresolvedNames } = await resolveCards(expanded, cache);

      let hits = 0;
      let misses = 0;
      const cards: EnrichedCard[] = expanded.map((row, i) => {
        const sCard = resolved[i];
        if (sCard) hits++;
        else misses++;
        return mergeCard(row, sCard);
      });

      const response: UploadResponse = {
        cards,
        totalRows: expanded.length,
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
      const message = err instanceof Error ? err.message : 'Unknown error';
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
      // The previous implementation collapsed by (name, setCode), losing
      // printing precision on basic lands and any same-set multi-printing card.
      //
      // Two-pass resolution: first try with all the row's info (scryfallId or
      // name+set+collector). For any row that didn't resolve AND originally had
      // a collectorNumber, retry without it — some deck-builder exports use
      // collector numbers Scryfall doesn't recognize for the exact printing the
      // user owns; falling back to name+set lets us still produce a card.
      const allRows = [...commanderRows, ...companionRows, ...deckRows];
      const expanded = expandByQuantity(allRows);
      const firstPass = await resolveCards(expanded, cache);
      const resolved = firstPass.resolved;

      const retryIdxs: number[] = [];
      resolved.forEach((card, i) => {
        if (!card && expanded[i].collectorNumber) retryIdxs.push(i);
      });
      if (retryIdxs.length > 0) {
        const retryRows = retryIdxs.map((i) => ({ ...expanded[i], collectorNumber: undefined }));
        const retry = await resolveCards(retryRows, cache);
        retryIdxs.forEach((origIdx, j) => {
          if (retry.resolved[j]) resolved[origIdx] = retry.resolved[j];
        });
      }
      const sections = sliceResolvedDeckImport(commanderRows, companionRows, deckRows, resolved);

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
      const message = err instanceof Error ? err.message : 'Unknown error';
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

      const cards = await fetchPrintings(cardName);
      if (cards.length > 0) {
        cache.setMany(cards);
      }

      res.json({ printings: cards });
    } catch (err) {
      logger.error('[printings] error:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: `Failed to fetch printings: ${message}` });
    }
  }
);

/**
 * Identifies a single card from an imperfect name (OCR output, partial input).
 * Used by the in-browser card scanner — the frontend OCRs the card's title
 * region with Tesseract and posts the result here for fuzzy resolution.
 *
 * Query: `?q=arcane+signet` (raw OCR text is fine; Scryfall's fuzzy matcher
 * tolerates typos, missing apostrophes, partial names, etc.).
 *
 * Response: { card: ScryfallCard | null }. A null `card` means no confident
 * match — the caller should treat that as "try again" rather than an error.
 */
app.get(
  '/api/cards/identify',
  rateLimit({ windowMs: 60_000, max: 120 }),
  async (req: Request, res: Response) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      if (!q.trim()) {
        return res.status(400).json({ error: 'Query parameter "q" is required.' });
      }
      const card = await identifyCardByName(q);
      if (card) cache.setMany([card]);
      res.json({ card });
    } catch (err) {
      logger.error('[identify] error:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: `Identify failed: ${message}` });
    }
  }
);

/**
 * Resolves a card to its *exact* printing from a set code + collector
 * number. Used by the scanner's bottom-strip OCR path: once OCR reads
 * both fields off the physical card, this returns the one specific
 * printing instead of letting fuzzy-named pick whatever Scryfall thinks
 * is canonical for the name. The path is distinct from
 * `/api/cards/:name/printings` to avoid the route-matcher mistaking a
 * set code for a card name.
 *
 * Returns { card: ScryfallCard | null }. A null `card` means Scryfall
 * doesn't recognise the set+number combo — the caller should fall back
 * to the fuzzy-named path on the same scan.
 */
app.get(
  '/api/cards/by-set/:set/:number',
  rateLimit({ windowMs: 60_000, max: 120 }),
  async (req: Request, res: Response) => {
    try {
      const set = typeof req.params.set === 'string' ? req.params.set : '';
      const number = typeof req.params.number === 'string' ? req.params.number : '';
      if (!set.trim() || !number.trim()) {
        return res.status(400).json({ error: 'Both set and number params are required.' });
      }
      const card = await getCardBySetAndNumber(set, number);
      if (card) cache.setMany([card]);
      res.json({ card });
    } catch (err) {
      logger.error('[by-set] error:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: `Lookup failed: ${message}` });
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
    const prices: Record<string, { usd: number; pricedAt: number }> = {};
    for (const card of cards) {
      const usd = pickUsdFromPrices(card);
      if (usd > 0) {
        prices[card.id] = { usd, pricedAt: now };
      }
    }

    res.json({ prices });
  } catch (err) {
    logger.error('[refresh-prices] error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: `Price refresh failed: ${message}.` });
  }
});

/**
 * Picks a single usd value from a Scryfall card's price block. Prefers the
 * non-foil price, falling back to etched then foil. Mirrors the non-foil branch
 * of resolvePrice — refresh does not know each row's foil flag, so we pick a
 * sensible single value and stamp it on every copy of the printing.
 */
function pickUsdFromPrices(card: ScryfallCard): number {
  const p = card.prices;
  if (!p) return 0;
  for (const raw of [p.usd, p.usd_etched, p.usd_foil]) {
    if (!raw) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

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
 * Caps for the import expansion step. Parsers `parseInt()` the quantity field
 * with no upper bound, so a tiny payload (`Sol Ring,2000000000`) would
 * otherwise expand into a multi-billion-element array and OOM the container —
 * a content-level amplification bomb that no byte-size limit can catch.
 *
 * MAX_QTY_PER_ROW: nobody legitimately owns >2000 copies of one card (a
 * playset is 4; even bulk basics top out in the hundreds).
 * MAX_TOTAL_CARDS: ~90k unique printings exist in all of Magic; the largest
 * realistic single collection is well under 200k physical cards.
 */
const MAX_QTY_PER_ROW = 2000;
const MAX_TOTAL_CARDS = 200_000;

export class ImportTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportTooLargeError';
  }
}

function expandByQuantity(rows: ImportRow[]): ImportRow[] {
  const expanded: ImportRow[] = [];
  for (const row of rows) {
    const qty = Math.min(MAX_QTY_PER_ROW, Math.max(1, row.quantity || 1));
    for (let i = 0; i < qty; i++) {
      if (expanded.length >= MAX_TOTAL_CARDS) {
        throw new ImportTooLargeError(
          `Import exceeds the ${MAX_TOTAL_CARDS.toLocaleString()}-card limit. ` +
            `Split it into smaller files.`
        );
      }
      expanded.push(row);
    }
  }
  return expanded;
}

function dedupePreservingOrder<T>(arr: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
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

  // The Scryfall oracle bulk is built lazily on the first request to
  // /api/offline/oracle-cards (the route returns 503 + Retry-After while it
  // streams in). The daily refresh interval is armed automatically by
  // bulk-cache after that first successful build, so there's no boot-time
  // hook here. Set OFFLINE_BULK_DISABLED=1 to opt out of the daily refresh.

  function shutdown() {
    logger.info('\n[server] shutting down...');
    server.closeAllConnections();
    server.close(async () => {
      cache.close();
      await closeDb();
      process.exit(0);
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  logger.error('[server] failed to start:', err);
  process.exit(1);
});
