import { describe, it, expect } from 'vitest';
import { unverifiedCitations } from './deck-review';

/**
 * A stand-in card database. The real predicate is a cache lookup; what matters
 * for these tests is that only these phrases are real cards, so anything else
 * capitalised in the prose has to be recognised as ordinary English.
 */
const REAL = new Set([
  'Wooded Foothills',
  'Verdant Catacombs',
  'Tormod’s Crypt',
  "Tormod's Crypt",
  'Tropical Island',
  'Sol Ring',
  'Meren of Clan Nel Toth',
  'Eternal Witness',
  'Bojuka Bog',
  'There', // a real card name that is also a common word — the single-word trap
  'Ramp',
]);
const isRealCard = (name: string) => REAL.has(name);

describe('unverifiedCitations', () => {
  it('passes a card the deck actually runs', () => {
    const prose = 'Your Eternal Witness can rebuy the spell.';
    expect(unverifiedCitations(prose, ['Eternal Witness'], isRealCard)).toEqual([]);
  });

  it('passes a card the model looked up', () => {
    const prose = 'Add Bojuka Bog for graveyard hate.';
    // Not in the deck, but it came back from lookup_cards — that is the point.
    expect(unverifiedCitations(prose, ['Sol Ring', 'Bojuka Bog'], isRealCard)).toEqual([]);
  });

  it('catches a card the model recalled from memory', () => {
    // The exact failure measured at n=12: a real card, named in the
    // prescription, that is neither in the deck nor anything we fetched.
    const prose = 'Add one more untapped dual, likely a Tropical Island.';
    expect(unverifiedCitations(prose, ['Sol Ring'], isRealCard)).toEqual(['Tropical Island']);
  });

  it('catches several, deduped', () => {
    const prose =
      'Swap Wooded Foothills for Verdant Catacombs. Wooded Foothills cannot find a Swamp.';
    expect(unverifiedCitations(prose, [], isRealCard).sort()).toEqual([
      'Verdant Catacombs',
      'Wooded Foothills',
    ]);
  });

  it('ignores single words, which are mostly prose', () => {
    // "There" and "Ramp" are real card names against a 100k-card database.
    // Counting them made the eval grader's version of this metric mostly
    // false positives, so multi-word phrases are the only ones that count.
    const prose = 'There is not enough Ramp in this deck.';
    expect(unverifiedCitations(prose, [], isRealCard)).toEqual([]);
  });

  it('ignores capitalised phrases that are not cards', () => {
    const prose = 'Your Command Zone strategy leans on the Early Game.';
    expect(unverifiedCitations(prose, [], isRealCard)).toEqual([]);
  });

  it('prefers the longest real name at a position', () => {
    // "Wooded" alone is not a card; the full name is. Matching greedily stops
    // a partial from masking the real citation.
    const prose = 'Cut Wooded Foothills.';
    expect(unverifiedCitations(prose, [], isRealCard)).toEqual(['Wooded Foothills']);
  });

  it('matches the commander by its full multi-word name', () => {
    const prose = 'Meren of Clan Nel Toth is the engine.';
    expect(unverifiedCitations(prose, ['Meren of Clan Nel Toth'], isRealCard)).toEqual([]);
  });

  it('is case-insensitive about what counts as allowed', () => {
    const prose = 'Add Bojuka Bog.';
    expect(unverifiedCitations(prose, ['bojuka bog'], isRealCard)).toEqual([]);
  });

  it('handles apostrophes in card names', () => {
    const prose = "Tormod's Crypt would answer it.";
    expect(unverifiedCitations(prose, [], isRealCard)).toEqual(["Tormod's Crypt"]);
  });

  it('returns nothing for prose with no card names', () => {
    const prose = 'You need an instant-speed answer to an artifact.';
    expect(unverifiedCitations(prose, [], isRealCard)).toEqual([]);
  });
});
