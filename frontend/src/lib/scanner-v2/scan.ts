// Scanner v2 — production matcher wrapper.
//
// Phase 2 integration entry point. Wraps the detect → warp → CLAHE → pHash
// → embed → cosine rerank pipeline into a single async function that
// returns a classified result (`confident` / `borderline` / `miss`) so the
// caller (CardScanner.tsx, eventually) doesn't need to know about any of
// the matcher internals or threshold tuning.
//
// Loading is fully lazy: opencv.js, the hash DB, the embedder, and the
// embedding DB are each behind their own per-session promise. The first
// call to `scan()` triggers all four loads in parallel and waits for them;
// subsequent calls reuse the already-resolved promises. Call `prewarm()`
// up front (e.g. when the camera modal opens) to overlap the loads with
// the user composing the shot.
//
// Threshold rationale (placeholders — tune against a labeled fixture):
//
//   raw score    cos sim ≈    interpretation
//   ≥ 108        ≥ 0.85       confident: top-1 is the match
//   89 ≤ s < 108 0.70 ≤ s < 0.85   borderline: surface picker UI
//   < 89         < 0.70       miss: ask user to retake
//
// Raw scores come from `rerankByCosineUuids`; both query and reference are
// L2-unit so max dot product is 127 (=> cos = 1.0). The thresholds above
// come from the Phase 2 handoff and the first batch of real-device scans
// (4/4 confident hits in the 105–123 raw-score range).

import { loadOpenCv } from './opencv-loader';
import { detectAndWarpCard } from './detect';
import { applyCLAHE } from './normalize';
import { hashCanvas, cropArtRegion } from './phash';
import { loadHashDb, findNearest, type Match } from './hash-db';
import { loadEmbedder } from './embed-loader';
import { embedCanvas } from './embed';
import {
  loadEmbeddingDb,
  rerankByCosineUuids,
  type EmbedMatch,
} from './embedding-db';

/** Raw dot-product score above which we consider the top-1 the match. */
export const CONFIDENT_SCORE = 108;
/** Raw dot-product score above which the picker UI surfaces candidates. */
export const BORDERLINE_SCORE = 89;
/** Width of the pHash candidate pool fed into the cosine reranker. */
export const PHASH_CANDIDATE_K = 50;
/** Width of the top-N surfaced when result is borderline. */
export const BORDERLINE_TOP_N = 5;

export interface ScanCandidate {
  scryfallId: string;
  /** Raw int8×fp32 dot product. Divide by 127 to recover cosine sim. */
  rawScore: number;
  /** Normalized 0..1 cosine similarity (proportional to {@link rawScore}). */
  confidence: number;
}

export interface ScanTimings {
  detectMs: number;
  normalizeMs: number;
  pHashMs: number;
  pHashScanMs: number;
  embedPreprocessMs: number;
  embedInferMs: number;
  rerankMs: number;
  totalMs: number;
}

export type ScanResult =
  | { kind: 'confident'; match: ScanCandidate; timings: ScanTimings }
  | {
      kind: 'borderline';
      candidates: ScanCandidate[];
      timings: ScanTimings;
    }
  | {
      kind: 'miss';
      reason: 'no_quad' | 'low_score';
      detail?: string;
      timings: ScanTimings;
    };

export interface ScanInput {
  source: HTMLImageElement | HTMLCanvasElement;
}

/**
 * Trigger all lazy loads (opencv, hash DB, embedder, embedding DB) in
 * parallel. Idempotent — subsequent calls are no-ops. Call when the
 * camera modal opens so the loads overlap with the user composing
 * the shot.
 */
export async function prewarm(): Promise<void> {
  await Promise.all([loadOpenCv(), loadHashDb(), loadEmbedder(), loadEmbeddingDb()]);
}

/**
 * Run the full scan pipeline. Throws only on internal-invariant
 * failures (e.g. embed output shape mismatch); recoverable conditions
 * (no quad detected, low confidence) are returned as a `miss` result.
 */
export async function scan(input: ScanInput): Promise<ScanResult> {
  const t0 = performance.now();

  // Run all four loads in parallel and grab the runtime + DB references.
  const [opencv, hashDb, , embeddingDb] = await Promise.all([
    loadOpenCv(),
    loadHashDb(),
    loadEmbedder(),
    loadEmbeddingDb(),
  ]);

  const detect = await detectAndWarpCard(opencv.cv, input.source);
  const detectMs = detect.detectMs;

  // No quad: bail out before paying the embed cost.
  if (!detect.warped) {
    return {
      kind: 'miss',
      reason: 'no_quad',
      detail: detect.reason,
      timings: emptyTimings(detectMs, t0),
    };
  }

  const normT0 = performance.now();
  const normalized = applyCLAHE(detect.warped);
  const normalizeMs = performance.now() - normT0;

  // pHash on the CLAHE'd warp; cosine on the unprocessed art crop. The
  // pHash DB was generated from sharp greyscale + DCT (CLAHE-equivalent
  // contrast normalization is built into Scryfall's reference renders).
  // Cosine references come from MobileCLIP applied to raw RGB art_crop,
  // so we use the raw warp's art region here.
  const phashT0 = performance.now();
  const hash = hashCanvas(normalized);
  const pHashMs = performance.now() - phashT0;

  const scanT0 = performance.now();
  const phashHits = findNearest(hashDb, hash, PHASH_CANDIDATE_K);
  const pHashScanMs = performance.now() - scanT0;

  if (phashHits.length === 0) {
    // Should not happen with a populated DB, but defensive.
    return {
      kind: 'miss',
      reason: 'low_score',
      detail: 'pHash returned no candidates',
      timings: {
        ...emptyTimings(detectMs, t0),
        normalizeMs,
        pHashMs,
        pHashScanMs,
      },
    };
  }

  const artCrop = cropArtRegion(detect.warped);
  const embedResult = await embedCanvas(artCrop);

  const rerankT0 = performance.now();
  const reranked = rerankByCosineUuids(
    embeddingDb,
    phashHits.map((h) => h.scryfallId),
    embedResult.embedding,
    BORDERLINE_TOP_N
  );
  const rerankMs = performance.now() - rerankT0;

  const totalMs = performance.now() - t0;
  const timings: ScanTimings = {
    detectMs,
    normalizeMs,
    pHashMs,
    pHashScanMs,
    embedPreprocessMs: embedResult.preprocessMs,
    embedInferMs: embedResult.inferMs,
    rerankMs,
    totalMs,
  };

  // No overlap between pHash hits and the embedding DB. This happens when
  // the embedding DB is a partial slice (e.g. the 2k dev artifact) or the
  // card simply isn't in either DB. Falling back to the pHash hits is
  // safer than blanket-rejecting — surface them as borderline so the
  // picker can show the user what was found.
  if (reranked.length === 0) {
    return {
      kind: 'borderline',
      candidates: phashHits.slice(0, BORDERLINE_TOP_N).map(phashToCandidate),
      timings,
    };
  }

  const candidates = reranked.map(rerankToCandidate);
  return classify(candidates, timings);
}

/**
 * Pure classification logic: given a ranked candidate list and the
 * accumulated timings, return the appropriate {@link ScanResult} variant.
 * Exported for direct unit testing — the rest of the pipeline is glued
 * to WASM loaders that don't run in node.
 */
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

function phashToCandidate(m: Match): ScanCandidate {
  // pHash distance → pseudo-confidence: Hamming 0 = perfect (1.0),
  // Hamming 64 = orthogonal (0.0). Linear maps are crude but fine for
  // the cold-DB fallback path.
  return {
    scryfallId: m.scryfallId,
    rawScore: 64 - m.distance,
    confidence: Math.max(0, (64 - m.distance) / 64),
  };
}

function emptyTimings(detectMs: number, t0: number): ScanTimings {
  return {
    detectMs,
    normalizeMs: 0,
    pHashMs: 0,
    pHashScanMs: 0,
    embedPreprocessMs: 0,
    embedInferMs: 0,
    rerankMs: 0,
    totalMs: performance.now() - t0,
  };
}

