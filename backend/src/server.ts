import express, { type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import { ScryfallCache } from './cache';
import { resolveCards } from './scryfall';
import { getSetMap } from './sets';
import { parseImport } from './parsers';
import type { ImportRow } from './parsers/types';
import type { EnrichedCard, ScryfallCard, UploadResponse } from './types';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3737;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'scryfall-cache.db');

const app = express();
const cache = new ScryfallCache(DB_PATH);

// Don't advertise the framework — small fingerprinting hygiene.
app.disable('x-powered-by');

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
app.post('/api/import', upload.single('file'), async (req: Request, res: Response) => {
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
});

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

function mergeCard(row: ImportRow, scryfall?: ScryfallCard): EnrichedCard {
  const base: EnrichedCard = {
    name: scryfall?.name || row.name,
    setCode: scryfall?.set?.toUpperCase() || row.setCode || '',
    setName: scryfall?.set_name || row.setName || '',
    collectorNumber: scryfall?.collector_number || row.collectorNumber || '',
    rarity: (scryfall?.rarity || row.rarity || '').toLowerCase(),
    scryfallId: scryfall?.id || row.scryfallId || '',
    purchasePrice: row.purchasePrice ?? 0,
    sourceCategory: row.sourceCategory || '',
    sourceFormat: row.sourceFormat,
    foil: row.foil ?? false,
  };

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
