import { describe, it, expect } from 'vitest';
import { classifyFoil } from './foil-style';
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

  it('promo treatments override etched finishes', () => {
    expect(classifyFoil(card({ promoTypes: ['oilslick'], finishes: ['etched'] }))).toBe('oilslick');
  });
});
