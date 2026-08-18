import { logger } from './logger';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import multer from 'multer';
import path from 'path';
import { Worker } from 'node:worker_threads';
import { existsSync } from 'fs';
import { gzip } from 'node:zlib';
import { DB_PATH, getScryfallCache, pickEurForFinish, pickUsdForFinish } from './scryfall-cache';
import { resolveOracleFacts, ORACLE_REQUEST_LIMIT, type OracleRequest } from './oracle-facts';
import { closeDb, ensureSchema } from './db';
import { testAwareLimiter } from './route-utils';
import { parseMarkAllAsProxies } from './import-proxy-flag';
import { fetchImportLink, ImportLinkError } from './import-link';
import { promoteAdminsAtBoot } from './admin/bootstrap';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { syncRouter } from './routes/sync';
import { gamesRouter } from './routes/games';
import { gameResultsRouter } from './routes/game-results';
import { combosRouter } from './routes/combos';
import { aggregatesRouter } from './routes/aggregates';
import { sharesRouter } from './routes/shares';
import { feedbackRouter } from './routes/feedback';
import { createShareLandingHandler } from './shares/og';
import { offlineRouter } from './routes/offline';
import { scannerRouter } from './routes/scanner';
import { friendsRouter } from './routes/friends';
import { usersRouter } from './routes/users';
import {
  gameNightsRouter,
  lookupGameNightLandingMeta,
  lookupGameNightSeriesLandingMeta,
} from './routes/game-nights';
import { podsRouter } from './routes/pods';
import { podStatsRouter } from './routes/pod-stats';
import { tonightTradesRouter } from './routes/tonight-trades';
import { tradesRouter } from './routes/trades';
import { publicationsRouter } from './routes/publications';
import {
  publicRouter,
  lookupPublicDeckLandingMeta,
  lookupPublicUserLandingMeta,
} from './routes/public';
import { reportsRouter } from './routes/reports';
import { discoverRouter } from './routes/discover';
import { activityRouter } from './routes/activity';
import { aiRouter } from './routes/ai';
import { getMatcher } from './scanner/matcher';
import { lastSuccessfulIngestAt, runScheduledIngest } from './combos/ingest';
import { lastSuccessfulRollupAt, runScheduledRollup } from './aggregates/rollup';
import {
  resolveCards,
  fetchCardsByIds,
  fetchPrintings,
  getCardById,
  fetchRulings,
} from './scryfall';
import { dedupePreservingOrder } from './utils';
import { getSetMap, getSetCards, SetNotFoundError } from './sets';
import { parseImport } from './parsers';
import type { ImportRow, ImportFormat, Finish, Condition } from './parsers/types';
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

/**
 * Last-resort process guards. Armed before anything else boots, because the
 * failures they catch happen in *background* work — schedulers, ingests,
 * streams — not in a request, so no route handler ever sees them.
 *
 * ## Why this exists
 *
 * On 2026-08-17 production died repeatedly over roughly six hours, and every
 * death was silent: an unhandled `'error'` event on an EventEmitter is fatal
 * in Node, so the process vanished mid-job with **nothing in the logs**. Four
 * separate faults hid behind each other (a dropped idle Postgres connection
 * #1651, a checked-out client #1654, a dropped bulk download #1657), and each
 * one was diagnosed by inference, deploy, and wait — because the only evidence
 * was Fly restarting a machine. Any one of these two lines would have printed
 * the stack and named the culprit in seconds.
 *
 * ## Why it does NOT exit
 *
 * The conventional advice is to log and exit, on the theory that an uncaught
 * exception leaves unknowable state. That advice is wrong *here*, and this is
 * a deliberate departure from it:
 *
 * - Every fault of 2026-08-17 was a stray error on a background stream or
 *   connection. The HTTP server, the SQLite cache and the pg pool were all
 *   intact. Exiting was not a safety measure — **exiting WAS the outage**.
 * - This app runs as a single Fly machine (`min_machines_running = 1`), so
 *   `process.exit()` is a total outage, not a drained instance. There is no
 *   sibling to take the traffic.
 * - A process genuinely wedged past recovery still gets caught: it stops
 *   answering `/health` and Fly replaces it. That path is already load-bearing
 *   and does not need our help.
 *
 * So: stay up, and make the failure **loud** instead of invisible. A logged
 * stack that costs one degraded background job beats a silent restart that
 * costs the site.
 *
 * These are a safety net, never a substitute for handling the error at its
 * source — see `pipeForwardingErrors` in `stream-utils.ts` and the listeners
 * in `db/index.ts`. If either of these fires, that is a BUG REPORT: find the
 * unhandled emitter and give it an owner.
 */
process.on('uncaughtException', (err, origin) => {
  logger.error(`[server] UNCAUGHT EXCEPTION (${origin}) — staying up, but this is a bug:`, err);
});

process.on('unhandledRejection', (reason) => {
  logger.error('[server] UNHANDLED REJECTION — staying up, but this is a bug:', reason);
});

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
// ENFORCING. It spent its whole life Report-Only with no `report-uri`/
// `report-to`, which meant it could neither block nor report a thing — Firefox
// says so in the console. Rather than stand up a report collector for a policy
// whose directives were already enumerated by hand, the allowlist was checked
// against every external origin the SPA actually reaches at runtime and turned
// on. `'unsafe-inline'` stays in script-src/style-src: index.html has an inline
// theme script and React writes inline styles.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        // apis.google.com + accounts.google.com: the Drive picker and the GIS
        // token client are loaded from Google and cannot be self-hosted.
        'script-src': [
          "'self'",
          "'unsafe-inline'",
          'https://apis.google.com',
          'https://accounts.google.com',
        ],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': [
          "'self'",
          'data:',
          'blob:',
          'https://*.scryfall.io',
          'https://*.scryfall.com',
          // Drive picker chrome: file thumbnails and Google's own icons.
          'https://*.googleusercontent.com',
          'https://ssl.gstatic.com',
          'https://www.gstatic.com',
        ],
        'connect-src': [
          "'self'",
          'https://api.scryfall.com',
          'https://json.edhrec.com',
          'https://*.scryfall.io',
          // Cube import reads a cube straight from CubeCobra's JSON API, and
          // the game-night venue field geocodes against Photon. Both are
          // browser-side fetches, not proxied through us.
          'https://cubecobra.com',
          'https://photon.komoot.io',
          // Token grant + the Drive file/export download the picker feeds.
          'https://accounts.google.com',
          'https://www.googleapis.com',
          'https://content.googleapis.com',
        ],
        // The picker renders in an iframe we open. Distinct from
        // `frame-ancestors` below, which governs who may frame US (nobody).
        'frame-src': ['https://docs.google.com', 'https://accounts.google.com'],
        'worker-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'frame-ancestors': ["'none'"],
      },
    },
    hsts: { maxAge: 31_536_000, includeSubDomains: true },
    frameguard: { action: 'deny' },
    /**
     * Helmet defaults this to `same-origin`, which puts any popup WE open into
     * a different browsing-context group and makes `window.opener` null inside
     * it. Google's identity client hands the OAuth token back through the
     * opener, so under the default the Drive consent popup opened, the user
     * signed in, the popup closed — and the token never arrived. The picker
     * then never opened, with nothing in the console to explain it.
     *
     * `same-origin-allow-popups` keeps the protection that matters (a
     * cross-origin page that opens US still gets no handle on this window)
     * while letting popups we open keep their opener. It is the setting
     * Google's own sign-in docs require.
     */
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    /**
     * Helmet defaults this to `no-referrer`, which tells the browser never to
     * send a `Referer` — and a Google API key restricted to specific websites
     * is checked against exactly that header. So the restriction could never
     * match: Google rejected every Picker request with "Requests from referer
     * <empty> are blocked", which the Picker shows as the far less helpful
     * "The API developer key is invalid." The Cloud Console settings were
     * correct the entire time.
     *
     * `strict-origin-when-cross-origin` is the modern browser default and
     * sends only the ORIGIN cross-origin (never the path, and nothing at all
     * when downgrading to http), so Google gets `https://spellcontrol.com/`
     * to match against while no page a user is on ever leaks.
     */
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
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
const importLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });
// One request per link, and a user only pastes a handful — tight, because each
// one makes the server fetch a third-party URL on the caller's behalf.
const importLinkLimiter = testAwareLimiter({ windowMs: 60_000, max: 20 });
const priceLimiter = testAwareLimiter({ windowMs: 60_000, max: 30 });
const productLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });
// Each uncached set code fans out to up to MAX_SET_PAGES Scryfall requests
// (sets.ts), so an unlimited public route lets one IP drive unbounded
// upstream traffic. Matches the other public Scryfall-backed routes.
const setsLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });

/** Scryfall card UUID — validates the :id path param on the card-by-id routes. */
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
app.use('/api/aggregates', aggregatesRouter);
app.use('/api/shares', sharesRouter);
app.use('/api/feedback', feedbackRouter);
app.use('/api/offline', offlineRouter);
app.use('/api/scanner', scannerRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/users', usersRouter);
app.use('/api/game-nights', gameNightsRouter);
app.use('/api/pods', podsRouter);
app.use('/api/pods', podStatsRouter);
app.use('/api/tonight-trades', tonightTradesRouter);
app.use('/api/trades', tradesRouter);
app.use('/api/publications', publicationsRouter);
app.use('/api/public', publicRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/discover', discoverRouter);
app.use('/api/activity', activityRouter);
app.use('/api/ai', aiRouter);

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
 * Bulk oracle facts by name — the collection-scale read behind cube generation.
 * See `oracle-facts.ts` for why this exists and what it deliberately omits.
 *
 * Gzipped by hand (node:zlib, the same thing `offline/bulk-cache` does) because
 * there's no compression middleware in this app and a 10k-card answer is worth
 * ~4x on the wire. Not worth a new dependency.
 */
app.post('/api/cards/oracle-facts', priceLimiter, async (req: Request, res: Response) => {
  const raw = (req.body && (req.body as { cards?: unknown }).cards) as unknown;
  if (!Array.isArray(raw)) {
    return res
      .status(400)
      .json({ error: 'Body must be { cards: Array<{ name: string, scryfallId?: string }> }.' });
  }

  const requests: OracleRequest[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { name, scryfallId } = entry as { name?: unknown; scryfallId?: unknown };
    if (typeof name !== 'string' || !name) continue;
    requests.push({
      name,
      scryfallId: typeof scryfallId === 'string' && scryfallId ? scryfallId : undefined,
    });
    if (requests.length >= ORACLE_REQUEST_LIMIT) break;
  }

  try {
    const cards = await resolveOracleFacts(requests, cache);
    const body = Buffer.from(JSON.stringify({ cards }), 'utf-8');
    gzip(body, (err, gzipped) => {
      if (err) {
        logger.warn('[oracle-facts] gzip failed, sending uncompressed:', err);
        return res.type('application/json').send(body);
      }
      res
        .set({
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Encoding': 'gzip',
        })
        .send(gzipped);
    });
  } catch (err) {
    logger.error('[oracle-facts] failed:', err);
    res.status(502).json({ error: 'Failed to resolve card data.' });
  }
});

/**
 * Returns Scryfall rulings for a card by Scryfall UUID, cached in SQLite with a 7-day TTL.
 * - 200 { rulings: Ruling[] } on success (empty array if card has no rulings or Scryfall 404)
 * - 400 if :id is not a plausible Scryfall UUID
 * - 502/500 on upstream/transient failure
 */
app.get(
  '/api/cards/:id/rulings',
  testAwareLimiter({ windowMs: 60_000, max: 60 }),
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
      res.status(502).json({ error: 'Failed to fetch rulings.' });
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

app.get('/api/sets', setsLimiter, async (_req: Request, res: Response) => {
  try {
    const sets = await getSetMap();
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ sets });
  } catch (err) {
    logger.error('[sets] fetch failed:', err);
    res.status(502).json({ error: 'Failed to fetch set list from Scryfall.' });
  }
});

/** Full card list of one set (every printing), for the set-completion checklist. */
app.get('/api/sets/:code/cards', setsLimiter, async (req: Request, res: Response) => {
  const code = String(req.params.code || '').toLowerCase();
  if (!/^[a-z0-9]{2,10}$/.test(code)) {
    return res.status(400).json({ error: 'Invalid set code.' });
  }
  try {
    const cards = await getSetCards(code);
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ cards });
  } catch (err) {
    if (err instanceof SetNotFoundError) {
      return res.status(404).json({ error: `No cards found for set "${code}".` });
    }
    logger.error('[sets] set cards fetch failed:', err);
    res.status(502).json({ error: 'Failed to fetch set cards from Scryfall.' });
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
      fetchErrors: dedupePreservingOrder(sections.fetchErrorNames),
      // MTGJSON decklists have no raw-text parse step, so there's no concept
      // of a malformed line here.
      malformedRows: [],
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

    // A degraded resolve (Scryfall unreachable for part of the box) must not be
    // cached — the retry would just get the same incomplete payload back.
    const degraded =
      sections.fetchErrorNames.length > 0 || physicalResolved.fetchErrorNames.length > 0;
    if (!degraded) res.set('Cache-Control', 'public, max-age=3600');
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
      fetchErrors: dedupePreservingOrder(physicalResolved.fetchErrorNames),
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
    let degraded = false;
    if (commanderRows.length > 0) {
      const resolved = await resolveCards([commanderRows[0]], cache);
      const card = resolved.resolved[0];
      degraded = resolved.fetchErrorNames.length > 0;
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
    // Don't cache a null summary that only exists because Scryfall was down —
    // that would pin "no commander" on the row for a day.
    if (!degraded) {
      setCachedCommanderSummary(fileName, summary);
      res.set('Cache-Control', 'public, max-age=86400');
    }
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
 *   - application/json with { rows: ImportRow[] } — the lossless retry path: a
 *     degraded import's `fetchErrors` rows echoed back verbatim, so quantity /
 *     printing / finish survive the round trip without re-parsing.
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
      let rows: ImportRow[];
      let detectedFormat: string;
      // Rows a parser couldn't turn into an ImportRow at all (bad column count,
      // no name, etc) and rows dropped for being an explicit qty-0 wishlist
      // entry. Empty for the JSON-rows retry path — those rows already parsed
      // successfully the first time around.
      let malformedRows: string[] = [];
      let skippedUnownedRows = 0;
      const bodyRows = readImportRows(req);
      if (bodyRows) {
        rows = bodyRows;
        detectedFormat = bodyRows[0]?.sourceFormat ?? 'plain';
      } else {
        const text = await readImportText(req);
        if (!text) {
          return res.status(400).json({
            error: 'Provide either a file (multipart) or JSON body { text: string }',
          });
        }
        const parseResult = parseImport(text);
        rows = parseResult.rows;
        detectedFormat = parseResult.format;
        malformedRows = parseResult.unparsedLines;
        skippedUnownedRows = parseResult.skippedUnownedRows;
      }
      if (rows.length === 0) {
        return res.status(400).json({
          error:
            'No cards found in the input. Try uploading a CSV from a supported tool, or pasting card names one per line.',
        });
      }

      // "Mark all as proxies" import-time flag (see import-proxy-flag.ts).
      if (parseMarkAllAsProxies(req.body)) rows.forEach((r) => (r.proxy = true));

      // Resolve the parsed (unexpanded) rows: resolveCards dedupes by identifier
      // anyway, so quantity has no bearing on the network calls. Expanding only
      // afterward — during the merge — avoids materializing a second, potentially
      // huge ImportRow[] just to throw it away (a 2000-copy row would otherwise be
      // 2000 duplicate objects before dedup collapsed them again).
      const { resolved, unresolvedNames, fetchErrorNames } = await resolveCards(rows, cache);

      // Rows whose lookup never reached Scryfall (outage / rate-limit storm) are
      // WITHHELD from the import — merging them as raw name-only cards would make
      // a transient failure look like a pile of typos. They go back to the client
      // in `fetchErrors` for a lossless retry.
      const fetchFailed = new Set(fetchErrorNames);
      const fetchErrorRows: ImportRow[] = [];
      let hits = 0;
      let misses = 0;
      let total = 0;
      let clampedRows = 0;
      const cards: EnrichedCard[] = [];
      rows.forEach((row, i) => {
        const sCard = resolved[i];
        if (!sCard && row.name && fetchFailed.has(row.name)) {
          fetchErrorRows.push(row);
          return;
        }
        const rawQty = Math.max(1, row.quantity || 1);
        if (rawQty > MAX_QTY_PER_ROW) clampedRows++;
        const qty = Math.min(MAX_QTY_PER_ROW, rawQty);
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
        fetchErrors: fetchErrorRows,
        malformedRows,
        skippedUnownedRows,
        clampedRows,
        detectedFormat,
      };

      res.json(response);
    } catch (err) {
      if (err instanceof ImportTooLargeError) {
        return res.status(413).json({ error: err.message });
      }
      // The raw message stays in the server log only — this endpoint is
      // unauthenticated, and echoing `err.message` leaked internal Scryfall /
      // SQLite / fs text to anonymous callers. Mirrors the generic wording the
      // global error handler already uses.
      logger.error('[import] error:', err);
      res.status(500).json({
        error: 'Import failed. Please check your file format and try again.',
      });
    }
  }
);

/**
 * Resolve a Google Sheets / Drive share link to the file's raw text.
 *
 * Deliberately does NOT import anything: it hands the text back so the client
 * can stage it as a normal file and run the existing /api/import flow over it
 * (chunking, retry, the re-import gate, history). The fetch has to happen here
 * because Google's export endpoints send no CORS headers — see import-link.ts
 * for the host allowlist that makes a server-side fetch of a user-supplied URL
 * safe.
 */
app.post('/api/import/link', importLinkLimiter, async (req: Request, res: Response) => {
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!url) return res.status(400).json({ error: 'Paste a Google Sheets or Drive link.' });
  try {
    res.json(await fetchImportLink(url));
  } catch (err) {
    // ImportLinkError messages are written for the user (bad link, not shared,
    // too big). Anything else is ours to log and generalize.
    if (err instanceof ImportLinkError) return res.status(400).json({ error: err.message });
    logger.error('[import-link] error:', err);
    res.status(502).json({ error: "Couldn't reach Google to fetch that link." });
  }
});

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
      const sideboardRows = parseResult.rows.filter((r) => r.section === 'sideboard');
      // "Maybeboard" is the ecosystem's de-facto text-format header for a
      // park-candidates pile (Moxfield/Archidekt/MTGGoldfish) — routes to
      // `considering` (E122) instead of being silently dropped.
      const consideringRows = parseResult.rows.filter((r) => r.section === 'maybeboard');
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
      const sections = await resolveDeckRows(
        commanderRows,
        companionRows,
        deckRows,
        cache,
        sideboardRows,
        consideringRows
      );

      const response: DeckImportResponse = {
        commander: sections.commander,
        companion: sections.companion,
        cards: sections.cards,
        sideboard: sections.sideboard,
        considering: sections.considering,
        unresolvedNames: dedupePreservingOrder(sections.unresolvedNames),
        fetchErrors: dedupePreservingOrder(sections.fetchErrorNames),
        malformedRows: parseResult.unparsedLines,
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
      res.status(500).json({
        error: 'Deck import failed. Please check the format and try again.',
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
  testAwareLimiter({ windowMs: 60_000, max: 60 }),
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
      res.status(500).json({ error: 'Failed to fetch printings.' });
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
  testAwareLimiter({ windowMs: 60_000, max: 240 }),
  async (req: Request, res: Response) => {
    try {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      if (!UUID_RE.test(id)) {
        return res.status(400).json({ error: 'id must be a Scryfall UUID' });
      }
      const card = await getCardById(id, cache);
      res.json({ card });
    } catch (err) {
      logger.error('[cards/by-id] error:', err);
      res.status(500).json({ error: 'by-id lookup failed.' });
    }
  }
);

/**
 * How old a cached printing may be and still be trusted for money. The bulk
 * ingest restamps every printing nightly, so a healthy cache is always well
 * inside this; the extra half-day is slack for one missed run. Past it we go
 * live rather than quote prices from a dump that stopped arriving.
 */
const PRICE_MAX_AGE_MS = 36 * 60 * 60 * 1000;

/**
 * Exact-name card lookup answered from the nightly bulk dump. `/cards/named` was
 * the last high-frequency Scryfall call the browser still made on every card
 * add, and a client-side 429 is invisible to us — Scryfall omits
 * `Access-Control-Allow-Origin` on 429 responses, so the body never reaches JS
 * and the throttle surfaces to the user as a generic network error.
 *
 * Cache-only on purpose: **this must never fall back to a live Scryfall fetch.**
 * That would move miss traffic onto the shared Fly egress IP, which is exactly
 * what earned us the throttling this endpoint exists to avoid. A miss returns
 * `{ card: null }`; the frontend keeps its existing browser-side live path, from
 * the user's own IP, and only pays for it on the rare card the dump lacks.
 */
app.get(
  '/api/cards/named',
  testAwareLimiter({ windowMs: 60_000, max: 240 }),
  (req: Request, res: Response) => {
    const exact = typeof req.query.exact === 'string' ? req.query.exact.trim() : '';
    if (!exact) return res.status(400).json({ error: 'exact is required.' });
    res.json({ card: cache.getCheapestByName(exact, PRICE_MAX_AGE_MS) });
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

    // Serve from the nightly `default_cards` dump, which carries prices and
    // restamps every printing daily (scryfall-bulk.ts). Only ids the dump
    // doesn't cover go to the live API.
    //
    // This route used to call fetchCardsByIds for EVERY id — that function
    // bypasses the cache deliberately, wanting current prices rather than the
    // 7-day snapshot. It cost ~14 upstream requests per 1000-id chunk, and
    // because it runs server-side, every user's refresh spends the SAME
    // per-IP budget on our one Fly machine. It was the live 429 source:
    //
    //   POST /api/refresh-prices 200 8583ms
    //   [scryfall] batch 5 hit 429, waiting 30000ms before retry 1/5
    //   POST /api/refresh-prices 200 66790ms
    //
    // Daily prices are the right granularity for valuing a collection, and are
    // far fresher than the 7-day TTL the bypass was written to avoid.
    const cached = cache.getMany(ids, false, PRICE_MAX_AGE_MS);
    const uncached = ids.filter((id) => !cached.has(id));
    const fetched = uncached.length > 0 ? await fetchCardsByIds(uncached, cache) : [];
    if (uncached.length > 0) {
      logger.info(
        `[refresh-prices] ${cached.size}/${ids.length} from bulk cache, ${uncached.length} live`
      );
    }
    const cards = [...cached.values(), ...fetched];

    const now = Date.now();
    // Return the price for EACH finish (the client picks the one matching the
    // owned copy). The request is per-printing (scryfallId) and finish-agnostic
    // because a single printing serves nonfoil + foil + etched copies; sending
    // all three avoids a foil silently showing the non-foil price. `usd` is the
    // non-foil baseline; a client that ignores the foil fields degrades to the
    // old behaviour. EUR (Cardmarket) rides along per finish for the display
    // currency setting — 0 means "Scryfall has no EUR price for this finish",
    // which the client stores as fetched-but-unpriced (an honest dash), never
    // as never-fetched. Emit an entry if ANY finish in EITHER currency has a
    // price.
    const prices: Record<
      string,
      {
        usd: number;
        usdFoil: number;
        usdEtched: number;
        eur: number;
        eurFoil: number;
        eurEtched: number;
        pricedAt: number;
      }
    > = {};
    for (const card of cards) {
      const usd = pickUsdForFinish(card, 'nonfoil');
      const usdFoil = pickUsdForFinish(card, 'foil');
      const usdEtched = pickUsdForFinish(card, 'etched');
      const eur = pickEurForFinish(card, 'nonfoil');
      const eurFoil = pickEurForFinish(card, 'foil');
      const eurEtched = pickEurForFinish(card, 'etched');
      if (usd > 0 || usdFoil > 0 || usdEtched > 0 || eur > 0 || eurFoil > 0 || eurEtched > 0) {
        prices[card.id] = { usd, usdFoil, usdEtched, eur, eurFoil, eurEtched, pricedAt: now };
      }
    }

    res.json({ prices });
  } catch (err) {
    logger.error('[refresh-prices] error:', err);
    res.status(500).json({ error: 'Price refresh failed.' });
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

const IMPORT_FORMATS = new Set<ImportFormat>([
  'manabox',
  'archidekt',
  'moxfield',
  'deckbox',
  'generic-csv',
  'mtga',
  'plain',
  'mtgjson',
]);
const FINISHES = new Set<Finish>(['nonfoil', 'foil', 'etched']);
const CONDITIONS = new Set<Condition>(['nm', 'lp', 'mp', 'hp', 'damaged']);

/**
 * Rebuilds a client-supplied row (the `{ rows }` retry path) from a whitelist
 * of ImportRow fields. The body is untrusted — everything is type-checked and
 * enums are validated, so nothing but known shapes reaches the resolver.
 * Returns null for entries with no usable identifier.
 */
function sanitizeImportRow(raw: unknown): ImportRow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const name = str(r.name) ?? '';
  const scryfallId = str(r.scryfallId);
  if (!name && !scryfallId) return null;
  const qty = typeof r.quantity === 'number' && isFinite(r.quantity) ? Math.floor(r.quantity) : 1;
  const row: ImportRow = {
    name,
    quantity: Math.min(MAX_QTY_PER_ROW, Math.max(1, qty)),
    sourceFormat: IMPORT_FORMATS.has(r.sourceFormat as ImportFormat)
      ? (r.sourceFormat as ImportFormat)
      : 'plain',
  };
  if (scryfallId) row.scryfallId = scryfallId;
  const setCode = str(r.setCode);
  if (setCode) row.setCode = setCode;
  const setName = str(r.setName);
  if (setName) row.setName = setName;
  const collectorNumber = str(r.collectorNumber);
  if (collectorNumber) row.collectorNumber = collectorNumber;
  if (FINISHES.has(r.finish as Finish)) row.finish = r.finish as Finish;
  if (CONDITIONS.has(r.condition as Condition)) row.condition = r.condition as Condition;
  const language = str(r.language);
  if (language) row.language = language;
  if (r.altered === true) row.altered = true;
  if (r.proxy === true) row.proxy = true;
  if (r.misprint === true) row.misprint = true;
  if (typeof r.purchasePrice === 'number' && isFinite(r.purchasePrice) && r.purchasePrice >= 0) {
    row.purchasePrice = r.purchasePrice;
  }
  const rarity = str(r.rarity);
  if (rarity) row.rarity = rarity;
  const sourceCategory = str(r.sourceCategory);
  if (sourceCategory) row.sourceCategory = sourceCategory;
  return row;
}

/**
 * Pulls pre-parsed rows from a JSON `{ rows }` body — the degraded-import retry
 * path. Returns null when the request isn't that shape (falls through to the
 * text/file path).
 */
function readImportRows(req: Request): ImportRow[] | null {
  const raw: unknown = req.body?.rows;
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_TOTAL_CARDS) {
    throw new ImportTooLargeError(
      `Import has too many rows (limit ${MAX_TOTAL_CARDS.toLocaleString()}).`
    );
  }
  return raw.map(sanitizeImportRow).filter((r): r is ImportRow => r !== null);
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
  app.get('/d/:token', createShareLandingHandler(SPA_DIR, lookupPublicDeckLandingMeta));
  app.get('/u/:token', createShareLandingHandler(SPA_DIR, lookupPublicUserLandingMeta));
  app.get('/gn/s/:token', createShareLandingHandler(SPA_DIR, lookupGameNightSeriesLandingMeta));
  app.get('/gn/:token', createShareLandingHandler(SPA_DIR, lookupGameNightLandingMeta));
  // Deliberately NOT /gn/i/:token (E208 named guest invites). That link is one
  // person's credential, so it must not unfurl the night's details into
  // whatever chat it's pasted into; it falls through to the plain SPA shell,
  // resolves client-side, and redirects to /gn/:token which does unfurl.

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
 * Kicks off the commander-popularity aggregate rollup (social program W4) —
 * line-for-line mirror of scheduleComboIngest above. Skips when a successful
 * run finished within the last 20h so a redeploy doesn't immediately
 * recompute; the dataset is small enough that a single setInterval is
 * sufficient — no queue or external scheduler needed.
 */
function scheduleAggregatesRollup(): void {
  const TWENTY_HOURS = 20 * 60 * 60 * 1000;
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  const tick = async () => {
    try {
      const lastAt = await lastSuccessfulRollupAt();
      if (lastAt && Date.now() - lastAt < TWENTY_HOURS) {
        logger.info('[aggregates] skipping rollup — last successful run was recent');
      } else {
        await runScheduledRollup();
      }
    } catch (err) {
      logger.error('[aggregates] schedule tick failed:', err);
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

  // Only ever one ingest in flight — two threads writing the same SQLite file
  // is not something to find out about in production.
  //
  // But "skip while one is running" alone is a trap: an ingest CAN hang
  // indefinitely. Observed twice on 2026-08-18, before the download was moved
  // to disk — the transfer stalled and undici raised nothing at all, so the
  // worker sat there holding a dead socket forever, with no error to react to.
  // A permanent skip would then mean the ingest never runs again until someone
  // redeploys. A worker still alive a full interval later is wedged, not slow,
  // so it gets terminated and replaced. That is safe now that an interrupted
  // run resumes from the downloaded dump instead of restarting from zero.
  let current: Worker | null = null;

  const tick = () => {
    if (current) {
      logger.error(
        '[scryfall-bulk] previous ingest still running a full interval later — terminating it'
      );
      void current.terminate();
      current = null;
    }
    // `.ts` under tsx in dev, `.js` from dist in production. Deriving it from
    // this module's own extension keeps the two in step without a build flag.
    const entry = path.join(__dirname, `scryfall-bulk.worker${path.extname(__filename)}`);
    const started = Date.now();
    const worker = new Worker(entry, { workerData: { dbPath: DB_PATH } });
    current = worker;
    worker.on('error', (err) => {
      // Worker construction/runtime failure. Without this listener the error
      // reaches the process as an unhandled 'error' event.
      logger.error('[scryfall-bulk] worker error:', err);
    });
    worker.on('exit', (code) => {
      if (current === worker) current = null;
      const secs = Math.round((Date.now() - started) / 1000);
      if (code === 0) logger.info(`[scryfall-bulk] worker finished in ${secs}s`);
      else logger.error(`[scryfall-bulk] worker exited with code ${code} after ${secs}s`);
    });
  };

  tick();
  setInterval(tick, TWENTY_FOUR_HOURS);
}

/**
 * Hold heavy background work back from the boot path, and stagger it.
 *
 * This process is single-threaded, and the worst offenders are SYNCHRONOUS:
 * `better-sqlite3` writes block whatever thread they run on, so while the
 * Scryfall bulk ingest runs (~450MB, ~107k rows) nothing on that thread
 * answers — not requests, not the health check. The check then goes critical,
 * the proxy drops the only instance, and the whole site 503s during what should
 * be an unremarkable background refresh.
 *
 * The bulk ingest no longer runs on this thread at all — it was moved to a
 * worker (`scryfall-bulk.worker.ts`) after a measured run took the site down
 * for ~10 minutes on 2026-08-18. Deferring and staggering never addressed that;
 * they only moved the window. The remaining jobs here are still on the event
 * loop, so the staggering below still matters — and the scanner matcher preload
 * (measured 38.8s and 148.7s) is the next candidate for the same treatment.
 *
 * Measured on the 2026-08-17 deploys: the matcher preload alone took 38.8s and
 * 148.7s on two boots, with the bulk ingest, combo ingest and aggregates
 * rollup all kicked off in the same tick.
 *
 * So each job waits until the health check has had time to pass (grace 30s +
 * interval 30s) and then they go one at a time. Offsets rather than a queue:
 * these are fire-and-forget schedulers with their own recency guards, the
 * point is only that they must not land together, and a queue would need every
 * one of them to report completion honestly to stay correct.
 */
const BOOT_DEFER_MS = Number(process.env.BOOT_DEFER_MS ?? 90_000);

function afterBoot(label: string, offsetMs: number, fn: () => void): void {
  const timer = setTimeout(() => {
    logger.info(`[boot] starting deferred ${label}`);
    try {
      fn();
    } catch (err) {
      logger.error(`[boot] deferred ${label} failed to start:`, err);
    }
  }, BOOT_DEFER_MS + offsetMs);
  // `unref` so a pending warm-up can never be the reason the process stays
  // alive — in production the HTTP server holds the loop open, and anything
  // that imports this module without serving should still be able to exit.
  timer.unref();
}

async function start() {
  await ensureSchema();
  await promoteAdminsAtBoot();
  const server = app.listen(PORT, () => {
    logger.info(`[server] listening on http://localhost:${PORT}`);
    logger.info(`[server] cache db: ${DB_PATH}`);
    logger.info(`[server] cache stats:`, cache.stats());
  });

  // The one case where the process-level guard above is the WRONG answer, so it
  // gets its owner here. A failed `listen` (EADDRINUSE, EACCES) used to crash
  // the process, which Fly recovered by restarting it. With `uncaughtException`
  // handled, that same failure would instead leave us alive and NOT listening —
  // a process that can never pass a health check and never exits to be replaced.
  // Boot failures are the exception to "stay up": there is nothing to stay up
  // for. `start()`'s catch already covers the rejection path; this covers the
  // event path.
  server.on('error', (err) => {
    logger.error('[server] listen failed — exiting so the platform can restart:', err);
    process.exit(1);
  });

  if (process.env.COMBOS_INGEST_DISABLED !== '1') {
    afterBoot('combo ingest', 30_000, scheduleComboIngest);
  }

  if (process.env.AGGREGATES_ROLLUP_DISABLED !== '1') {
    afterBoot('aggregates rollup', 60_000, scheduleAggregatesRollup);
  }

  if (process.env.SCRYFALL_BULK_INGEST_DISABLED !== '1') {
    // Last and longest — this is the one that actually blocks the loop.
    afterBoot('scryfall bulk ingest', 120_000, scheduleScryfallBulkIngest);
  }

  // Eagerly load the scanner matcher (pHash + embedding DBs + ONNX session) so
  // a deploy with missing data files surfaces here at boot rather than on the
  // first user scan. Fire-and-forget — the route handler still awaits
  // `getMatcher()` on every request, so listening doesn't have to block on
  // the ~1s ONNX session create. A `null` resolve means the data files aren't
  // present (logged inside `getMatcher`); a rejection is unexpected and gets
  // surfaced loudly so monitoring can catch it.
  //
  // Deferred like the ingests: the "~1s ONNX session create" in that note is
  // true locally but not on Fly, where loading 54k hashes + embeddings off the
  // volume measured 38.8s and 148.7s. It is a warm-up, not a correctness
  // requirement, so it goes first among the deferred jobs and still surfaces
  // missing data files loudly.
  if (process.env.SCANNER_PRELOAD_DISABLED !== '1') {
    const dataDir =
      process.env.SCANNER_DATA_DIR || path.resolve(__dirname, '..', 'data', 'scanner');
    afterBoot('scanner matcher preload', 0, () => {
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
    });
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
