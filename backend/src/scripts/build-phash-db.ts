/**
 * Builds the perceptual-hash database used by the card scanner's fast path.
 *
 * Pipeline
 * --------
 *  1. Fetch Scryfall's bulk-data manifest to find the latest `default_cards`
 *     dump (one entry per Scryfall printing, ~90k rows).
 *  2. Stream-parse the JSON array line-by-line so we don't load 600 MB into
 *     memory at once.
 *  3. For each card pick the `art_crop` image URL (front face for DFCs),
 *     download it, hash it with sharp + the shared dHash algorithm, and
 *     upsert into the SQLite store on disk.
 *  4. Resume-friendly: cards whose hash is already in the DB are skipped, so
 *     re-running the script after a crash continues where it left off.
 *
 * Why art_crop, not the full card image
 * -------------------------------------
 *  - The art is the most distinguishing part of a printing and is consistent
 *    across foils/etched/showcase finishes (same artwork → same hash).
 *  - It avoids hash variance from frame style, set symbol, mana cost, and
 *    title text — none of which help identification.
 *  - The client mirrors this crop on its captured frame before hashing.
 *
 * Usage
 * -----
 *   # Local (dev)
 *   npm run phash:ingest                      # full default_cards run
 *   npm run phash:ingest -- --unique-art      # smaller unique-artwork dump
 *   npm run phash:ingest -- --limit=500       # quick smoke test
 *   npm run phash:ingest -- --concurrency=8   # tune throughput
 *
 *   # Production (inside the docker container — writes to /data/phash.db
 *   # via the PHASH_DB_PATH env baked into the image)
 *   docker compose exec backend npm run phash:ingest:prod
 *   docker compose exec backend npm run phash:ingest:prod -- --limit=500
 *
 * Be courteous to Scryfall: keep concurrency modest (default 6). Their image
 * CDN doesn't have the same 50–100ms request floor as the JSON API, but
 * hammering it is rude either way.
 */

import path from 'path';
import sharp from 'sharp';
import { PhashStore } from '../phash-store';
import { dHashFromLuminance, HASH_BYTES } from '../phash';

interface ScryfallBulk {
  type: string;
  download_uri: string;
  updated_at: string;
  size: number;
}

interface BulkCard {
  id: string;
  name: string;
  set: string;
  collector_number: string;
  lang: string;
  digital?: boolean;
  layout?: string;
  image_status?: string;
  image_uris?: { art_crop?: string; normal?: string };
  card_faces?: Array<{ image_uris?: { art_crop?: string; normal?: string } }>;
}

interface Args {
  bulkType: 'default_cards' | 'unique_artwork';
  limit: number | null;
  concurrency: number;
  dbPath: string;
}

function parseArgs(argv: string[]): Args {
  // Honor PHASH_DB_PATH so the container's /data volume is used in prod
  // without callers needing to pass --db. Mirrors what the server does for
  // its scryfall cache path.
  const defaultDb =
    process.env.PHASH_DB_PATH || path.join(__dirname, '..', '..', 'data', 'phash.db');
  const out: Args = {
    bulkType: 'default_cards',
    limit: null,
    concurrency: 6,
    dbPath: defaultDb,
  };
  for (const arg of argv) {
    if (arg === '--unique-art' || arg === '--unique-artwork') out.bulkType = 'unique_artwork';
    else if (arg.startsWith('--limit=')) out.limit = parseInt(arg.slice('--limit='.length), 10);
    else if (arg.startsWith('--concurrency=')) {
      out.concurrency = Math.max(1, parseInt(arg.slice('--concurrency='.length), 10));
    } else if (arg.startsWith('--db=')) out.dbPath = arg.slice('--db='.length);
  }
  return out;
}

async function fetchBulkManifest(type: Args['bulkType']): Promise<ScryfallBulk> {
  const res = await fetch('https://api.scryfall.com/bulk-data', {
    headers: { Accept: 'application/json', 'User-Agent': 'spellcontrol-phash-ingest/1.0' },
  });
  if (!res.ok) throw new Error(`bulk-data manifest fetch failed: HTTP ${res.status}`);
  const body = (await res.json()) as { data: ScryfallBulk[] };
  const entry = body.data.find((e) => e.type === type);
  if (!entry) throw new Error(`bulk type "${type}" not found in manifest`);
  return entry;
}

/**
 * Streams JSON-array body line-by-line. Scryfall's bulk dumps are
 * pretty-printed with one card per line under the top-level array, so a
 * naive split-on-newline + trim-trailing-comma parse works and avoids
 * needing a streaming JSON library. Falls back to a single JSON.parse if
 * the dump is ever served as one big line.
 */
async function* streamBulkCards(url: string): AsyncGenerator<BulkCard> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'spellcontrol-phash-ingest/1.0' },
  });
  if (!res.ok || !res.body) throw new Error(`bulk download failed: HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let started = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nlIdx: number;
    while ((nlIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nlIdx).trim();
      buffer = buffer.slice(nlIdx + 1);
      if (!started) {
        if (line === '[') started = true;
        continue;
      }
      if (line === ']' || line.length === 0) continue;
      const json = line.endsWith(',') ? line.slice(0, -1) : line;
      try {
        yield JSON.parse(json) as BulkCard;
      } catch {
        // skip; preserves robustness if the upstream layout ever changes
      }
    }
  }
  // Flush any trailing fragment (rare; usually ends with "]").
  const tail = buffer.trim();
  if (tail && tail !== ']') {
    const json = tail.endsWith(',') ? tail.slice(0, -1) : tail;
    try {
      yield JSON.parse(json) as BulkCard;
    } catch {
      /* ignore */
    }
  }
}

function pickArtCropUrl(card: BulkCard): string | null {
  return (
    card.image_uris?.art_crop ||
    card.card_faces?.[0]?.image_uris?.art_crop ||
    card.image_uris?.normal ||
    card.card_faces?.[0]?.image_uris?.normal ||
    null
  );
}

/**
 * Downloads `url` and returns a dHash computed from its 9x8 grayscale
 * resampling. Uses sharp's default cubic resampler — small differences vs
 * the browser canvas resampler are absorbed by the Hamming-distance
 * threshold at match time.
 */
async function hashImageUrl(url: string): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'spellcontrol-phash-ingest/1.0' },
  });
  if (!res.ok) throw new Error(`image fetch failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const raw = await sharp(buf)
    .removeAlpha()
    .grayscale()
    .resize(9, 8, { fit: 'fill', kernel: 'cubic' })
    .raw()
    .toBuffer();
  if (raw.length !== 72) throw new Error(`unexpected raw length ${raw.length}`);
  const luma = new Uint8Array(raw);
  return dHashFromLuminance(luma);
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const lanes = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        await worker(items[i]);
      } catch (err) {
        console.warn('[ingest] worker error:', err);
      }
    }
  });
  await Promise.all(lanes);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[ingest] config:`, args);

  const store = new PhashStore(args.dbPath);
  const startSize = store.size();
  console.log(`[ingest] phash.db starts with ${startSize} hashes`);

  const manifest = await fetchBulkManifest(args.bulkType);
  console.log(
    `[ingest] using ${manifest.type} updated ${manifest.updated_at} (${(manifest.size / 1e6).toFixed(0)} MB)`
  );

  const existingIds = new Set<string>();
  // Pull existing IDs once so resume-skip is O(1) per card.
  {
    const probe = (store as unknown as { entries: Array<{ scryfallId: string }> }).entries;
    for (const e of probe) existingIds.add(e.scryfallId);
  }

  // First pass: decide which cards to fetch (skips digital-only, missing
  // images, and already-hashed ids). Pulling URLs into memory keeps the
  // worker pool simple — at ~90k strings × ~150 chars this is ~14 MB.
  const queue: Array<{ card: BulkCard; url: string }> = [];
  let scanned = 0;
  let skippedExisting = 0;
  let skippedNoImage = 0;
  for await (const card of streamBulkCards(manifest.download_uri)) {
    scanned++;
    if (scanned % 5000 === 0) {
      console.log(
        `[ingest] scanned ${scanned} entries, queued ${queue.length}, ` +
          `skipped ${skippedExisting} existing + ${skippedNoImage} no-image`
      );
    }
    if (card.digital) continue;
    if (card.lang && card.lang !== 'en') continue;
    if (existingIds.has(card.id)) {
      skippedExisting++;
      continue;
    }
    const url = pickArtCropUrl(card);
    if (!url) {
      skippedNoImage++;
      continue;
    }
    queue.push({ card, url });
    if (args.limit !== null && queue.length >= args.limit) break;
  }
  console.log(`[ingest] queue ready: ${queue.length} cards to hash`);

  // Second pass: hash with bounded concurrency and batched writes.
  let hashed = 0;
  let failed = 0;
  let pending: Array<{
    scryfallId: string;
    name: string;
    setCode: string;
    collectorNumber: string;
    hash: Uint8Array;
  }> = [];
  const flush = () => {
    if (pending.length === 0) return;
    store.upsertMany(pending);
    pending = [];
  };
  const startedAt = Date.now();

  await runPool(queue, args.concurrency, async ({ card, url }) => {
    try {
      const hash = await hashImageUrl(url);
      if (hash.length !== HASH_BYTES) throw new Error('bad hash length');
      pending.push({
        scryfallId: card.id,
        name: card.name,
        setCode: (card.set || '').toUpperCase(),
        collectorNumber: card.collector_number || '',
        hash,
      });
      hashed++;
      if (pending.length >= 500) flush();
      if (hashed % 1000 === 0) {
        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = hashed / Math.max(1, elapsed);
        console.log(
          `[ingest] hashed ${hashed}/${queue.length} (${rate.toFixed(1)}/s) failed=${failed}`
        );
      }
    } catch (err) {
      failed++;
      if (failed < 20) console.warn(`[ingest] hash failed for ${card.name}:`, err);
    }
  });
  flush();
  store.reloadIntoMemory();

  console.log(
    `[ingest] done: +${hashed} hashed, ${failed} failed, store now has ${store.size()} entries`
  );
  store.close();
}

main().catch((err) => {
  console.error('[ingest] fatal:', err);
  process.exit(1);
});
