// @vitest-environment node
//
// Contention over real cards and the real role tagger: which deck holds the only
// copy, and whether taking it drops that deck under a role target.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import { card } from '@/deck-builder/services/deckBuilder/deckObjective/__fixtures__/objectiveFixture';
import { committedElsewhere } from '@/lib/deck/held-elsewhere';
import type { AllocationInfo } from '@/lib/collection/allocations-core';
import { makeDeckAllocationInfo } from '@/lib/collection/allocations-core';
import type { Deck } from '@/store/decks';
import type { EnrichedCard } from '@/types/index';
import { contentionNote, holdsOf } from './contention';

beforeAll(async () => {
  const data = JSON.parse(
    readFileSync(
      'src/deck-builder/services/deckBuilder/__fixtures__/tagger-tags.fixture.json',
      'utf8'
    )
  );
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => data }));
  if (!(await loadTaggerData())) throw new Error('tagger data failed to load');
});
afterAll(() => vi.unstubAllGlobals());

const deck = (id: string, name: string, names: string[], roleTargets: Record<string, number>) =>
  ({
    id,
    name,
    cards: names.map((n, i) => ({ slotId: `${id}-${i}`, card: card(n), allocatedCopyId: null })),
    roleTargets,
  }) as unknown as Deck;

const copy = (name: string, copyId: string) => ({ name, copyId }) as unknown as EnrichedCard;
const claim = (deckId: string, deckName: string, copyId: string): [string, AllocationInfo] => [
  copyId,
  makeDeckAllocationInfo(deckId, deckName, '#000', 'x'),
];

describe('committedElsewhere', () => {
  it('names the other decks only when no copy is free', () => {
    const cards = [copy('Toxic Deluge', 'a'), copy('Sol Ring', 'b'), copy('Sol Ring', 'c')];
    const alloc = new Map([claim('atraxa', 'Atraxa', 'a'), claim('atraxa', 'Atraxa', 'b')]);
    const held = committedElsewhere(cards, alloc, 'meren');
    expect(held.get('toxic deluge')).toEqual([{ deckId: 'atraxa', deckName: 'Atraxa' }]);
    // A second Sol Ring is free, so nothing is committed.
    expect(held.has('sol ring')).toBe(false);
  });

  it('counts a copy in the viewing deck as free', () => {
    const cards = [copy('Toxic Deluge', 'a')];
    const held = committedElsewhere(cards, new Map([claim('meren', 'Meren', 'a')]), 'meren');
    expect(held.size).toBe(0);
  });

  it('leaves out a card held only by a cube', () => {
    const cube = makeDeckAllocationInfo('', 'My cube', '#000', 'x');
    const held = committedElsewhere(
      [copy('Toxic Deluge', 'a')],
      new Map([['a', { ...cube, ownerKind: 'cube' as const }]]),
      'meren'
    );
    expect(held.size).toBe(0);
  });
});

describe('what taking a card costs the deck holding it', () => {
  const holders = [{ deckId: 'atraxa', deckName: 'Atraxa' }];

  it('says the deck is left short of a sweeper when its count drops under target', () => {
    const atraxa = deck('atraxa', 'Atraxa', ['Toxic Deluge', 'Blasphemous Act'], { boardwipe: 2 });
    const [hold] = holdsOf('Toxic Deluge', holders, [atraxa]);
    expect(hold).toMatchObject({ role: 'boardwipe', left: 1, target: 2, short: true });
    expect(contentionNote([hold])).toBe(
      'In your Atraxa deck. Taking it leaves that deck short on board wipes (1 of 2).'
    );
  });

  it('says without any when it is the only one', () => {
    const atraxa = deck('atraxa', 'Atraxa', ['Toxic Deluge', 'Sol Ring'], { boardwipe: 1 });
    expect(contentionNote(holdsOf('Toxic Deluge', holders, [atraxa]))).toBe(
      'In your Atraxa deck. Taking it leaves that deck without any board wipes.'
    );
  });

  it('only names the deck when its role stays at target', () => {
    const atraxa = deck('atraxa', 'Atraxa', ['Toxic Deluge', 'Blasphemous Act', 'Wrath of God'], {
      boardwipe: 2,
    });
    const [hold] = holdsOf('Toxic Deluge', holders, [atraxa]);
    expect(hold.short).toBe(false);
    expect(contentionNote([hold])).toBe(
      'In your Atraxa deck. Taking it leaves a slot to refill there.'
    );
  });

  it('has nothing to say about a free card', () => {
    expect(holdsOf('Toxic Deluge', undefined, [])).toEqual([]);
    expect(contentionNote([])).toBeUndefined();
  });
});
