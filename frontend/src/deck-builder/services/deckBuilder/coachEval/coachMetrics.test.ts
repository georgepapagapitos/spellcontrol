import { describe, expect, it } from 'vitest';
import {
  bootstrapMean,
  bootstrapPairedDelta,
  dedupeRanked,
  formatInterval,
  hitsAtK,
  mean,
  precisionAtK,
  recallAtK,
  seededRandom,
} from './coachMetrics';

// Real names from a Krenko, Mob Boss gate run: the critic called these weak.
const WEAK = ['Goblin Chirurgeon', 'Seething Song', 'Moggcatcher', 'Umbral Mantle'];

describe('ranking metrics', () => {
  it('counts hits in the top k once per card, matching a DFC by its front face', () => {
    const ranked = [
      'Moggcatcher',
      'Skullclamp',
      'Moggcatcher',
      'Esika, God of the Tree // The Prismatic Bridge',
      'Seething Song',
    ];
    expect(dedupeRanked(ranked)).toEqual([
      'Moggcatcher',
      'Skullclamp',
      'Esika, God of the Tree // The Prismatic Bridge',
      'Seething Song',
    ]);
    expect(hitsAtK(ranked, WEAK, 2)).toBe(1);
    expect(hitsAtK(ranked, ['Esika, God of the Tree'], 3)).toBe(1);
  });

  it('scores precision over the rows actually shown, and null for an empty list', () => {
    expect(precisionAtK(['Moggcatcher', 'Skullclamp'], WEAK, 5)).toBe(0.5);
    expect(precisionAtK(['Moggcatcher', 'Skullclamp', 'Sol Ring', 'Seething Song'], WEAK, 2)).toBe(
      0.5
    );
    expect(precisionAtK([], WEAK, 5)).toBeNull();
  });

  it('scores recall over the labels, null when there are none', () => {
    const missing = ["Ashnod's Altar", 'Chaos Warp', 'Purphoros, God of the Forge'];
    expect(recallAtK(['Chaos Warp', 'Ruby Medallion', "Ashnod's Altar"], missing, 2)).toBeCloseTo(
      1 / 3
    );
    expect(recallAtK(['Chaos Warp', 'Ruby Medallion', "Ashnod's Altar"], missing, 3)).toBeCloseTo(
      2 / 3
    );
    expect(recallAtK(['Chaos Warp'], [], 5)).toBeNull();
  });

  it('averages only the decks that could be scored', () => {
    expect(mean([0.5, null, 1])).toBe(0.75);
    expect(mean([null])).toBeNull();
  });
});

describe('bootstrap', () => {
  it('is reproducible under a seed and brackets the mean', () => {
    const rand = seededRandom(7);
    const values = Array.from({ length: 40 }, () => rand());
    const a = bootstrapMean(values, { seed: 11 });
    const b = bootstrapMean(values, { seed: 11 });
    expect(a).toEqual(b);
    expect(a.n).toBe(40);
    expect(a.lo!).toBeLessThanOrEqual(a.mean!);
    expect(a.hi!).toBeGreaterThanOrEqual(a.mean!);
    expect(a.hi! - a.lo!).toBeLessThan(0.3);
  });

  it('collapses to the value when every deck agrees, and reports n/a with no data', () => {
    const iv = bootstrapMean([0.4, 0.4, 0.4, null]);
    expect(iv.n).toBe(3);
    for (const v of [iv.mean, iv.lo, iv.hi]) expect(v).toBeCloseTo(0.4);
    expect(formatInterval(bootstrapMean([]))).toBe('n/a');
    expect(formatInterval(iv)).toBe('0.40 [0.40, 0.40] n=3');
  });

  it('pairs decks for a before/after difference, dropping a deck missing either side', () => {
    const iv = bootstrapPairedDelta([0.2, 0.5, null], [0.3, 0.7, 0.9]);
    expect(iv.n).toBe(2);
    expect(iv.mean).toBeCloseTo(0.15);
  });
});
