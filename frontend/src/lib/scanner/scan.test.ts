// Threshold-classification tests for the scan() wrapper.
// The full pipeline can't run in node (opencv + ORT WASM), so device-side
// behavior is validated via the spike page on real Android. Here we test
// the pure `classify` function in isolation — it's the entire decision
// surface for confident / borderline / miss results.

import { describe, it, expect } from 'vitest';
import {
  classify,
  pickBetterResult,
  serverBodyToScanResult,
  phashHitsToScanResult,
  CONFIDENT_SCORE,
  BORDERLINE_SCORE,
  BORDERLINE_TOP_N,
  PHASH_CANDIDATE_K,
  PHASH_FAST_DISTANCE,
  PHASH_FAST_GAP,
  type ScanCandidate,
  type ScanTimings,
  type ServerScanBody,
} from './scan';
import type { Match as HashMatch } from './hash-db';

const ZERO_TIMINGS: ScanTimings = {
  detectMs: 0,
  normalizeMs: 0,
  pHashMs: 0,
  pHashScanMs: 0,
  encodeMs: 0,
  networkMs: 0,
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
    const timings: ScanTimings = { ...ZERO_TIMINGS, totalMs: 42, detectMs: 7, networkMs: 30 };
    const confident = classify([mkCandidate(CONFIDENT_SCORE + 10)], timings);
    const borderline = classify([mkCandidate(BORDERLINE_SCORE + 5)], timings);
    const miss = classify([mkCandidate(BORDERLINE_SCORE - 5)], timings);
    expect(confident.timings).toEqual(timings);
    expect(borderline.timings).toEqual(timings);
    expect(miss.timings).toEqual(timings);
  });
});

describe('serverBodyToScanResult', () => {
  const QUAD = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];

  it('passes a confident body through with the quad attached', () => {
    const body: ServerScanBody = {
      kind: 'confident',
      match: mkCandidate(CONFIDENT_SCORE + 5, '11111111-1111-1111-1111-111111111111'),
    };
    const r = serverBodyToScanResult(body, ZERO_TIMINGS, QUAD);
    expect(r.kind).toBe('confident');
    expect(r.source).toBe('server');
    if (r.kind === 'confident') {
      expect(r.quad).toEqual(QUAD);
    }
  });

  it('falls back to an empty quad on a confident match without one', () => {
    const body: ServerScanBody = { kind: 'confident', match: mkCandidate(CONFIDENT_SCORE) };
    const r = serverBodyToScanResult(body, ZERO_TIMINGS, undefined);
    expect(r.kind).toBe('confident');
    if (r.kind === 'confident') {
      expect(r.quad).toEqual([]);
    }
  });

  it('passes a borderline body through with the candidates intact', () => {
    const body: ServerScanBody = {
      kind: 'borderline',
      candidates: [mkCandidate(BORDERLINE_SCORE + 1), mkCandidate(BORDERLINE_SCORE)],
    };
    const r = serverBodyToScanResult(body, ZERO_TIMINGS, undefined);
    expect(r.kind).toBe('borderline');
    if (r.kind === 'borderline') {
      expect(r.candidates).toHaveLength(2);
      expect(r.source).toBe('server');
    }
  });

  it('maps a miss body into a low_score miss carrying the detail', () => {
    const body: ServerScanBody = {
      kind: 'miss',
      reason: 'low_score',
      detail: 'top raw score 30 < 89',
    };
    const r = serverBodyToScanResult(body, ZERO_TIMINGS, undefined);
    expect(r.kind).toBe('miss');
    if (r.kind === 'miss') {
      expect(r.reason).toBe('low_score');
      expect(r.detail).toBe('top raw score 30 < 89');
      expect(r.source).toBe('server');
    }
  });
});

describe('phashHitsToScanResult', () => {
  function mkHit(distance: number, id = '11111111-1111-1111-1111-111111111111'): HashMatch {
    return { scryfallId: id, distance };
  }

  it('returns a no_candidates miss when the hit list is empty', () => {
    const r = phashHitsToScanResult([], ZERO_TIMINGS, undefined);
    expect(r.kind).toBe('miss');
    if (r.kind === 'miss') {
      expect(r.reason).toBe('low_score');
      expect(r.source).toBe('on-device');
    }
  });

  it('returns confident when top distance ≤ fast threshold and gap ≥ fast gap', () => {
    const r = phashHitsToScanResult(
      [
        mkHit(PHASH_FAST_DISTANCE, '11111111-1111-1111-1111-111111111111'),
        mkHit(PHASH_FAST_DISTANCE + PHASH_FAST_GAP, '22222222-2222-2222-2222-222222222222'),
      ],
      ZERO_TIMINGS,
      undefined
    );
    expect(r.kind).toBe('confident');
    if (r.kind === 'confident') {
      expect(r.match.scryfallId).toBe('11111111-1111-1111-1111-111111111111');
      expect(r.source).toBe('on-device');
    }
  });

  it('treats a single-hit fast-path as confident (gap = Infinity)', () => {
    const r = phashHitsToScanResult([mkHit(0)], ZERO_TIMINGS, undefined);
    expect(r.kind).toBe('confident');
  });

  it('returns borderline when distances are close together (gap too small)', () => {
    const r = phashHitsToScanResult(
      [mkHit(2), mkHit(3, '22222222-2222-2222-2222-222222222222')],
      ZERO_TIMINGS,
      undefined
    );
    expect(r.kind).toBe('borderline');
    if (r.kind === 'borderline') {
      expect(r.candidates.length).toBeGreaterThan(0);
      expect(r.source).toBe('on-device');
    }
  });

  it('returns borderline when top distance is far past the fast threshold', () => {
    const r = phashHitsToScanResult(
      [mkHit(30), mkHit(45, '22222222-2222-2222-2222-222222222222')],
      ZERO_TIMINGS,
      undefined
    );
    expect(r.kind).toBe('borderline');
  });
});

describe('pickBetterResult', () => {
  const confident = classify([mkCandidate(CONFIDENT_SCORE + 10)], ZERO_TIMINGS);
  const borderline = classify([mkCandidate(BORDERLINE_SCORE + 2)], ZERO_TIMINGS);
  const miss = classify([mkCandidate(BORDERLINE_SCORE - 10)], ZERO_TIMINGS);

  it('prefers confident over borderline regardless of argument order', () => {
    expect(pickBetterResult(confident, borderline)).toBe(confident);
    expect(pickBetterResult(borderline, confident)).toBe(confident);
  });

  it('prefers borderline over miss regardless of argument order', () => {
    // The full-art fix: band crop misses, whole-card crop recovers a match.
    expect(pickBetterResult(miss, borderline)).toBe(borderline);
    expect(pickBetterResult(borderline, miss)).toBe(borderline);
  });

  it('breaks a same-kind tie by higher top score', () => {
    const lo = classify([mkCandidate(CONFIDENT_SCORE + 1)], ZERO_TIMINGS);
    const hi = classify([mkCandidate(CONFIDENT_SCORE + 20)], ZERO_TIMINGS);
    expect(pickBetterResult(lo, hi)).toBe(hi);
    expect(pickBetterResult(hi, lo)).toBe(hi);
  });

  it('returns the first argument when both are misses', () => {
    const missB = classify([mkCandidate(BORDERLINE_SCORE - 20)], ZERO_TIMINGS);
    expect(pickBetterResult(miss, missB)).toBe(miss);
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
