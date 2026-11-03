// Scanner v2 — Phase 2 embedding ingest.
//
// Streams Scryfall's `unique_artwork` bulk dataset, runs the MobileCLIP2-S0
// vision encoder on each printing's `art_crop` image, L2-normalizes the
// 512-dim float embedding, quantizes to int8, and writes a packed binary
// the frontend ships to clients.
//
// Output format (little-endian):
//   bytes  0..3   magic  0x53433145 ("SC1E")
//   byte   4      schema version (1)
//   byte   5      reserved (zero)
//   bytes  6..7   uint16  embedding dim (512)
//   bytes  8..11  uint32  record count
//   bytes 12..15  reserved (zero)
//   per record (528 bytes): 512 int8 (symmetric, scale = 1/127), 16-byte UUID
//
// Cosine similarity at query time:
//   sim(q, ref) = sum_i q[i] * (ref_int8[i] / 127)
// Both q and ref are unit-length in fp32 space; the (1/127) factor is
// constant across candidates so the matcher just sorts by raw integer dot
// product. Reconstruction error per dim is < 0.4% (max), which is well below
// the cosine differences we use to discriminate near-duplicate Magic art.
//
// Inference is serialized on a single onnxruntime-node session (CPU EP) —
// the runtime is not thread-safe across concurrent .run() calls. We still
// parallelize the *fetch* side (`concurrency` controls in-flight art_crop
// downloads) so we're network-bound, not inference-bound, on a typical
// home connection.
//
// Model + outputs live under `backend/data/scanner/` — the matcher loads
// them at boot and they ship in the Docker image. Embeddings are no longer
// pushed to the frontend (server-side matching only).

import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { pipeForwardingErrors } from '../stream-utils';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import { logger } from '../logger';
import { fetchScryfallBulkEntry, streamBulkJsonl } from '../scryfall-bulk';
import { assertWriteFloor, extractArtUrl, fetchArtBytes } from './ingest-guards';
import { uuidToBytes } from './hash-ingest';

const SCRYFALL_UA = 'spellcontrol/1.0 (scanner-v2-embedding-ingest)';
const MAGIC_LE = 0x45314353; // "SC1E" in little-endian byte order
const SCHEMA_VERSION = 1;
const HEADER_BYTES = 16;
export const EMBED_DIM = 512;
export const EMBED_INPUT_SIZE = 256;
const RECORD_BYTES = EMBED_DIM + 16; // 512 int8 + 16-byte UUID = 528
const DEFAULT_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 20_000;
const QUANT_SCALE = 127;

export interface EmbeddingIngestOptions {
  /** Path to the MobileCLIP2-S0 vision encoder ONNX. */
  modelPath: string;
  /** Output path for the packed binary. Atomic via {path}.tmp + rename. */
  outPath: string;
  /** If set, stop after this many successfully-embedded cards. */
  limit?: number;
  /** Concurrent in-flight art_crop fetches. Default {@link DEFAULT_CONCURRENCY}. */
  concurrency?: number;
  /** Override the bulk-data lookup (testing / cached URL). */
  bulkDownloadUrl?: string;
}

export interface EmbeddingIngestResult {
  totalSeen: number;
  written: number;
  skipped: number;
  bytes: number;
  elapsedMs: number;
}

interface ScryfallCard {
  id?: unknown;
  image_uris?: { art?: unknown; art_crop?: unknown } | null;
  card_faces?: Array<{ image_uris?: { art?: unknown; art_crop?: unknown } | null }> | null;
}

/**
 * Delegates to the shared resolver. This file used to carry its own copy that
 * read the long-gone `download_uri` field — the third of three independent
 * copies that all broke together when Scryfall renamed it.
 */
export async function getUniqueArtworkDownloadUrl(): Promise<string> {
  return (await fetchScryfallBulkEntry('unique_artwork')).url;
}

export async function* streamUniqueArtwork(urlOrPath: string): AsyncIterable<ScryfallCard> {
  // Remote reads go through the shared JSONL reader, which saves the feed to a
  // temp file (retry + Range resume) and parses from disk, so upstream socket
  // health is decoupled from this ingest's slow per-card inference rate.
  if (/^https?:\/\//i.test(urlOrPath)) {
    yield* streamBulkJsonl<ScryfallCard>(urlOrPath);
    return;
  }

  const file = createReadStream(urlOrPath);
  const lines = createInterface({
    input: urlOrPath.endsWith('.gz') ? pipeForwardingErrors(file, createGunzip()) : file,
    crlfDelay: Infinity,
  });
  try {
    for await (const line of lines) {
      if (line) yield JSON.parse(line) as ScryfallCard;
    }
  } finally {
    lines.close();
    file.destroy();
  }
}

/**
 * Fetch the art_crop, resize to 256×256 RGB via sharp, and produce the
 * planar NCHW float32 tensor MobileCLIP2-S0 expects. The preprocessor
 * config is mean=0/std=1 → just pixel/255. Caller takes ownership of the
 * returned Float32Array.
 */
export async function fetchPreprocessedArtCrop(card: ScryfallCard): Promise<Float32Array | null> {
  const url = extractArtUrl(card);
  if (!url) return null;

  const bytes = await fetchArtBytes(url, SCRYFALL_UA, FETCH_TIMEOUT_MS);
  if (!bytes) return null;

  // Match the frontend's preprocessing exactly: stretch to EMBED_INPUT_SIZE
  // (no aspect preservation), drop alpha, planar NCHW, divide by 255. The
  // frontend uses `drawImage(... , 256, 256)` which is libvips' `fit: 'fill'`.
  const raw = await sharp(Buffer.from(bytes))
    .resize(EMBED_INPUT_SIZE, EMBED_INPUT_SIZE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();
  const expectedBytes = EMBED_INPUT_SIZE * EMBED_INPUT_SIZE * 3;
  if (raw.length !== expectedBytes) return null;

  const planeSize = EMBED_INPUT_SIZE * EMBED_INPUT_SIZE;
  const out = new Float32Array(3 * planeSize);
  for (let i = 0, p = 0; i < raw.length; i += 3, p++) {
    out[p] = raw[i] / 255;
    out[planeSize + p] = raw[i + 1] / 255;
    out[2 * planeSize + p] = raw[i + 2] / 255;
  }
  return out;
}

/**
 * L2-normalize in place. Returns the original-vector magnitude so callers
 * can detect degenerate (all-zero) outputs.
 */
export function l2NormalizeInPlace(vec: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
  const mag = Math.sqrt(sumSq);
  if (mag <= 0) return 0;
  const inv = 1 / mag;
  for (let i = 0; i < vec.length; i++) vec[i] *= inv;
  return mag;
}

/**
 * Symmetric int8 quantization: value * 127, round, clamp to [-127, 127].
 * Reserves -128 (unused) so the dot product can run in 16-bit accumulator
 * lanes downstream if we ever want WASM SIMD on the matcher.
 */
export function quantizeToInt8(vec: Float32Array): Int8Array {
  const out = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    const v = Math.round(vec[i] * QUANT_SCALE);
    out[i] = v > 127 ? 127 : v < -127 ? -127 : v;
  }
  return out;
}

/**
 * Build the planar-NCHW input tensor for MobileCLIP2-S0 and run inference.
 * Returns the L2-normalized fp32 embedding. Caller passes the shared
 * session — sessions are not thread-safe so all inferences serialize here.
 */
export async function embedTensor(
  session: ort.InferenceSession,
  tensorData: Float32Array
): Promise<Float32Array> {
  const tensor = new ort.Tensor('float32', tensorData, [1, 3, EMBED_INPUT_SIZE, EMBED_INPUT_SIZE]);
  const outputs = await session.run({ pixel_values: tensor });
  const out = outputs.image_embeds ?? outputs[session.outputNames[0]];
  if (!out) throw new Error('embedding-ingest: session missing image_embeds output');
  const raw = out.data as Float32Array;
  if (raw.length !== EMBED_DIM) {
    throw new Error(`embedding-ingest: expected ${EMBED_DIM} dims, got ${raw.length}`);
  }
  // Copy out before we run again — ORT reuses output buffers across runs.
  const copy = new Float32Array(raw);
  l2NormalizeInPlace(copy);
  return copy;
}

export async function ingestCardEmbeddings(
  opts: EmbeddingIngestOptions
): Promise<EmbeddingIngestResult> {
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const startedAt = Date.now();
  let totalSeen = 0;
  let written = 0;
  let skipped = 0;

  logger.info(`[embedding-ingest] loading model: ${opts.modelPath}`);
  const session = await ort.InferenceSession.create(opts.modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });
  logger.info(
    `[embedding-ingest] session ready (inputs=${session.inputNames.join(',')}, outputs=${session.outputNames.join(',')})`
  );

  const url = opts.bulkDownloadUrl ?? (await getUniqueArtworkDownloadUrl());
  logger.info(`[embedding-ingest] streaming unique_artwork from ${url}`);

  // Inference mutex — onnxruntime-node sessions can't run concurrently.
  // We still parallelize fetch+preprocess; inference happens behind this
  // queue, which is fine because inference (~200ms) is comparable to image
  // download time on a home connection.
  let inferQueue: Promise<unknown> = Promise.resolve();

  const records: Array<{ embedding: Int8Array; uuid: Buffer }> = [];
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
        const tensor = await fetchPreprocessedArtCrop(card);
        if (!tensor) {
          skipped++;
          return;
        }
        // Chain onto the inference queue so .run() calls serialize cleanly.
        const inferPromise = inferQueue.then(() => embedTensor(session, tensor));
        inferQueue = inferPromise.catch(() => undefined);
        const normalized = await inferPromise;
        records.push({
          embedding: quantizeToInt8(normalized),
          uuid: uuidToBytes(idVal),
        });
        written++;
        if (written % 250 === 0) {
          const rate = written / ((Date.now() - startedAt) / 1000);
          logger.info(
            `[embedding-ingest] ${written} written / ${skipped} skipped / ${totalSeen} seen (${rate.toFixed(1)}/s)`
          );
        }
      } catch (err) {
        skipped++;
        logger.warn(
          `[embedding-ingest] skip ${typeof card.id === 'string' ? card.id : '(no id)'}: ${err instanceof Error ? err.message : String(err)}`
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

  const buf = packEmbeddingBinary(records);
  await assertWriteFloor({
    label: 'embedding-ingest',
    outPath: opts.outPath,
    newCount: records.length,
    limited: Boolean(opts.limit),
  });
  await fs.mkdir(path.dirname(opts.outPath), { recursive: true });
  const tmp = `${opts.outPath}.tmp`;
  await fs.writeFile(tmp, buf);
  await fs.rename(tmp, opts.outPath);

  await session.release();

  const elapsedMs = Date.now() - startedAt;
  logger.info(
    `[embedding-ingest] done: ${written} written, ${skipped} skipped of ${totalSeen} seen in ${elapsedMs}ms → ${opts.outPath} (${buf.length} bytes)`
  );
  return { totalSeen, written, skipped, bytes: buf.length, elapsedMs };
}

export function packEmbeddingBinary(
  records: ReadonlyArray<{ embedding: Int8Array; uuid: Buffer }>
): Buffer {
  const total = HEADER_BYTES + records.length * RECORD_BYTES;
  const buf = Buffer.alloc(total);
  buf.writeUInt32LE(MAGIC_LE, 0);
  buf.writeUInt8(SCHEMA_VERSION, 4);
  // byte 5 reserved
  buf.writeUInt16LE(EMBED_DIM, 6);
  buf.writeUInt32LE(records.length, 8);
  // bytes 12..15 reserved
  let cursor = HEADER_BYTES;
  for (const r of records) {
    if (r.embedding.length !== EMBED_DIM) {
      throw new Error(`record embedding must be ${EMBED_DIM} dims, got ${r.embedding.length}`);
    }
    if (r.uuid.length !== 16) {
      throw new Error(`record uuid must be 16 bytes, got ${r.uuid.length}`);
    }
    Buffer.from(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength).copy(
      buf,
      cursor
    );
    r.uuid.copy(buf, cursor + EMBED_DIM);
    cursor += RECORD_BYTES;
  }
  return buf;
}
