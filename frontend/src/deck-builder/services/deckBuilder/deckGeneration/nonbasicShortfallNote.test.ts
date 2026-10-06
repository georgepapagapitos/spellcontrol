import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { buildNonbasicShortfallNote, withNonbasicShortfall } from './nonbasicShortfallNote';

// Lands from the Atraxa budget75 build (E552): 20 nonbasics against a target
// of 23, the rest basics, with $0.14 of the $75 left when the land base ran.
const land = (name: string, type_line = 'Land') => ({ name, type_line }) as ScryfallCard;
const NONBASICS = [
  'Command Tower',
  'Exotic Orchard',
  'Path of Ancestry',
  'Opulent Palace',
  'Seaside Citadel',
  'Thriving Isle',
].map((n) => land(n));
const BASICS = [land('Island', 'Basic Land — Island'), land('Forest', 'Basic Land — Forest')];

describe('buildNonbasicShortfallNote', () => {
  const lands = [...NONBASICS, ...BASICS];

  it('names the slots a basic took when a price ceiling left the target short', () => {
    expect(buildNonbasicShortfallNote({ lands, targetNonBasic: 7, hasPriceCeiling: true })).toBe(
      '1 nonbasic slot went to a basic: no fitting land under the budget.'
    );
    expect(buildNonbasicShortfallNote({ lands, targetNonBasic: 8, hasPriceCeiling: true })).toBe(
      '2 nonbasic slots went to basics: no fitting land under the budget.'
    );
  });

  it('stays silent when the target was met, exceeded, or no price ceiling applies', () => {
    expect(buildNonbasicShortfallNote({ lands, targetNonBasic: 6, hasPriceCeiling: true })).toBe(
      undefined
    );
    expect(buildNonbasicShortfallNote({ lands, targetNonBasic: 8, hasPriceCeiling: false })).toBe(
      undefined
    );
  });
});

describe('withNonbasicShortfall', () => {
  const lands = [...NONBASICS, ...BASICS];
  it('appends to an existing land note and stands alone otherwise', () => {
    expect(withNonbasicShortfall('Auto-tuned.', lands, 7, { deckBudget: 75 })).toBe(
      'Auto-tuned. 1 nonbasic slot went to a basic: no fitting land under the budget.'
    );
    expect(withNonbasicShortfall(undefined, lands, 7, { maxCardPrice: 1 })).toContain('1 nonbasic');
    expect(withNonbasicShortfall('Auto-tuned.', lands, 7, {})).toBe('Auto-tuned.');
  });
});
