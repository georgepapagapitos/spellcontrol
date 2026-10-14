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
    expect(buildNonbasicShortfallNote({ lands, targetNonBasic: 7, reason: 'budget' })).toBe(
      '1 nonbasic slot went to a basic: no fitting land under the budget.'
    );
    expect(buildNonbasicShortfallNote({ lands, targetNonBasic: 8, reason: 'budget' })).toBe(
      '2 nonbasic slots went to basics: no fitting land under the budget.'
    );
  });

  it('stays silent when the target was met or exceeded', () => {
    expect(buildNonbasicShortfallNote({ lands, targetNonBasic: 6, reason: 'budget' })).toBe(
      undefined
    );
    expect(buildNonbasicShortfallNote({ lands, targetNonBasic: 5, reason: 'pool' })).toBe(
      undefined
    );
  });

  // Zo-Zu, 2026-10-12: an owned-only build asked for 6 nonbasics, seated 3 and
  // said nothing, because the note fired only under a price ceiling.
  it('names a shortfall with no price ceiling, by its cause', () => {
    expect(buildNonbasicShortfallNote({ lands, targetNonBasic: 8, reason: 'collection' })).toBe(
      '2 nonbasic slots went to basics: no other fitting land in your collection.'
    );
    expect(buildNonbasicShortfallNote({ lands, targetNonBasic: 7, reason: 'pool' })).toBe(
      '1 nonbasic slot went to a basic: no other fitting land for this deck.'
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
    expect(withNonbasicShortfall('Auto-tuned.', lands, 6, {})).toBe('Auto-tuned.');
  });

  it('reads the budget first, then the collection, then the pool', () => {
    expect(withNonbasicShortfall(undefined, lands, 7, { deckBudget: 75 }, true)).toContain(
      'under the budget'
    );
    expect(withNonbasicShortfall(undefined, lands, 7, {}, true)).toContain('in your collection');
    expect(withNonbasicShortfall(undefined, lands, 7, {})).toContain('for this deck');
  });

  // Ulamog, "available only": 6 free Wastes, so owned colorless lands took the
  // basic slots past the nonbasic target, and the note says why.
  it('names basic slots an owned-only build gave to nonbasics', () => {
    expect(withNonbasicShortfall(undefined, lands, 4, {}, true)).toBe(
      '2 basic slots went to nonbasic lands: too few free basics in your collection.'
    );
    expect(withNonbasicShortfall(undefined, lands, 5, {}, true)).toContain(
      '1 basic slot went to a nonbasic land'
    );
    // Past the target without an owned-only strategy is the user's own count.
    expect(withNonbasicShortfall(undefined, lands, 4, {})).toBe(undefined);
  });
});
