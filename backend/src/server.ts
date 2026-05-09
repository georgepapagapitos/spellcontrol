import crypto from 'crypto';
import express, { type Request, type Response } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import path from 'path';
import { ScryfallCache } from './cache';
import { resolveCards, fetchCardsByIds, fetchPrintings } from './scryfall';
import { getSetMap } from './sets';
import { parseImport } from './parsers';
import type { ImportRow } from './parsers/types';
import type { DeckImportResponse, EnrichedCard, ScryfallCard, UploadResponse } from './types';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3737;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'scryfall-cache.db');

const app = express();
const cache = new ScryfallCache(DB_PATH);

app.use(helmet());

const importLimiter = rateLimit({ windowMs: 60_000, max: 20 });
const priceLimiter = rateLimit({ windowMs: 60_000, max: 30 });

app.use(express.json({ limit: '10mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, cache: cache.stats() });
});

app.get('/api/sets', async (_req: Request, res: Response) => {
  try {
    const sets = await getSetMap();
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ sets });
  } catch (err) {
    console.error('[sets] fetch failed:', err);
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
      console.error('[import] error:', err);
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

      const allRows = [...commanderRows, ...companionRows, ...deckRows];
      // Strip collector numbers so resolution falls back to name+set. Deck exports
      // from various tools use collector numbers that may not match Scryfall's
      // numbering for the same printing, causing false negatives. For deck import
      // we only need the card data, not an exact printing match.
      const relaxedRows = allRows.map((r) => ({ ...r, collectorNumber: undefined }));
      const expanded = expandByQuantity(relaxedRows);
      const { resolved, unresolvedNames } = await resolveCards(expanded, cache);

      const cardsByName = new Map<string, ScryfallCard>();
      for (let i = 0; i < expanded.length; i++) {
        const card = resolved[i];
        if (card && !cardsByName.has(expanded[i].name)) {
          cardsByName.set(expanded[i].name, card);
        }
      }

      let commander: ScryfallCard | null = null;
      if (commanderRows.length > 0) {
        commander = cardsByName.get(commanderRows[0].name) ?? null;
      }

      let companion: ScryfallCard | null = null;
      if (companionRows.length > 0) {
        companion = cardsByName.get(companionRows[0].name) ?? null;
      }

      const cards: ScryfallCard[] = [];
      for (const row of deckRows) {
        const card = cardsByName.get(row.name);
        if (card) {
          for (let i = 0; i < Math.max(1, row.quantity); i++) {
            cards.push(card);
          }
        }
      }

      const response: DeckImportResponse = {
        commander,
        companion,
        cards,
        unresolvedNames: dedupePreservingOrder(unresolvedNames),
        detectedFormat: parseResult.format,
        cardCount: cards.length + (commander ? 1 : 0) + (companion ? 1 : 0),
      };

      res.json(response);
    } catch (err) {
      console.error('[import-deck] error:', err);
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
      console.error('[printings] error:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: `Failed to fetch printings: ${message}` });
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
    console.error('[refresh-prices] error:', err);
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
async function readImportText(req: Request): Promise<string | null> {
  if (req.file) {
    return req.file.buffer.toString('utf-8');
  }
  if (req.body && typeof req.body.text === 'string' && req.body.text.trim()) {
    return req.body.text;
  }
  return null;
}

function expandByQuantity(rows: ImportRow[]): ImportRow[] {
  const expanded: ImportRow[] = [];
  for (const row of rows) {
    const qty = Math.max(1, row.quantity || 1);
    for (let i = 0; i < qty; i++) {
      expanded.push(row);
    }
  }
  return expanded;
}

/**
 * Resolve the price to display for a card. Always prefer Scryfall's current
 * market value (the "what it's worth now" number users actually want for
 * binder planning) over whatever the import row carried. Foils prefer
 * usd_foil → usd_etched → usd; non-foils prefer usd → usd_etched → usd_foil.
 * Falls back to the row price (e.g. a ManaBox purchase price) when Scryfall
 * has no price, then to 0.
 */
// Always prefer Scryfall's market price over whatever the import file claimed.
// CSV "purchase price" columns vary wildly (some are list price, some are
// what the user paid years ago, some are blank) and we've decided to ignore
// them entirely for display. Returns 0 when Scryfall has no price for any
// finish — callers can treat that as "unpriced" rather than a real $0 value.
function resolvePrice(row: ImportRow, scryfall: ScryfallCard | undefined): number {
  const p = scryfall?.prices;
  if (p) {
    const candidates = row.foil
      ? [p.usd_foil, p.usd_etched, p.usd]
      : [p.usd, p.usd_etched, p.usd_foil];
    for (const raw of candidates) {
      if (!raw) continue;
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return 0;
}

function mergeCard(row: ImportRow, scryfall?: ScryfallCard): EnrichedCard {
  const price = resolvePrice(row, scryfall);
  const base: EnrichedCard = {
    copyId: crypto.randomUUID(),
    name: scryfall?.name || row.name,
    setCode: scryfall?.set?.toUpperCase() || row.setCode || '',
    setName: scryfall?.set_name || row.setName || '',
    collectorNumber: scryfall?.collector_number || row.collectorNumber || '',
    rarity: (scryfall?.rarity || row.rarity || '').toLowerCase(),
    scryfallId: scryfall?.id || row.scryfallId || '',
    purchasePrice: price,
    sourceCategory: row.sourceCategory || '',
    sourceFormat: row.sourceFormat,
    foil: row.foil ?? false,
  };
  if (price > 0) base.pricedAt = Date.now();

  if (scryfall) {
    // Some layouts (reversible_card, art_series, etc.) leave top-level type_line/cmc/colors
    // null and put the real data on the faces. Fall back to the first face so binder routing
    // and section grouping see real values for those printings.
    const firstFace = scryfall.card_faces?.[0];
    base.cmc = scryfall.cmc ?? firstFace?.cmc;
    base.typeLine = scryfall.type_line ?? firstFace?.type_line;
    base.colorIdentity = scryfall.color_identity;
    base.colors = scryfall.colors ?? firstFace?.colors;
    base.edhrecRank = scryfall.edhrec_rank;
    base.imageSmall = scryfall.image_uris?.small || firstFace?.image_uris?.small;
    base.imageNormal = scryfall.image_uris?.normal || firstFace?.image_uris?.normal;
    // Two-sided layouts (transform / modal_dfc / reversible / double_faced_token)
    // give each face its own image_uris. Capture the back so the preview can flip.
    const backFace = scryfall.card_faces?.[1];
    if (backFace?.image_uris?.normal) {
      base.imageNormalBack = backFace.image_uris.normal;
    }
    base.frameEffects = scryfall.frame_effects;
    // Older fullart lands don't put 'fullart' in frame_effects — they only set full_art.
    base.fullArt = scryfall.full_art === true || scryfall.frame_effects?.includes('fullart');
    base.borderColor = scryfall.border_color;
    base.layout = scryfall.layout;
    base.legalities = scryfall.legalities;
    base.finishes = scryfall.finishes;
    base.promoTypes = scryfall.promo_types;

    // Mana cost / oracle text — multi-face cards leave the top-level fields empty
    // and put data on each face. Join faces with separators so substring matching works.
    const faces = scryfall.card_faces;
    if (scryfall.mana_cost) {
      base.manaCost = scryfall.mana_cost;
    } else if (faces && faces.length > 0) {
      const joined = faces.map((f) => f.mana_cost ?? '').join(' // ');
      if (joined.replace(/\s|\/\//g, '').length > 0) base.manaCost = joined;
    }
    if (scryfall.oracle_text) {
      base.oracleText = scryfall.oracle_text;
    } else if (faces && faces.length > 0) {
      const joined = faces
        .map((f) => f.oracle_text ?? '')
        .filter(Boolean)
        .join('\n//\n');
      if (joined.length > 0) base.oracleText = joined;
    }
  }

  return base;
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

app.use((err: Error, _req: Request, res: Response, _next: unknown) => {
  if ((err as NodeJS.ErrnoException & { code?: string }).code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File is too large. Maximum size is 20 MB.' });
    return;
  }
  console.error('[server] unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong on the server. Try again in a moment.' });
});

const server = app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] cache db: ${DB_PATH}`);
  console.log(`[server] cache stats:`, cache.stats());
});

function shutdown() {
  console.log('\n[server] shutting down...');
  server.closeAllConnections();
  server.close(() => {
    cache.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
