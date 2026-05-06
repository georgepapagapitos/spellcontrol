import express, { type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import { ScryfallCache } from './cache';
import { resolveCards } from './scryfall';
import { parseImport } from './parsers';
import type { ImportRow } from './parsers/types';
import type { EnrichedCard, ScryfallCard, UploadResponse } from './types';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3737;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'scryfall-cache.db');

const app = express();
const cache = new ScryfallCache(DB_PATH);

app.use(express.json({ limit: '10mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, cache: cache.stats() });
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
    base.cmc = scryfall.cmc;
    base.typeLine = scryfall.type_line;
    base.colorIdentity = scryfall.color_identity;
    base.colors = scryfall.colors;
    base.edhrecRank = scryfall.edhrec_rank;
    const faceImages = scryfall.card_faces?.[0]?.image_uris;
    base.imageSmall = scryfall.image_uris?.small || faceImages?.small;
    base.imageNormal = scryfall.image_uris?.normal || faceImages?.normal;
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
  res.status(500).json({ error: 'An unexpected server error occurred.' });
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
