// Scanner — production matcher wrapper.
//
// Architecture: detection runs on-device (opencv finds the card quad and
// warps it to 488×680). The matching step is server-side by default — the
// warped image is posted to `POST /api/scanner/match` where the backend
// loads the full pHash + MobileCLIP embedding DBs and returns the
// classification. The frontend keeps a small on-device pHash database
// (`card-hashes.bin`, 1.2 MB) as a fallback for when the API is
// unreachable; the fallback uses pHash-only (no CLIP rerank) so accuracy
// is lower but the scanner still functions offline.
//
// Path selection: we always try the server first with a short timeout
// (`SERVER_TIMEOUT_MS`). On timeout, network error, or 5xx we fall back to
// on-device pHash. `navigator.onLine === false` short-circuits to fallback
// without even trying — saves the timeout on a known-offline device.

import { logger } from '../logger';
import { apiUrl } from '../api-base';
import { loadOpenCv } from './opencv-loader';
import { detectAndWarpCard, type Point } from './detect';
import { applyCLAHE } from './normalize';
import { hashCanvas } from './phash';
import { loadHashDb, findNearest, type Match as HashMatch } from './hash-db';

/** Raw dot-product score above which the top-1 is "confident". Must stay
 *  in lock-step with the backend matcher's CONFIDENT_SCORE. */
export const CONFIDENT_SCORE = 105;
export const BORDERLINE_SCORE = 89;
export const PHASH_CANDIDATE_K = 50;
export const BORDERLINE_TOP_N = 5;
export const PHASH_FAST_DISTANCE = 4;
export const PHASH_FAST_GAP = 6;
/** How long to wait for the server matcher before falling back to on-device. */
const SERVER_TIMEOUT_MS = 5_000;
/** JPEG quality used to encode the warped card before upload. */
const UPLOAD_JPEG_QUALITY = 0.9;

export interface ScanCandidate {
  scryfallId: string;
  rawScore: number;
  confidence: number;
}

export interface ScanTimings {
  detectMs: number;
  normalizeMs: number;
  pHashMs: number;
  pHashScanMs: number;
  /** JPEG encode time before upload. Server path only. */
  encodeMs: number;
  /** POST /api/scanner/match round-trip. */
  networkMs: number;
  totalMs: number;
}

export type ScanSource = 'server' | 'on-device';

export type ScanResult =
  | {
      kind: 'confident';
      match: ScanCandidate;
      quad: Point[];
      timings: ScanTimings;
      source: ScanSource;
    }
  | {
      kind: 'borderline';
      candidates: ScanCandidate[];
      quad?: Point[];
      timings: ScanTimings;
      source: ScanSource;
    }
  | {
      kind: 'miss';
      reason: 'no_quad' | 'low_score' | 'network_error';
      detail?: string;
      timings: ScanTimings;
      source: ScanSource;
    };

export interface ScanInput {
  source: HTMLImageElement | HTMLCanvasElement;
}

/**
 * Trigger lazy loads in parallel. Idempotent. The MobileCLIP model and
 * embedding DB no longer ship to the client; matching happens server-side.
 * The hash DB is kept as the offline fallback only.
 */
export async function prewarm(): Promise<void> {
  await Promise.all([loadOpenCv(), loadHashDb()]);
}

/**
 * Run the full scan pipeline. Detects + warps on-device, then matches
 * either via the server API (default) or via the on-device pHash fallback
 * (when offline / API unreachable).
 */
export async function scan(input: ScanInput): Promise<ScanResult> {
  const t0 = performance.now();

  const opencv = await loadOpenCv();
  const detect = await detectAndWarpCard(opencv.cv, input.source);
  const detectMs = detect.detectMs;

  if (!detect.warped) {
    return {
      kind: 'miss',
      reason: 'no_quad',
      detail: detect.reason,
      timings: emptyTimings(detectMs, t0),
      source: 'server',
    };
  }

  const quad = detect.quad ?? undefined;

  if (navigator.onLine) {
    const serverResult = await tryServerMatch(detect.warped, detectMs, quad, t0);
    if (serverResult) return serverResult;
    logger.debug('[scanner] server match unavailable — falling back to on-device pHash');
  }

  return onDeviceMatchAsync(detect.warped, detectMs, quad, t0);
}

async function tryServerMatch(
  warped: HTMLCanvasElement,
  detectMs: number,
  quad: Point[] | undefined,
  t0: number
): Promise<ScanResult | null> {
  const encodeStart = performance.now();
  const blob = await canvasToBlob(warped, 'image/jpeg', UPLOAD_JPEG_QUALITY);
  const encodeMs = performance.now() - encodeStart;
  if (!blob) {
    logger.warn('[scanner] toBlob returned null — falling back to on-device');
    return null;
  }

  const form = new FormData();
  form.append('image', blob, 'card.jpg');

  const ctrl = new AbortController();
  const timeout = window.setTimeout(() => ctrl.abort(), SERVER_TIMEOUT_MS);
  const netStart = performance.now();
  let response: Response;
  try {
    response = await fetch(apiUrl('/api/scanner/match'), {
      method: 'POST',
      body: form,
      signal: ctrl.signal,
    });
  } catch (err) {
    window.clearTimeout(timeout);
    logger.debug(
      `[scanner] server match request failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
  window.clearTimeout(timeout);
  const networkMs = performance.now() - netStart;

  if (!response.ok) {
    logger.debug(`[scanner] server match returned HTTP ${response.status}`);
    return null;
  }

  let body: ServerScanBody;
  try {
    body = (await response.json()) as ServerScanBody;
  } catch (err) {
    logger.warn(
      `[scanner] server match response not JSON: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }

  const timings: ScanTimings = {
    detectMs,
    normalizeMs: 0,
    pHashMs: 0,
    pHashScanMs: 0,
    encodeMs,
    networkMs,
    totalMs: performance.now() - t0,
  };

  return serverBodyToScanResult(body, timings, quad);
}

export type ServerScanBody =
  | { kind: 'confident'; match: ScanCandidate }
  | { kind: 'borderline'; candidates: ScanCandidate[] }
  | { kind: 'miss'; reason: 'low_score' | 'no_candidates'; detail?: string };

/** Pure mapping from a `/api/scanner/match` response body to a {@link ScanResult}.
 *  Exported for unit testing; the full network path can't run in node. */
export function serverBodyToScanResult(
  body: ServerScanBody,
  timings: ScanTimings,
  quad: Point[] | undefined
): ScanResult {
  if (body.kind === 'confident') {
    return { kind: 'confident', match: body.match, quad: quad ?? [], timings, source: 'server' };
  }
  if (body.kind === 'borderline') {
    return { kind: 'borderline', candidates: body.candidates, quad, timings, source: 'server' };
  }
  return {
    kind: 'miss',
    reason: 'low_score',
    detail: body.detail,
    timings,
    source: 'server',
  };
}

async function onDeviceMatchAsync(
  warped: HTMLCanvasElement,
  detectMs: number,
  quad: Point[] | undefined,
  t0: number
): Promise<ScanResult> {
  const hashDb = await loadHashDb();

  const normStart = performance.now();
  const normalized = applyCLAHE(warped);
  const normalizeMs = performance.now() - normStart;

  const phashStart = performance.now();
  const hash = hashCanvas(normalized);
  const pHashMs = performance.now() - phashStart;

  const scanStart = performance.now();
  const hits = findNearest(hashDb, hash, PHASH_CANDIDATE_K);
  const pHashScanMs = performance.now() - scanStart;

  const timings: ScanTimings = {
    detectMs,
    normalizeMs,
    pHashMs,
    pHashScanMs,
    encodeMs: 0,
    networkMs: 0,
    totalMs: performance.now() - t0,
  };

  return phashHitsToScanResult(hits, timings, quad);
}

/** Pure classification of pHash nearest-neighbor hits into a {@link ScanResult}.
 *  Used by the offline-fallback path; exported for direct unit testing. */
export function phashHitsToScanResult(
  hits: ReadonlyArray<HashMatch>,
  timings: ScanTimings,
  quad: Point[] | undefined
): ScanResult {
  if (hits.length === 0) {
    return {
      kind: 'miss',
      reason: 'low_score',
      detail: 'pHash returned no candidates',
      timings,
      source: 'on-device',
    };
  }

  const top = hits[0];
  const gap = hits.length > 1 ? hits[1].distance - top.distance : Infinity;

  // Confident: top is tight and clearly separated from runner-up. Without
  // CLIP this is the only confident classification the fallback can make.
  if (top.distance <= PHASH_FAST_DISTANCE && gap >= PHASH_FAST_GAP) {
    return {
      kind: 'confident',
      match: {
        scryfallId: top.scryfallId,
        rawScore: CONFIDENT_SCORE + 10,
        confidence: 0.9,
      },
      quad: quad ?? [],
      timings,
      source: 'on-device',
    };
  }

  return {
    kind: 'borderline',
    candidates: hits.slice(0, BORDERLINE_TOP_N).map(hashHitToCandidate),
    quad,
    timings,
    source: 'on-device',
  };
}

/**
 * Pure classification logic. Used by the test suite to verify threshold
 * semantics; the live pipeline goes through the server (which runs its own
 * `classify`) or the on-device pHash fast-path above.
 */
export function classify(
  candidates: ScanCandidate[],
  timings: ScanTimings,
  quad?: Point[],
  source: ScanSource = 'server'
): ScanResult {
  const top = candidates[0];
  if (top.rawScore >= CONFIDENT_SCORE) {
    return { kind: 'confident', match: top, quad: quad ?? [], timings, source };
  }
  if (top.rawScore >= BORDERLINE_SCORE) {
    return { kind: 'borderline', candidates, quad, timings, source };
  }
  return {
    kind: 'miss',
    reason: 'low_score',
    detail: `top raw score ${top.rawScore.toFixed(0)} < ${BORDERLINE_SCORE}`,
    timings,
    source,
  };
}

function hashHitToCandidate(m: HashMatch): ScanCandidate {
  return {
    scryfallId: m.scryfallId,
    rawScore: 64 - m.distance,
    confidence: Math.max(0, (64 - m.distance) / 64),
  };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

function emptyTimings(detectMs: number, t0: number): ScanTimings {
  return {
    detectMs,
    normalizeMs: 0,
    pHashMs: 0,
    pHashScanMs: 0,
    encodeMs: 0,
    networkMs: 0,
    totalMs: performance.now() - t0,
  };
}
