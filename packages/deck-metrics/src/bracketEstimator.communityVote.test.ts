/**
 * EDHREC's community early/late vote on two-card combos (E1053).
 *
 * The combos are real Commander Spellbook variants with the tags the dataset
 * carries, and the votes come from the committed snapshot
 * (`frontend/public/combo-votes.json`, written by `refresh-combo-votes.mjs`),
 * so a join that stopped matching Spellbook ids fails here, not in production.
 */
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  createComboVotes,
  estimateBracket,
  floorsAtFourAlone,
  ratingOnlyComboFloor,
  type ComboVotes,
  type DetectedCombo,
  type TagLookup,
} from './index';

const snapshot = JSON.parse(
  fs.readFileSync(new URL('../../../frontend/public/combo-votes.json', import.meta.url), 'utf8')
) as { early: string[]; late: string[] };
const votes = createComboVotes(snapshot);

const noTags: TagLookup = {
  hasTag: () => false,
  getCardRole: () => null,
  isMassLandDenial: () => false,
  isExtraTurn: () => false,
};

function combo(comboId: string, cards: string[], bracketTag: string | null): DetectedCombo {
  return {
    comboId,
    cards,
    results: [],
    isComplete: true,
    missingCards: [],
    deckCount: 0,
    bracket: null,
    bracketTag,
    cardCount: cards.length,
  };
}

// Spicy two-card loop, voted early (16 votes, "4-5"). Spellbook alone calls it Bracket 3.
const SANGUINE = combo('690-3966', ['Sanguine Bond', 'Exquisite Blood'], 'S');
// Untagged-as-fast, voted late (14 votes, "3").
const SHEOLDRED = combo('1561-2498', ['Sheoldred, the Apocalypse', 'Peer into the Abyss'], 'O');
// Ruthless by Spellbook, voted late (16 votes, "3").
const BLIGHTSTEEL = combo('1571-2560', ['Blightsteel Colossus', "Chandra's Ignition"], 'R');
// Exhibition loop, voted early (17 votes): the tag still decides it sets no floor.
const TOOTH_AND_CLAW = combo('1245-3129', ['Tooth and Claw', 'Primal Vigor'], 'E');

function estimate(combos: DetectedCombo[], v?: ComboVotes) {
  const names = [...new Set(combos.flatMap((c) => c.cards))];
  return estimateBracket(names, combos, 3.4, undefined, {}, new Set(), noTags, [], v);
}

describe('snapshot', () => {
  it('carries the votes the cases below rest on', () => {
    expect(votes.get('690-3966')).toBe('early');
    expect(votes.get('1561-2498')).toBe('late');
    expect(votes.get('1571-2560')).toBe('late');
    expect(votes.get('1245-3129')).toBe('early');
  });

  it('is sorted ids only, with no id on both lists', () => {
    expect(snapshot.early.length).toBeGreaterThan(1000);
    expect(snapshot.late.length).toBeGreaterThan(400);
    expect(snapshot.early.filter((id) => snapshot.late.includes(id))).toEqual([]);
  });

  it('reads an id on both lists as unvoted', () => {
    const v = createComboVotes({ early: ['1-2', '3-4'], late: ['3-4', '5-6'] });
    expect([...v.entries()].sort()).toEqual([
      ['1-2', 'early'],
      ['5-6', 'late'],
    ]);
  });
});

describe('an early vote', () => {
  it('floors a deck at Bracket 4 with no tutors or fast mana (Sanguine Bond + Exquisite Blood)', () => {
    const before = estimate([SANGUINE]);
    expect(before.bracket).toBe(3);
    const after = estimate([SANGUINE], votes);
    expect(after.bracket).toBe(4);
    expect(after.hardFloors.find((f) => f.bracket === 4)?.detail).toContain('EDHREC players vote');
  });

  it('is not a rating-only floor, so the estimate is not borderline for it', () => {
    expect(ratingOnlyComboFloor(estimate([SANGUINE], votes))).toBeNull();
  });

  it('is a Bracket 4 floor on its own for Bracket Fit', () => {
    expect(floorsAtFourAlone(SANGUINE)).toBe(false);
    expect(floorsAtFourAlone(SANGUINE, [], votes)).toBe(true);
  });

  it('does not override Spellbook for a loop it rates Exhibition', () => {
    const r = estimate([TOOTH_AND_CLAW], votes);
    expect(r.bracket).toBe(2);
    expect(r.hardFloors).toEqual([]);
  });
});

describe('a late vote', () => {
  it('does not by itself send a complete combo to Bracket 4 (Sheoldred + Peer into the Abyss)', () => {
    const r = estimate([SHEOLDRED], votes);
    expect(r.bracket).toBe(3);
    expect(r.hardFloors.find((f) => f.bracket === 4)).toBeUndefined();
  });

  it('withdraws a Ruthless rating’s claim to be early (Blightsteel Colossus + Chandra’s Ignition)', () => {
    expect(estimate([BLIGHTSTEEL]).bracket).toBe(4);
    const r = estimate([BLIGHTSTEEL], votes);
    expect(r.bracket).toBe(3);
    expect(r.hardFloors.some((f) => f.bracket === 3)).toBe(true);
    expect(floorsAtFourAlone(BLIGHTSTEEL, [], votes)).toBe(false);
  });

  it('still floors at 3, because a late combo is an intentional infinite combo', () => {
    expect(estimate([BLIGHTSTEEL], votes).bracket).toBe(3);
  });
});

describe('an unvoted combo', () => {
  it('falls back to the Spellbook tag and the deck’s speed', () => {
    const ruthless = combo('1-2', ['Card A', 'Card B'], 'R');
    expect(estimate([ruthless], votes).bracket).toBe(4);
    expect(estimate([combo('3-4', ['Card C', 'Card D'], 'S')], votes).bracket).toBe(3);
  });

  it('reads the same with no vote data as with an empty map', () => {
    expect(estimate([SANGUINE, BLIGHTSTEEL], new Map())).toEqual(estimate([SANGUINE, BLIGHTSTEEL]));
  });
});
