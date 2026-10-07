// Guard (T171 round 3, v4 gate): Sythis's build cut Rest in Peace as an
// orphan combo piece for Path to Exile (a coherence repair), and Coach offered
// it straight back as an "EDHREC staple", into a deck whose Starfield of Nyx
// and Resurgent Belief recur from its own graveyard. Real cards (Scryfall
// 2026-09-29).
import { describe, it, expect, afterEach } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { setCardFactsSnapshot } from '@/deck-builder/services/cardFacts';
import { COACH_CARDS, coachCardFactsSnapshot } from './__fixtures__/coach-cards.fixtures';
import { coachExclusions, dropExcluded, removedByBuild } from './coachExclusions';

const real = (name: string): ScryfallCard => ({ ...COACH_CARDS[name] }) as ScryfallCard;
const RIP_REPAIR = {
  coherenceRepairs: [
    {
      cut: 'Rest in Peace',
      added: 'Path to Exile',
      reason: "Rest in Peace's combo was still missing 1 card. Swapped for Path to Exile.",
    },
  ],
};

afterEach(() => setCardFactsSnapshot(null));

describe('removedByBuild', () => {
  it('holds a stated removal while the card it made room for is in the deck', () => {
    expect(removedByBuild(RIP_REPAIR, [real('Path to Exile')]).has('rest in peace')).toBe(true);
    // The user took Path to Exile out: the swap no longer stands.
    expect(removedByBuild(RIP_REPAIR, [real('Murder')]).size).toBe(0);
  });
});

// The real Sythis build (T171 S6 gate): Rest in Peace went for Starfield of Nyx,
// which the build itself cut later for Auramancer. The Cuts lane added it back.
describe('removedByBuild follows a replacement the build cut later', () => {
  const chain = {
    coherenceRepairs: [
      { cut: 'Rest in Peace', added: 'Starfield of Nyx', reason: 'combo missing 1 card' },
      { cut: 'Starfield of Nyx', added: 'Auramancer', reason: 'combo missing 1 card' },
    ],
  };
  it('holds while what finally took its place is in the deck', () => {
    const deck = [real('Path to Exile')].map((c) => ({ ...c, name: 'Auramancer' }) as ScryfallCard);
    expect(removedByBuild(chain, deck).has('rest in peace')).toBe(true);
    expect(removedByBuild(chain, deck).has('starfield of nyx')).toBe(true);
  });
  it('lapses once nothing of the chain is in the deck', () => {
    expect(removedByBuild(chain, [real('Murder')]).size).toBe(0);
  });
});

describe('coachExclusions', () => {
  it('drops what the build removed from every suggestion list', () => {
    const excluded = coachExclusions(RIP_REPAIR, [real('Path to Exile')], { invested: [] });
    const gaps = [{ name: 'Rest in Peace' }, { name: 'Swords to Plowshares' }];
    dropExcluded(gaps, (g) => g.name, excluded);
    expect(gaps.map((g) => g.name)).toEqual(['Swords to Plowshares']);
  });

  it('keeps graveyard hate out of a deck that recurs from its own graveyard', () => {
    setCardFactsSnapshot(coachCardFactsSnapshot());
    const recursion = ['Starfield of Nyx', 'Resurgent Belief', 'Eternal Witness'].map(real);
    expect(coachExclusions(undefined, recursion, { invested: [] })('Rest in Peace')).toBe(true);
    expect(coachExclusions(undefined, [real('Murder')], { invested: [] })('Rest in Peace')).toBe(
      false
    );
    expect(
      coachExclusions(undefined, [real('Murder')], { invested: ['graveyard'] })('Rest in Peace')
    ).toBe(true);
  });
});
