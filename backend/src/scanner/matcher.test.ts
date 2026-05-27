// Unit tests for the server-side matcher's pure pieces. The full pipeline
// (sharp decode + ONNX inference + DB load) is exercised by the route
// smoke test in routes/scanner.test.ts where a real card image gets
// matched end-to-end.

import { describe, it, expect } from 'vitest';
import {
  classify,
  CONFIDENT_SCORE,
  BORDERLINE_SCORE,
  BORDERLINE_TOP_N,
  PHASH_CANDIDATE_K,
  type ScanCandidate,
  type ScanTimings,
} from './matcher';

const ZERO_TIMINGS: ScanTimings = {
  decodeMs: 0,
  pHashMs: 0,
  pHashScanMs: 0,
  embedPreprocessMs: 0,
  embedInferMs: 0,
  rerankMs: 0,
  totalMs: 0,
};

function mkCandidate(rawScore: number, id = '11111111-1111-1111-1111-111111111111'): ScanCandidate {
  return { scryfallId: id, rawScore, confidence: rawScore / 127 };
}

describe('classify', () => {
  it('returns confident at the confident threshold', () => {
    const r = classify([mkCandidate(CONFIDENT_SCORE)], ZERO_TIMINGS);
    expect(r.kind).toBe('confident');
  });

  it('returns confident well above threshold', () => {
    const r = classify(
      [mkCandidate(120, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), mkCandidate(70)],
      ZERO_TIMINGS
    );
    expect(r.kind).toBe('confident');
    if (r.kind === 'confident') {
      expect(r.match.scryfallId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    }
  });

  it('returns borderline between the two thresholds', () => {
    const r = classify([mkCandidate(BORDERLINE_SCORE + 5)], ZERO_TIMINGS);
    expect(r.kind).toBe('borderline');
  });

  it('returns miss below the borderline threshold', () => {
    const r = classify([mkCandidate(BORDERLINE_SCORE - 1)], ZERO_TIMINGS);
    expect(r.kind).toBe('miss');
    if (r.kind === 'miss') {
      expect(r.reason).toBe('low_score');
    }
  });

  it('passes timings through unchanged', () => {
    const t: ScanTimings = { ...ZERO_TIMINGS, totalMs: 42, decodeMs: 5 };
    const r = classify([mkCandidate(CONFIDENT_SCORE)], t);
    expect(r.timings).toEqual(t);
  });
});

describe('matcher thresholds', () => {
  it('has the same ordering as the frontend matcher', () => {
    expect(BORDERLINE_SCORE).toBeGreaterThan(0);
    expect(CONFIDENT_SCORE).toBeGreaterThan(BORDERLINE_SCORE);
    expect(CONFIDENT_SCORE).toBeLessThan(127);
  });

  it('exposes sane pool sizes', () => {
    expect(PHASH_CANDIDATE_K).toBeGreaterThanOrEqual(20);
    expect(BORDERLINE_TOP_N).toBeGreaterThanOrEqual(3);
    expect(BORDERLINE_TOP_N).toBeLessThan(PHASH_CANDIDATE_K);
  });
});
