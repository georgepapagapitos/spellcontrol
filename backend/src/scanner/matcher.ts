// Server-side scanner matcher.
//
// Mirrors `frontend/src/lib/scanner/scan.ts` end-to-end: input is a card
// image (the warped, perspective-corrected card crop produced on-device by
// opencv), output is a {confident, borderline, miss} classification with
// the matched Scryfall UUID and timings.
//
// Two-stage match:
//   1. pHash 64-bit DCT hash → top-K candidates in ~5-15ms (52k records).
//   2. Either:
//        a. Fast-path: top-1 Hamming ≤ PHASH_FAST_DISTANCE and gap ≥
//           PHASH_FAST_GAP → skip CLIP, return confident.
//        b. MobileCLIP2-S0 embed (CPU EP, ~150-250ms) + cosine rerank over
//           the pHash top-K.
//
// The hash + embedding databases and the ONNX session are loaded once at
// server boot (see `getMatcher()`). Concurrent match requests share the
// in-memory DBs (read-only) but serialize on the ONNX session via a
// promise-chain queue (onnxruntime-node sessions aren't thread-safe).

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import { logger } from '../logger';
import { computePHash, PHASH_INPUT_SIZE } from './phash';
import { loadHashDbFromFile, findNearest, type HashDb, type HashMatch } from './hash-db';
import {
  loadEmbeddingDbFromFile,
  rerankByCosineUuids,
  type EmbeddingDb,
  type EmbedMatch,
} from './embedding-db';

/** Raw dot-product score above which the top-1 is "confident". Must stay
 *  in lock-step with the frontend's CONFIDENT_SCORE — same threshold tuned
 *  against the same on-device captures (lowered from 108 → 105). */
export const CONFIDENT_SCORE = 105;
/** Raw dot-product score above which candidates surface as a picker. */
export const BORDERLINE_SCORE = 89;
/** Width of the pHash candidate pool fed into the cosine reranker. */
export const PHASH_CANDIDATE_K = 50;
/** Width of the top-N surfaced when the result is borderline. */
export const BORDERLINE_TOP_N = 5;
/** Max Hamming distance for the pHash fast-path. */
export const PHASH_FAST_DISTANCE = 4;
/** Min Hamming-distance gap between top-1 and runner-up to take fast path. */
export const PHASH_FAST_GAP = 6;
/** Side length of the MobileCLIP image input (planar NCHW 3×256×256). */
export const EMBED_INPUT_SIZE = 256;
/** Output dim of the MobileCLIP2-S0 vision encoder. */
export const EMBED_DIM = 512;

export interface ScanCandidate {
  scryfallId: string;
  rawScore: number;
  confidence: number;
}

export interface ScanTimings {
  decodeMs: number;
  pHashMs: number;
  pHashScanMs: number;
  embedPreprocessMs: number;
  embedInferMs: number;
  rerankMs: number;
  totalMs: number;
}

export type ScanResult =
  | { kind: 'confident'; match: ScanCandidate; timings: ScanTimings }
  | { kind: 'borderline'; candidates: ScanCandidate[]; timings: ScanTimings }
  | { kind: 'miss'; reason: 'low_score' | 'no_candidates'; detail?: string; timings: ScanTimings };

export interface Matcher {
  match(imageBuffer: Buffer): Promise<ScanResult>;
  /** Diagnostic stats: how many records each DB holds. */
  stats(): { hashDb: number; embeddingDb: number };
  /** Release the ONNX session (tests / shutdown). */
  close(): Promise<void>;
}

export interface MatcherOptions {
  /** Directory containing card-hashes.bin, card-embeddings.bin, embed/vision_model.onnx. */
  dataDir: string;
}

/**
 * Build a matcher. Loads the hash + embedding DBs and the ONNX session
 * concurrently — the embedding session is the bottleneck (~1-2s cold). The
 * returned matcher is safe to share across concurrent requests; inference
 * is serialized internally on a promise queue.
 */
export async function createMatcher(opts: MatcherOptions): Promise<Matcher> {
  const hashPath = path.join(opts.dataDir, 'card-hashes.bin');
  const embeddingPath = path.join(opts.dataDir, 'card-embeddings.bin');
  const modelPath = path.join(opts.dataDir, 'embed', 'vision_model.onnx');

  logger.info(`[matcher] loading from ${opts.dataDir}`);
  const t0 = Date.now();
  const [hashDb, embeddingDb, session] = await Promise.all([
    loadHashDbFromFile(hashPath),
    loadEmbeddingDbFromFile(embeddingPath),
    ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    }),
  ]);
  logger.info(
    `[matcher] ready in ${Date.now() - t0}ms — hashes=${hashDb.recordCount}, embeddings=${embeddingDb.recordCount}`
  );

  // Inference mutex — onnxruntime-node sessions are not thread-safe.
  let inferQueue: Promise<unknown> = Promise.resolve();
  function serializeInference<T>(work: () => Promise<T>): Promise<T> {
    const next = inferQueue.then(work);
    inferQueue = next.catch(() => undefined);
    return next;
  }

  return {
    async match(imageBuffer: Buffer): Promise<ScanResult> {
      return runMatch(imageBuffer, hashDb, embeddingDb, session, serializeInference);
    },
    stats() {
      return { hashDb: hashDb.recordCount, embeddingDb: embeddingDb.recordCount };
    },
    async close() {
      await session.release();
    },
  };
}

async function runMatch(
  imageBuffer: Buffer,
  hashDb: HashDb,
  embeddingDb: EmbeddingDb,
  session: ort.InferenceSession,
  serializeInference: <T>(work: () => Promise<T>) => Promise<T>
): Promise<ScanResult> {
  const t0 = Date.now();

  // Decode the image once with sharp, fork into two preprocessing branches:
  // a 32×32 grey buffer for pHash and a 256×256 RGB tensor for CLIP. Sharp
  // amortizes the heavy decode (libvips); each downstream resize is cheap.
  const image = sharp(imageBuffer);
  const decodeStart = Date.now();
  const phashRawPromise = image
    .clone()
    .resize(PHASH_INPUT_SIZE, PHASH_INPUT_SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();
  const embedRawPromise = image
    .clone()
    .resize(EMBED_INPUT_SIZE, EMBED_INPUT_SIZE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();
  const [phashRaw, embedRaw] = await Promise.all([phashRawPromise, embedRawPromise]);
  const decodeMs = Date.now() - decodeStart;

  if (phashRaw.length !== PHASH_INPUT_SIZE * PHASH_INPUT_SIZE) {
    return missResult('no_candidates', 'pHash preprocess produced wrong byte count', t0, decodeMs);
  }

  const pHashStart = Date.now();
  const hash = computePHash(new Uint8Array(phashRaw.buffer, phashRaw.byteOffset, phashRaw.length));
  const pHashMs = Date.now() - pHashStart;

  const scanStart = Date.now();
  const phashHits = findNearest(hashDb, hash, PHASH_CANDIDATE_K);
  const pHashScanMs = Date.now() - scanStart;

  if (phashHits.length === 0) {
    return missResult(
      'no_candidates',
      'pHash returned no candidates',
      t0,
      decodeMs,
      pHashMs,
      pHashScanMs
    );
  }

  // Fast-path: pHash unambiguous → skip the ~200ms CLIP inference. Mirrors
  // the frontend short-circuit so on-device and server agree on borderline
  // boundaries.
  const phashTop = phashHits[0];
  const phashGap = phashHits.length > 1 ? phashHits[1].distance - phashTop.distance : Infinity;
  if (phashTop.distance <= PHASH_FAST_DISTANCE && phashGap >= PHASH_FAST_GAP) {
    return {
      kind: 'confident',
      match: {
        scryfallId: phashTop.scryfallId,
        rawScore: CONFIDENT_SCORE + 10,
        confidence: 0.95,
      },
      timings: {
        decodeMs,
        pHashMs,
        pHashScanMs,
        embedPreprocessMs: 0,
        embedInferMs: 0,
        rerankMs: 0,
        totalMs: Date.now() - t0,
      },
    };
  }

  if (embedRaw.length !== EMBED_INPUT_SIZE * EMBED_INPUT_SIZE * 3) {
    return missResult(
      'no_candidates',
      'CLIP preprocess produced wrong byte count',
      t0,
      decodeMs,
      pHashMs,
      pHashScanMs
    );
  }

  const embedPreprocessStart = Date.now();
  const tensorData = toPlanarNCHW(embedRaw);
  const embedPreprocessMs = Date.now() - embedPreprocessStart;

  const embedInferStart = Date.now();
  const embedding = await serializeInference(() => embedTensor(session, tensorData));
  const embedInferMs = Date.now() - embedInferStart;

  const rerankStart = Date.now();
  const reranked = rerankByCosineUuids(
    embeddingDb,
    phashHits.map((h) => h.scryfallId),
    embedding,
    BORDERLINE_TOP_N
  );
  const rerankMs = Date.now() - rerankStart;

  const timings: ScanTimings = {
    decodeMs,
    pHashMs,
    pHashScanMs,
    embedPreprocessMs,
    embedInferMs,
    rerankMs,
    totalMs: Date.now() - t0,
  };

  if (reranked.length === 0) {
    // pHash hits weren't in the embedding DB (rare — usually a partial-DB
    // dev artifact). Surface pHash candidates as borderline.
    return {
      kind: 'borderline',
      candidates: phashHits.slice(0, BORDERLINE_TOP_N).map(phashToCandidate),
      timings,
    };
  }

  const candidates = reranked.map(rerankToCandidate);
  return classify(candidates, timings);
}

export function classify(candidates: ScanCandidate[], timings: ScanTimings): ScanResult {
  const top = candidates[0];
  if (top.rawScore >= CONFIDENT_SCORE) {
    return { kind: 'confident', match: top, timings };
  }
  if (top.rawScore >= BORDERLINE_SCORE) {
    return { kind: 'borderline', candidates, timings };
  }
  return {
    kind: 'miss',
    reason: 'low_score',
    detail: `top raw score ${top.rawScore.toFixed(0)} < ${BORDERLINE_SCORE}`,
    timings,
  };
}

function rerankToCandidate(m: EmbedMatch): ScanCandidate {
  return {
    scryfallId: m.scryfallId,
    rawScore: m.similarity,
    confidence: Math.max(0, Math.min(1, m.similarity / 127)),
  };
}

function phashToCandidate(m: HashMatch): ScanCandidate {
  return {
    scryfallId: m.scryfallId,
    rawScore: 64 - m.distance,
    confidence: Math.max(0, (64 - m.distance) / 64),
  };
}

/** Convert HWC byte interleaved → planar NCHW float32 in [0, 1]. Matches
 *  the frontend's `embed.ts` preprocessing byte-for-byte. */
function toPlanarNCHW(raw: Uint8Array): Float32Array {
  const planeSize = EMBED_INPUT_SIZE * EMBED_INPUT_SIZE;
  const out = new Float32Array(3 * planeSize);
  for (let i = 0, p = 0; i < raw.length; i += 3, p++) {
    out[p] = raw[i] / 255;
    out[planeSize + p] = raw[i + 1] / 255;
    out[2 * planeSize + p] = raw[i + 2] / 255;
  }
  return out;
}

async function embedTensor(
  session: ort.InferenceSession,
  tensorData: Float32Array
): Promise<Float32Array> {
  const tensor = new ort.Tensor('float32', tensorData, [1, 3, EMBED_INPUT_SIZE, EMBED_INPUT_SIZE]);
  const outputs = await session.run({ pixel_values: tensor });
  const out = outputs.image_embeds ?? outputs[session.outputNames[0]];
  if (!out) throw new Error('matcher: session missing image_embeds output');
  const raw = out.data as Float32Array;
  if (raw.length !== EMBED_DIM) {
    throw new Error(`matcher: expected ${EMBED_DIM} dims, got ${raw.length}`);
  }
  const copy = new Float32Array(raw);
  l2NormalizeInPlace(copy);
  return copy;
}

function l2NormalizeInPlace(vec: Float32Array): void {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
  const mag = Math.sqrt(sumSq);
  if (mag <= 0) return;
  const inv = 1 / mag;
  for (let i = 0; i < vec.length; i++) vec[i] *= inv;
}

function missResult(
  reason: 'low_score' | 'no_candidates',
  detail: string,
  t0: number,
  decodeMs: number,
  pHashMs = 0,
  pHashScanMs = 0
): ScanResult {
  return {
    kind: 'miss',
    reason,
    detail,
    timings: {
      decodeMs,
      pHashMs,
      pHashScanMs,
      embedPreprocessMs: 0,
      embedInferMs: 0,
      rerankMs: 0,
      totalMs: Date.now() - t0,
    },
  };
}

/**
 * Process-wide singleton. Lazily initialized on the first call so an unset
 * data dir during dev (or a test run that doesn't exercise the scanner)
 * doesn't crash boot. Returns `null` when the data files are missing — the
 * route handler turns that into a 503 with a clear message rather than
 * failing the whole server.
 */
let matcherPromise: Promise<Matcher | null> | null = null;

export function getMatcher(dataDir: string): Promise<Matcher | null> {
  if (matcherPromise) return matcherPromise;
  matcherPromise = (async () => {
    try {
      await Promise.all([
        fs.access(path.join(dataDir, 'card-hashes.bin')),
        fs.access(path.join(dataDir, 'card-embeddings.bin')),
        fs.access(path.join(dataDir, 'embed', 'vision_model.onnx')),
      ]);
    } catch {
      logger.warn(`[matcher] data files missing under ${dataDir} — scanner endpoint disabled`);
      return null;
    }
    return createMatcher({ dataDir });
  })();
  return matcherPromise;
}

/** Test helper — drop the cached singleton so a fresh load can be exercised. */
export function resetMatcherForTests(): void {
  matcherPromise = null;
}
