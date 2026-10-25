import { describe, expect, it } from 'vitest';
import { HARDCODED_GAME_CHANGERS } from '@spellcontrol/deck-metrics';
import type { AllocationInfo } from '@/lib/collection/allocations-core';
import type { EnrichedCard } from '@/types/index';
import {
  basisLine,
  completionCost,
  computeReadiness,
  filterStaplesForBracket,
  heldLine,
  type ReadinessStaple,
} from './commander-readiness';
import { heldByDecks } from './held-elsewhere';
import fixture from './__fixtures__/atraxa-edhrec-staples.json';

/**
 * Real data: Atraxa, Praetors' Voice's EDHREC page (all brackets, 45,865 decks)
 * and its Core (bracket 2) page (3,183 decks), top 140 non-land cards each,
 * fetched from json.edhrec.com on 2026-10-24. The all-brackets page lists ten
 * Game Changers in that window; the Core page lists none.
 */
const ALL = fixture.all.staples as ReadinessStaple[];
const CORE = fixture.core.staples as ReadinessStaple[];
const GC = HARDCODED_GAME_CHANGERS as ReadonlySet<string>;
const gcIn = (list: ReadinessStaple[]) => list.filter((s) => GC.has(s.name));

describe('filterStaplesForBracket (Atraxa, all brackets)', () => {
  it('has Game Changers to cut in the fixture', () => {
    expect(gcIn(ALL).length).toBe(10);
  });

  it('drops every Game Changer in bracket 1 and 2', () => {
    for (const bracket of [1, 2]) {
      const cut = filterStaplesForBracket(ALL, bracket, GC);
      expect(gcIn(cut.staples)).toHaveLength(0);
      expect(cut.excluded).toBe(10);
      expect(cut.staples).toHaveLength(ALL.length - 10);
    }
  });

  it('keeps the three most-played Game Changers in bracket 3', () => {
    const cut = filterStaplesForBracket(ALL, 3, GC);
    expect(gcIn(cut.staples).map((s) => s.name)).toEqual([
      'Rhystic Study',
      'Cyclonic Rift',
      'Demonic Tutor',
    ]);
    expect(cut.excluded).toBe(7);
  });

  it('leaves brackets 4, 5 and none alone', () => {
    for (const bracket of [4, 5, null, undefined]) {
      const cut = filterStaplesForBracket(ALL, bracket, GC);
      expect(cut.staples).toEqual(ALL);
      expect(cut.excluded).toBe(0);
    }
  });

  it('leaves a list without Game Changers alone at bracket 2 (the Core page)', () => {
    expect(filterStaplesForBracket(CORE, 2, GC).excluded).toBe(0);
  });
});

describe('computeReadiness with a bracket and a collection', () => {
  const owned = new Set(
    ['Sol Ring', 'Arcane Signet', 'Swords to Plowshares', 'Rhystic Study', 'Cyclonic Rift'].map(
      (n) => n.toLowerCase()
    )
  );

  it('counts owned and missing against the bracket-cut pool', () => {
    const none = computeReadiness(ALL, owned);
    const b2 = computeReadiness(ALL, owned, { bracket: 2, gameChangers: GC, sampleDecks: 3183 });
    expect(none.ownedCount).toBe(5);
    // Rhystic Study and Cyclonic Rift are barred in bracket 2, so they no longer count.
    expect(b2.ownedCount).toBe(3);
    expect(b2.totalCount).toBe(100);
    expect(b2.missingNames).toHaveLength(97);
    expect(b2.missingNames).not.toContain('Rhystic Study');
    expect(b2.excludedGameChangers).toBe(10);
    expect(b2.sampleDecks).toBe(3183);
    expect(b2.bracket).toBe(2);
  });

  it('weights by inclusion: owning the top cards counts for more than the count says', () => {
    const top = computeReadiness(ALL, new Set(['sol ring', 'arcane signet']));
    expect(top.percent).toBe(2);
    expect(top.weightedPercent).toBeGreaterThan(top.percent);
    const tail = computeReadiness(
      ALL,
      new Set(ALL.slice(98, 100).map((s) => s.name.toLowerCase()))
    );
    expect(tail.percent).toBe(2);
    expect(tail.weightedPercent).toBeLessThan(top.weightedPercent ?? 0);
  });

  it('names owned staples held by another deck', () => {
    const heldBy = new Map([['sol ring', ['Atraxa']]]);
    const score = computeReadiness(ALL, owned, { heldBy });
    expect(score.heldElsewhere).toEqual([{ name: 'Sol Ring', decks: ['Atraxa'] }]);
    expect(heldLine(score)).toBe('1 you own is in your Atraxa deck');
    expect(heldLine(computeReadiness(ALL, owned))).toBeNull();
  });

  it('is unavailable without staples, never a 0%', () => {
    expect(computeReadiness([], owned, { bracket: 2, gameChangers: GC }).available).toBe(false);
  });
});

describe('completionCost', () => {
  it('sums the missing staples and counts the unpriced ones', () => {
    const score = computeReadiness(ALL.slice(0, 4), new Set(['sol ring']));
    const prices = new Map([
      ['arcane signet', 1.5],
      ['tekuthal, inquiry dominus', 2.25],
    ]);
    // Evolution Sage has no price in the map.
    expect(score.missingNames).toHaveLength(3);
    expect(completionCost(score, prices)).toEqual({ total: 3.75, priced: 2, unpriced: 1 });
  });
});

describe('basisLine', () => {
  it('shows the bracket, the sample and the Game Changers left out', () => {
    const score = computeReadiness(ALL, new Set(), {
      bracket: 2,
      gameChangers: GC,
      sampleDecks: 3183,
    });
    expect(basisLine(score)).toBe('Bracket 2 · 3,183 decks · 10 Game Changers left out');
  });

  it('says so when the bracket page was too thin', () => {
    const score = computeReadiness(ALL, new Set(), {
      bracket: 1,
      gameChangers: GC,
      sampleDecks: 45865,
      broadFallback: true,
    });
    expect(basisLine(score)).toBe(
      'Too few Exhibition decks, so all brackets · 45,865 decks · 10 Game Changers left out'
    );
  });

  it('is just the deck count with no bracket', () => {
    expect(basisLine(computeReadiness(ALL, new Set(), { sampleDecks: 45865 }))).toBe(
      '45,865 decks'
    );
  });
});

describe('heldByDecks', () => {
  const copy = (name: string, copyId: string) => ({ name, copyId }) as EnrichedCard;
  const claim = (deckName: string, ownerKind: 'deck' | 'cube' = 'deck') =>
    ({ ownerKind, deckName, ownerName: deckName }) as AllocationInfo;

  it('lists a name only when every copy is in a deck', () => {
    const cards = [
      copy('Sol Ring', 'a'),
      copy('Arcane Signet', 'b'),
      copy('Arcane Signet', 'c'),
      copy('Swords to Plowshares', 'd'),
    ];
    const held = heldByDecks(
      cards,
      new Map([
        ['a', claim('Atraxa')],
        ['b', claim('Atraxa')],
      ])
    );
    // Sol Ring: its one copy is in Atraxa. Arcane Signet has a spare copy.
    expect([...held.keys()]).toEqual(['sol ring']);
    expect(held.get('sol ring')).toEqual(['Atraxa']);
  });

  it('ignores cube claims', () => {
    const held = heldByDecks([copy('Sol Ring', 'a')], new Map([['a', claim('My cube', 'cube')]]));
    expect(held.size).toBe(0);
  });
});
