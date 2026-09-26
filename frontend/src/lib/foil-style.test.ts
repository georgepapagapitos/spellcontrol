import { describe, it, expect } from 'vitest';
import { classifyFoil, foilFinishLabel, foilSeed } from './foil-style';
import type { EnrichedCard } from '../types';

function card(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: 'c1',
    name: 'X',
    setCode: 'A',
    setName: 'Set',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: 'a',
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: true,
    finish: 'nonfoil',
    ...overrides,
  };
}

describe('classifyFoil', () => {
  it('returns none for non-foil cards', () => {
    expect(classifyFoil(card({ foil: false }))).toBe('none');
  });

  it('detects fracture before other promo types', () => {
    expect(classifyFoil(card({ promoTypes: ['fracturefoil', 'oilslick'] }))).toBe('fracture');
  });

  it('detects oilslick', () => {
    expect(classifyFoil(card({ promoTypes: ['oilslick'] }))).toBe('oilslick');
  });

  it('treats neonink as gilded', () => {
    expect(classifyFoil(card({ promoTypes: ['gilded'] }))).toBe('gilded');
    expect(classifyFoil(card({ promoTypes: ['neonink'] }))).toBe('gilded');
  });

  it('treats surgefoil as halo', () => {
    expect(classifyFoil(card({ promoTypes: ['halofoil'] }))).toBe('halo');
    expect(classifyFoil(card({ promoTypes: ['surgefoil'] }))).toBe('halo');
  });

  it('folds confetti and raised into textured', () => {
    expect(classifyFoil(card({ promoTypes: ['textured'] }))).toBe('textured');
    expect(classifyFoil(card({ promoTypes: ['confettifoil'] }))).toBe('textured');
    expect(classifyFoil(card({ promoTypes: ['raisedfoil'] }))).toBe('textured');
  });

  it('detects etched from finishes or frame effects', () => {
    expect(classifyFoil(card({ finishes: ['etched'] }))).toBe('etched');
    expect(classifyFoil(card({ frameEffects: ['etched'] }))).toBe('etched');
  });

  it('falls back to regular foil', () => {
    expect(classifyFoil(card({}))).toBe('regular');
  });

  it('gives galaxy, ripple and rainbow foils their own treatment', () => {
    expect(classifyFoil(card({ promoTypes: ['galaxyfoil', 'boosterfun'] }))).toBe('galaxy');
    expect(classifyFoil(card({ promoTypes: ['ripplefoil'] }))).toBe('ripple');
    expect(classifyFoil(card({ promoTypes: ['rainbowfoil'] }))).toBe('rainbow');
    expect(foilFinishLabel(card({ promoTypes: ['ripplefoil'] }))).toBe('Ripple');
  });

  it('promo treatments override etched finishes', () => {
    expect(classifyFoil(card({ promoTypes: ['oilslick'], finishes: ['etched'] }))).toBe('oilslick');
  });
});

describe('foilSeed', () => {
  it('is a stable phase in [0, 1) that differs between cards', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `copy-${i}`);
    const seeds = ids.map(foilSeed);
    for (const s of seeds) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(1);
    }
    expect(foilSeed('copy-7')).toBe(seeds[7]);
    // Sequential ids (the worst case) must spread across the whole cycle, not
    // bunch into one phase — that bunching is the lockstep pulse.
    expect(new Set(seeds.map((s) => Math.floor(s * 10))).size).toBeGreaterThanOrEqual(9);
    const neighbourGap =
      seeds.slice(1).reduce((sum, s, i) => sum + Math.abs(s - seeds[i]), 0) / (seeds.length - 1);
    expect(neighbourGap).toBeGreaterThan(0.2);
  });
});

describe('foilFinishLabel', () => {
  it('returns null for non-foil cards', () => {
    expect(foilFinishLabel(card({ foil: false }))).toBeNull();
  });

  it('labels the generic finish "Foil"', () => {
    expect(foilFinishLabel(card({}))).toBe('Foil');
  });

  it('labels specialty finishes specifically', () => {
    expect(foilFinishLabel(card({ promoTypes: ['oilslick'] }))).toBe('Oil slick');
    expect(foilFinishLabel(card({ finishes: ['etched'] }))).toBe('Etched');
  });
});
