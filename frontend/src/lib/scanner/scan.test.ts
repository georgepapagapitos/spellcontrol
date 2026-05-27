// Threshold-classification tests for the scan() wrapper.
// The full pipeline can't run in node (opencv + ORT WASM), so device-side
// behavior is validated via the spike page on real Android. Here we test
// the pure `classify` function in isolation — it's the entire decision
// surface for confident / borderline / miss results.

import { describe, it, expect } from 'vitest';
import {
  classify,
  CONFIDENT_SCORE,
  BORDERLINE_SCORE,
  BORDERLINE_TOP_N,
  PHASH_CANDIDATE_K,
  type ScanCandidate,
  type ScanTimings,
} from './scan';

const ZERO_TIMINGS: ScanTimings = {
  detectMs: 0,
  normalizeMs: 0,
  pHashMs: 0,
  pHashScanMs: 0,
  embedPreprocessMs: 0,
  embedInferMs: 0,
  rerankMs: 0,
  totalMs: 0,
};

function mkCandidate(
  rawScore: number,
  scryfallId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
): ScanCandidate {
  return { scryfallId, rawScore, confidence: rawScore / 127 };
}

describe('classify', () => {
  it('returns confident when the top score is at the confident threshold', () => {
    const result = classify(
      [mkCandidate(CONFIDENT_SCORE), mkCandidate(BORDERLINE_SCORE - 10)],
      ZERO_TIMINGS
    );
    expect(result.kind).toBe('confident');
    if (result.kind === 'confident') {
      expect(result.match.rawScore).toBe(CONFIDENT_SCORE);
    }
  });

  it('returns confident well above threshold (the typical case)', () => {
    const result = classify(
      [
        mkCandidate(120, '11111111-1111-1111-1111-111111111111'),
        mkCandidate(80, '22222222-2222-2222-2222-222222222222'),
      ],
      ZERO_TIMINGS
    );
    expect(result.kind).toBe('confident');
    if (result.kind === 'confident') {
      expect(result.match.scryfallId).toBe('11111111-1111-1111-1111-111111111111');
    }
  });

  it('returns borderline when the top score sits between the two thresholds', () => {
    const candidates = [
      mkCandidate(BORDERLINE_SCORE + 5, '11111111-1111-1111-1111-111111111111'),
      mkCandidate(BORDERLINE_SCORE, '22222222-2222-2222-2222-222222222222'),
      mkCandidate(BORDERLINE_SCORE - 5, '33333333-3333-3333-3333-333333333333'),
    ];
    const result = classify(candidates, ZERO_TIMINGS);
    expect(result.kind).toBe('borderline');
    if (result.kind === 'borderline') {
      expect(result.candidates).toHaveLength(3);
      expect(result.candidates[0].scryfallId).toBe('11111111-1111-1111-1111-111111111111');
    }
  });

  it('returns borderline at exactly the borderline threshold', () => {
    const result = classify([mkCandidate(BORDERLINE_SCORE)], ZERO_TIMINGS);
    expect(result.kind).toBe('borderline');
  });

  it('returns miss with reason=low_score when the top is below the borderline threshold', () => {
    const result = classify([mkCandidate(BORDERLINE_SCORE - 1)], ZERO_TIMINGS);
    expect(result.kind).toBe('miss');
    if (result.kind === 'miss') {
      expect(result.reason).toBe('low_score');
      expect(result.detail).toMatch(/top raw score/);
    }
  });

  it('passes timings through unchanged on every variant', () => {
    const timings: ScanTimings = { ...ZERO_TIMINGS, totalMs: 42, detectMs: 7 };
    const confident = classify([mkCandidate(CONFIDENT_SCORE + 10)], timings);
    const borderline = classify([mkCandidate(BORDERLINE_SCORE + 5)], timings);
    const miss = classify([mkCandidate(BORDERLINE_SCORE - 5)], timings);
    expect(confident.timings).toEqual(timings);
    expect(borderline.timings).toEqual(timings);
    expect(miss.timings).toEqual(timings);
  });
});

describe('scan thresholds', () => {
  it('defines a sane ordering of thresholds', () => {
    expect(BORDERLINE_SCORE).toBeGreaterThan(0);
    expect(CONFIDENT_SCORE).toBeGreaterThan(BORDERLINE_SCORE);
    // Raw scores top out near 127 (int8 × unit-fp32 dot product); both
    // thresholds should leave headroom below that ceiling.
    expect(CONFIDENT_SCORE).toBeLessThan(127);
  });

  it('exposes reasonable pool sizes', () => {
    expect(PHASH_CANDIDATE_K).toBeGreaterThanOrEqual(20);
    expect(PHASH_CANDIDATE_K).toBeLessThanOrEqual(200);
    expect(BORDERLINE_TOP_N).toBeGreaterThanOrEqual(3);
    expect(BORDERLINE_TOP_N).toBeLessThan(PHASH_CANDIDATE_K);
  });
});
