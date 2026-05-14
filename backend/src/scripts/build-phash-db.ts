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

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
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
 * Downloads the bulk JSON to a local cache file so the long hash phase
 * doesn't depend on a 90-minute HTTPS stream surviving uninterrupted.
 *
 * The previous implementation streamed straight from Scryfall's CDN — fine
 * in principle, but in practice the CDN (or any intermediate proxy) will
 * close idle-feeling connections well before we've finished hashing the
 * tens of thousands of images that follow. When that happens mid-ingest
 * the script aborts and only the cards we already processed survive.
 *
 * Caching to disk decouples the two phases: the discrete download can be
 * retried as a whole if it fails, and the multi-hour hash phase reads from
 * a local file that can't time out. We keep a tiny `.meta` sidecar so we
 * know to re-download when Scryfall publishes a new dump.
 */
async function downloadBulkToCache(manifest: ScryfallBulk, cachePath: string): Promise<void> {
  const metaPath = `${cachePath}.meta`;
  // Reuse the cache if it matches the manifest we just saw — saves a 539
  // MB redownload on every re-run.
  if (fs.existsSync(cachePath) && fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
        updated_at?: string;
        size?: number;
      };
      const onDiskSize = fs.statSync(cachePath).size;
      if (meta.updated_at === manifest.updated_at && onDiskSize === manifest.size) {
        console.log(
          `[ingest] reusing cached bulk file (${(onDiskSize / 1e6).toFixed(0)} MB, ${meta.updated_at})`
        );
        return;
      }
      console.log('[ingest] cached bulk file is stale, re-downloading');
    } catch {
      // fall through to fresh download
    }
  }

  const tmpPath = `${cachePath}.partial`;
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(
        `[ingest] downloading bulk file (attempt ${attempt}/${MAX_ATTEMPTS}, ${(manifest.size / 1e6).toFixed(0)} MB)`
      );
      const res = await fetch(manifest.download_uri, {
        headers: { 'User-Agent': 'spellcontrol-phash-ingest/1.0' },
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      // Pipe body straight to disk so we never hold the whole 539 MB in
      // memory. `pipeline` propagates stream errors and cleans up on abort.
      await pipeline(
        Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
        fs.createWriteStream(tmpPath)
      );
      fs.renameSync(tmpPath, cachePath);
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          { updated_at: manifest.updated_at, size: manifest.size, downloaded_at: Date.now() },
          null,
          2
        )
      );
      console.log('[ingest] download complete');
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`[ingest] download attempt ${attempt} failed:`, err);
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
      if (attempt < MAX_ATTEMPTS) {
        const backoff = 2000 * attempt;
        console.log(`[ingest] retrying in ${backoff}ms…`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  throw new Error(`bulk download failed after ${MAX_ATTEMPTS} attempts: ${lastErr}`);
}

/**
 * Streams the locally-cached bulk JSON line-by-line. Scryfall pretty-prints
 * one card per line under a top-level array, so a naive split-on-newline +
 * trim-trailing-comma parser is enough and avoids needing a streaming JSON
 * library. Reading from a local file means there's no socket that can time
 * out partway through.
 */
async function* streamBulkCardsFromFile(filePath: string): AsyncGenerator<BulkCard> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1 << 20 });
  let buffer = '';
  let started = false;
  for await (const chunk of stream) {
    buffer += chunk;
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
        // skip malformed line; preserves robustness if upstream layout drifts
      }
    }
  }
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
 *
 * Retries a small number of times on transient fetch/decode failures. The
 * CDN occasionally serves a 5xx or drops a connection mid-image; without
 * retries those become permanently-skipped cards.
 */
async function hashImageUrl(url: string): Promise<Uint8Array> {
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
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
      return dHashFromLuminance(new Uint8Array(raw));
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 300 * attempt));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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

  // Cache the bulk file alongside the phash.db so re-runs (after a CDN
  // socket drop, a deploy, or a memory blip) don't re-download 539 MB.
  const cachePath = path.join(path.dirname(args.dbPath), `bulk-${manifest.type}.json`);
  await downloadBulkToCache(manifest, cachePath);

  const existingIds = new Set<string>();
  // Pull existing IDs once so resume-skip is O(1) per card.
  {
    const probe = (store as unknown as { entries: Array<{ scryfallId: string }> }).entries;
    for (const e of probe) existingIds.add(e.scryfallId);
  }

  // Stream-process in micro-batches so peak memory is bounded by BATCH_SIZE
  // rather than the full ~90k queue. The previous implementation
  // materialized every card-url pair before any hashing began, which OOM'd
  // on memory-constrained hosts (the production container has 256 MB).
  // With BATCH_SIZE=200 we hold at most ~200 minimal task descriptors plus
  // `concurrency` in-flight image buffers at any time.
  const BATCH_SIZE = 200;
  interface Task {
    scryfallId: string;
    name: string;
    setCode: string;
    collectorNumber: string;
    url: string;
  }
  let batch: Task[] = [];
  let pendingWrites: Array<Task & { hash: Uint8Array }> = [];
  let scanned = 0;
  let queued = 0;
  let hashed = 0;
  let failed = 0;
  let skippedExisting = 0;
  let skippedNoImage = 0;
  const startedAt = Date.now();

  const flushBatch = async (): Promise<void> => {
    if (batch.length === 0) return;
    const current = batch;
    batch = [];
    await runPool(current, args.concurrency, async (task) => {
      try {
        const hash = await hashImageUrl(task.url);
        if (hash.length !== HASH_BYTES) throw new Error('bad hash length');
        pendingWrites.push({ ...task, hash });
        hashed++;
        if (hashed % 1000 === 0) {
          const elapsed = (Date.now() - startedAt) / 1000;
          const rate = hashed / Math.max(1, elapsed);
          console.log(
            `[ingest] hashed ${hashed}/${queued} (${rate.toFixed(1)}/s) failed=${failed}`
          );
        }
      } catch (err) {
        failed++;
        if (failed < 20) console.warn(`[ingest] hash failed for ${task.name}:`, err);
      }
    });
    if (pendingWrites.length > 0) {
      store.upsertMany(
        pendingWrites.map((p) => ({
          scryfallId: p.scryfallId,
          name: p.name,
          setCode: p.setCode,
          collectorNumber: p.collectorNumber,
          hash: p.hash,
        }))
      );
      pendingWrites = [];
    }
  };

  for await (const card of streamBulkCardsFromFile(cachePath)) {
    scanned++;
    if (scanned % 5000 === 0) {
      console.log(
        `[ingest] scanned ${scanned} entries, queued ${queued} hashed ${hashed} ` +
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
    batch.push({
      scryfallId: card.id,
      name: card.name,
      setCode: (card.set || '').toUpperCase(),
      collectorNumber: card.collector_number || '',
      url,
    });
    queued++;
    if (batch.length >= BATCH_SIZE) await flushBatch();
    if (args.limit !== null && queued >= args.limit) break;
  }
  await flushBatch();

  console.log(
    `[ingest] done: +${hashed} hashed, ${failed} failed, store now has ${store.size()} entries`
  );
  store.close();
}

main().catch((err) => {
  console.error('[ingest] fatal:', err);
  process.exit(1);
});
