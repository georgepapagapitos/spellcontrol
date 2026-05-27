// Scanner v2 — Phase 1 hash ingest.
//
// Downloads Scryfall's `unique_artwork` bulk dataset, computes a 64-bit
// DCT-based pHash on each printing's `art_crop` image, and writes a packed
// binary file the frontend ships to clients. ~90k entries → ~2 MB output.
//
// Output format (little-endian):
//   bytes  0..3   magic  0x53433148 ("SC1H")
//   byte   4      schema version (1)
//   bytes  5..7   reserved (zero)
//   bytes  8..11  uint32  record count
//   bytes 12..15  reserved (zero)
//   per record (24 bytes): uint64 pHash, 16-byte UUID (Scryfall id raw bytes)
//
// Stateless / idempotent: each run produces a fresh file, atomically renamed
// into place at the end. A network blip mid-run loses the partial write but
// not the previous artifact — the rename happens only on full success.

import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import sharp from 'sharp';
import streamArray from 'stream-json/streamers/stream-array.js';
import { logger } from '../logger';
import { computePHash, PHASH_INPUT_SIZE } from './phash';

const SCRYFALL_BULK_URL = 'https://api.scryfall.com/bulk-data';
const SCRYFALL_UA = 'spellcontrol/1.0 (scanner-v2-hash-ingest)';
const MAGIC_LE = 0x48314353; // "SC1H" in little-endian byte order
const SCHEMA_VERSION = 1;
const HEADER_BYTES = 16;
const RECORD_BYTES = 24; // 8 hash + 16 UUID
const DEFAULT_CONCURRENCY = 6;
const FETCH_TIMEOUT_MS = 15_000;

export interface IngestOptions {
  /** Output path for the packed binary. Atomic via {path}.tmp + rename. */
  outPath: string;
  /** If set, stop after this many successfully-hashed cards. Dev convenience. */
  limit?: number;
  /** Concurrent in-flight art_crop fetches. Default {@link DEFAULT_CONCURRENCY}. */
  concurrency?: number;
  /** Override the bulk-data lookup (testing / cached URL). */
  bulkDownloadUrl?: string;
}

export interface IngestResult {
  totalSeen: number;
  written: number;
  skipped: number;
  bytes: number;
  elapsedMs: number;
}

interface ScryfallBulkEntry {
  type: string;
  download_uri: string;
  updated_at: string;
}

interface ScryfallCard {
  id?: unknown;
  image_uris?: { art_crop?: unknown } | null;
  card_faces?: Array<{ image_uris?: { art_crop?: unknown } | null }> | null;
}

/**
 * Look up the canonical `unique_artwork` download URI. Scryfall's bulk-data
 * URLs are versioned; resolving live here keeps us pulling the freshest
 * dataset without baking a URL into source.
 */
export async function getUniqueArtworkDownloadUrl(): Promise<string> {
  const res = await fetch(SCRYFALL_BULK_URL, {
    headers: { 'User-Agent': SCRYFALL_UA, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Scryfall /bulk-data failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { data?: ScryfallBulkEntry[] };
  const entry = body.data?.find((e) => e.type === 'unique_artwork');
  if (!entry) {
    throw new Error('Scryfall /bulk-data missing `unique_artwork` entry');
  }
  return entry.download_uri;
}

/**
 * Stream the Scryfall bulk-data JSON array, yielding one card object at a
 * time. Mirrors the streaming pattern in `combos/ingest.ts` to bound peak
 * memory regardless of dataset size.
 *
 * Caller break-out (e.g. `--limit`) closes the underlying fetch via the
 * abort controller in the `finally` — otherwise undici lets the HTTP/2
 * stream dangle and surfaces a NGHTTP2_PROTOCOL_ERROR seconds after we
 * thought we were done.
 */
export async function* streamUniqueArtwork(url: string): AsyncIterable<ScryfallCard> {
  const ctrl = new AbortController();
  const res = await fetch(url, {
    headers: { 'User-Agent': SCRYFALL_UA, Accept: 'application/json' },
    signal: ctrl.signal,
  });
  if (!res.ok) throw new Error(`unique_artwork download failed: HTTP ${res.status}`);
  if (!res.body) throw new Error('unique_artwork response missing body');

  const nodeStream = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);
  const pipeline = nodeStream.pipe(streamArray.withParserAsStream());
  try {
    for await (const item of pipeline as AsyncIterable<{ value: unknown }>) {
      yield item.value as ScryfallCard;
    }
  } finally {
    // `return()` on a broken-out iterator runs this; abort propagates down
    // to undici and tears the HTTP/2 stream cleanly instead of letting it
    // time out.
    ctrl.abort();
    nodeStream.destroy();
  }
}

/**
 * Pull a printing's art_crop, resize to 32×32 grayscale via sharp, and
 * compute its pHash. Returns null for cards without art_crop (e.g. tokens
 * with no front face, double-faced shells, etc.) — callers skip those.
 */
export async function fetchAndHashArtCrop(card: ScryfallCard): Promise<bigint | null> {
  const url = extractArtCropUrl(card);
  if (!url) return null;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let bytes: ArrayBuffer;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': SCRYFALL_UA },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    bytes = await res.arrayBuffer();
  } finally {
    clearTimeout(timeout);
  }

  // sharp normalizes to single-channel greyscale and resamples via libvips.
  // The raw output is row-major byte-per-pixel, exactly what computePHash
  // expects.
  const raw = await sharp(Buffer.from(bytes))
    .resize(PHASH_INPUT_SIZE, PHASH_INPUT_SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();
  if (raw.length !== PHASH_INPUT_SIZE * PHASH_INPUT_SIZE) {
    return null;
  }
  return computePHash(new Uint8Array(raw.buffer, raw.byteOffset, raw.length));
}

function extractArtCropUrl(card: ScryfallCard): string | null {
  const direct = card.image_uris?.art_crop;
  if (typeof direct === 'string' && direct) return direct;
  // Double-faced cards put image_uris on each face. We take face 0 (front)
  // as canonical — back-side hashing is a later enhancement.
  const face0 = card.card_faces?.[0]?.image_uris?.art_crop;
  if (typeof face0 === 'string' && face0) return face0;
  return null;
}

/**
 * Parse a Scryfall UUID into its 16-byte raw form. UUIDs are
 * `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`; stripping hyphens leaves 32 hex
 * chars = 16 bytes. Throws on malformed input so a bad id can't silently
 * write garbage into the binary.
 */
export function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32 || !/^[0-9a-f]{32}$/i.test(hex)) {
    throw new Error(`invalid UUID: ${uuid}`);
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Drive the full ingest: stream cards, hash with bounded concurrency,
 * collect into an in-memory list (cheap — 24 bytes × ~90k), write the
 * header + records to `{outPath}.tmp`, then rename atomically.
 *
 * Concurrency is implemented via a simple worker pool so a slow image
 * doesn't block the whole stream.
 */
export async function ingestCardHashes(opts: IngestOptions): Promise<IngestResult> {
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const startedAt = Date.now();
  let totalSeen = 0;
  let written = 0;
  let skipped = 0;

  const url = opts.bulkDownloadUrl ?? (await getUniqueArtworkDownloadUrl());
  logger.info(`[hash-ingest] streaming unique_artwork from ${url}`);

  // Accumulate as Buffer pairs (hash + uuid) for stable on-disk order
  // independent of fetch completion order.
  const records: Array<{ hash: bigint; uuid: Buffer }> = [];

  // Bounded worker pool: keep `concurrency` fetches in flight.
  const inflight = new Set<Promise<void>>();
  for await (const card of streamUniqueArtwork(url)) {
    totalSeen++;
    if (opts.limit && written + inflight.size >= opts.limit) break;

    const job = (async () => {
      try {
        const idVal = card.id;
        if (typeof idVal !== 'string') {
          skipped++;
          return;
        }
        const hash = await fetchAndHashArtCrop(card);
        if (hash === null) {
          skipped++;
          return;
        }
        records.push({ hash, uuid: uuidToBytes(idVal) });
        written++;
        if (written % 500 === 0) {
          logger.info(`[hash-ingest] ${written} written / ${skipped} skipped / ${totalSeen} seen`);
        }
      } catch (err) {
        skipped++;
        logger.warn(
          `[hash-ingest] skip ${typeof card.id === 'string' ? card.id : '(no id)'}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })();
    inflight.add(job);
    job.finally(() => inflight.delete(job));

    if (inflight.size >= concurrency) {
      await Promise.race(inflight);
    }
  }
  await Promise.all(inflight);

  const buf = packBinary(records);
  await fs.mkdir(path.dirname(opts.outPath), { recursive: true });
  const tmp = `${opts.outPath}.tmp`;
  await fs.writeFile(tmp, buf);
  await fs.rename(tmp, opts.outPath);

  const elapsedMs = Date.now() - startedAt;
  logger.info(
    `[hash-ingest] done: ${written} written, ${skipped} skipped of ${totalSeen} seen in ${elapsedMs}ms → ${opts.outPath} (${buf.length} bytes)`
  );
  return { totalSeen, written, skipped, bytes: buf.length, elapsedMs };
}

/** Pack records into the documented header+body binary format. */
export function packBinary(records: ReadonlyArray<{ hash: bigint; uuid: Buffer }>): Buffer {
  const total = HEADER_BYTES + records.length * RECORD_BYTES;
  const buf = Buffer.alloc(total);
  buf.writeUInt32LE(MAGIC_LE, 0);
  buf.writeUInt8(SCHEMA_VERSION, 4);
  // bytes 5..7 stay zero (reserved)
  buf.writeUInt32LE(records.length, 8);
  // bytes 12..15 stay zero (reserved)
  let cursor = HEADER_BYTES;
  for (const r of records) {
    if (r.uuid.length !== 16) {
      throw new Error(`record uuid must be 16 bytes, got ${r.uuid.length}`);
    }
    buf.writeBigUInt64LE(r.hash, cursor);
    r.uuid.copy(buf, cursor + 8);
    cursor += RECORD_BYTES;
  }
  return buf;
}
