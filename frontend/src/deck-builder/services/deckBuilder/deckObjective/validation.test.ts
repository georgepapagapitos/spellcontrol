// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  agreement,
  binomialTwoSided,
  bootstrapCI,
  fitWeights,
  hit,
  pearson,
  rng,
  spearman,
  weightedDelta,
  type FitExample,
} from './validation';

describe('agreement', () => {
  it('scores a matching sign 1, a mismatch 0 and a tie half', () => {
    expect(hit({ delta: 2, label: 1 })).toBe(1);
    expect(hit({ delta: -2, label: 1 })).toBe(0);
    expect(hit({ delta: 0, label: -1 })).toBe(0.5);
    expect(
      agreement([
        { delta: 1, label: 1 },
        { delta: 1, label: -1 },
        { delta: 0, label: 1 },
        { delta: -3, label: -1 },
      ])
    ).toBeCloseTo(2.5 / 4);
  });
});

describe('bootstrapCI', () => {
  it('is seeded, brackets the statistic, and narrows with more data', () => {
    const few = [1, 1, 1, 0, 0, 1, 1, 0];
    const many = Array.from({ length: 200 }, (_, i) => (i % 8 < 5 ? 1 : 0));
    const mean = (s: number[]) => s.reduce((a, b) => a + b, 0) / s.length;
    const a = bootstrapCI(few, mean, { seed: 3, reps: 2000 });
    expect(bootstrapCI(few, mean, { seed: 3, reps: 2000 })).toEqual(a);
    expect(a[0]).toBeLessThanOrEqual(mean(few));
    expect(a[1]).toBeGreaterThanOrEqual(mean(few));
    const b = bootstrapCI(many, mean, { seed: 3, reps: 2000 });
    expect(b[1] - b[0]).toBeLessThan(a[1] - a[0]);
  });
});

describe('binomialTwoSided', () => {
  it('matches the exact values', () => {
    // 19 of 24: P = 2 × Σ_{k≥19} C(24,k)/2^24 = 0.00661.
    expect(binomialTwoSided(19, 24)).toBeCloseTo(0.00661, 4);
    expect(binomialTwoSided(12, 24)).toBeCloseTo(1, 6);
    expect(binomialTwoSided(0, 10)).toBeCloseTo(2 / 1024, 8);
  });
});

describe('rank correlation', () => {
  it('is 1 for any monotone relation and averages ties', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 400, 5000])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    expect(spearman([1, 1, 2, 2], [1, 1, 2, 2])).toBeCloseTo(1);
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
  });
});

describe('fitWeights', () => {
  it('keeps weights non-negative and weighs the predictive feature above noise', () => {
    const next = rng(11);
    const examples: FitExample[] = [];
    for (let i = 0; i < 40; i++) {
      const signal = next() * 2 - 1;
      const y = signal >= 0 ? 1 : -1;
      // `anti` points the wrong way on purpose: a free-sign fit would use it.
      examples.push({ x: { signal, noise: next() * 2 - 1, anti: -signal * 0.5 }, y });
    }
    const fit = fitWeights(examples, ['signal', 'noise', 'anti']);
    for (const w of Object.values(fit.weights)) expect(w).toBeGreaterThanOrEqual(0);
    expect(fit.weights.signal).toBeGreaterThan(fit.weights.noise);
    expect(fit.weights.signal).toBeGreaterThan(fit.weights.anti);
    expect(fit.looAgreement).toBeGreaterThan(0.8);
    const correct = examples.filter(
      (e) => Math.sign(weightedDelta(e.x, fit.weights)) === e.y
    ).length;
    expect(correct / examples.length).toBeGreaterThan(0.9);
  });

  it('is deterministic', () => {
    const ex: FitExample[] = [
      { x: { a: 1, b: 0 }, y: 1 },
      { x: { a: -1, b: 1 }, y: -1 },
      { x: { a: 0.5, b: -0.2 }, y: 1 },
      { x: { a: -0.3, b: 0.4 }, y: -1 },
    ];
    expect(fitWeights(ex, ['a', 'b'])).toEqual(fitWeights(ex, ['a', 'b']));
  });
});
