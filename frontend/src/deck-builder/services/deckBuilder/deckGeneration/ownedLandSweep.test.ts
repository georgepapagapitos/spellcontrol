// An "available only" mono-red Zo-Zu build (6 nonbasics) shipped Sokenzan and
// Memorial to War, neither owned. Whatever phase seats an unowned land, the
// sweep at the end of generation takes it back out. Real Scryfall oracle text.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { ScryfallCard, DeckCategory } from '@/deck-builder/types';

const FIXTURE = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '__fixtures__',
      'zozu-lands.fixture.json'
    ),
    'utf8'
  )
) as { cards: ScryfallCard[] };
const real = (n: string) => structuredClone(FIXTURE.cards.find((c) => c.name === n)!);

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCachedCard: (name: string) => real(name),
  getCardByName: async (name: string) => real(name),
  getFrontFaceTypeLine: (c: ScryfallCard) => c.type_line || '',
}));

import { sweepUnownedLands } from './ownedLandSweep';
import { landTopUpContextFor } from './landTopUp';

const OWNED = new Set(['Tectonic Edge', 'Ghost Quarter', 'Field of Ruin', 'Wasteland']);

function deckWith(lands: string[]) {
  const categories: Record<DeckCategory, ScryfallCard[]> = {
    lands: lands.map(real),
    ramp: [],
    cardDraw: [],
    singleRemoval: [],
    boardWipes: [],
    creatures: [],
    synergy: [],
    utility: [],
  };
  const state = { categories, usedNames: new Set(lands) };
  const topUp = landTopUpContextFor(['R'], categories, false, 'available', undefined);
  return { state, topUp };
}
const names = (cards: ScryfallCard[]) => cards.map((c) => c.name);

describe('sweepUnownedLands', () => {
  it('trades an unowned land for an owned spare, else a basic, keeping the land count', async () => {
    const { state, topUp } = deckWith([
      'Sokenzan, Crucible of Defiance',
      'Memorial to War',
      'Wasteland',
      'Mountain',
    ]);
    const removed = await sweepUnownedLands(
      state,
      OWNED,
      new Set(),
      [real('Tectonic Edge')],
      topUp
    );
    expect(removed).toEqual(['Sokenzan, Crucible of Defiance', 'Memorial to War']);
    const lands = names(state.categories.lands);
    expect(lands).toHaveLength(4);
    expect(lands).toEqual(expect.arrayContaining(['Tectonic Edge', 'Wasteland']));
    expect(lands.filter((n) => n === 'Mountain')).toHaveLength(2);
    expect(state.usedNames.has('Sokenzan, Crucible of Defiance')).toBe(false);
    expect(state.usedNames.has('Tectonic Edge')).toBe(true);
  });

  it('keeps a land the report names as a relaxation, and a must-include', async () => {
    const { state, topUp } = deckWith(['Sokenzan, Crucible of Defiance', 'Memorial to War']);
    state.categories.lands[1].isMustInclude = true;
    const removed = await sweepUnownedLands(
      state,
      OWNED,
      new Set(['Sokenzan, Crucible of Defiance']),
      [],
      topUp
    );
    expect(removed).toEqual([]);
    expect(names(state.categories.lands)).toEqual([
      'Sokenzan, Crucible of Defiance',
      'Memorial to War',
    ]);
  });

  it('does nothing without a collection', async () => {
    const { state, topUp } = deckWith(['Memorial to War']);
    expect(await sweepUnownedLands(state, undefined, new Set(), [], topUp)).toEqual([]);
    expect(names(state.categories.lands)).toEqual(['Memorial to War']);
  });
});
