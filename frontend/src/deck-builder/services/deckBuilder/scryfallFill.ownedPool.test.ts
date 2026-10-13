// E1003: an owned-only fill draws from the collection, not from the global
// edhrec-ordered page. The page holds 175 cards; filtering it by ownership left
// the owned backfill and the land fallback with only the globally-top owned
// cards, then the deck reached outside the collection.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { SubstituteCandidate } from './substituteFinder';
import ownedFixture from './__fixtures__/owned-collection.fixture.json';

const searchCards = vi.fn();
vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/scryfall/client')>()),
  searchCards: (...args: unknown[]) => searchCards(...args),
}));
vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardTags: () => [],
  validateCardRole: () => null,
}));

import { fillWithScryfall } from './scryfallFill';

// The collection: real green creatures from the recorded owned-collection fixture.
const POOL: SubstituteCandidate[] = (ownedFixture.pool as SubstituteCandidate[]).filter(
  (e) => e.typeLine?.includes('Creature') && e.colorIdentity.every((c) => c === 'G')
);
const OWNED = new Set(POOL.map((e) => e.name));

const toCard = (e: SubstituteCandidate): ScryfallCard => ({
  id: `id-${e.name}`,
  oracle_id: `o-${e.name}`,
  name: e.name,
  cmc: e.cmc ?? 2,
  type_line: e.typeLine ?? 'Creature',
  oracle_text: '',
  color_identity: e.colorIdentity,
  keywords: [],
  rarity: 'common',
  set: 'tst',
  set_name: 'Test',
  prices: { usd: '0.25' },
  legalities: { commander: 'legal' },
});

// The global page: 175 popular cards the player does not own.
const GLOBAL_PAGE: ScryfallCard[] = Array.from({ length: 175 }, (_, i) =>
  toCard({ name: `Popular Staple ${i}`, colorIdentity: ['G'], typeLine: 'Creature', cmc: 3 })
);

beforeEach(() => {
  searchCards.mockReset();
  // A Scryfall stand-in: a `!"Name" or …` clause returns exactly those cards.
  searchCards.mockImplementation(async (q: string) => {
    const wanted = [...q.matchAll(/!"([^"]+)"/g)].map((m) => m[1]);
    if (wanted.length === 0) return { data: GLOBAL_PAGE };
    const byName = new Map(POOL.map((e) => [e.name, e]));
    return { data: wanted.flatMap((n) => (byName.has(n) ? [toCard(byName.get(n)!)] : [])) };
  });
});

const fill = (ownedPool?: SubstituteCandidate[]) =>
  fillWithScryfall(
    't:creature',
    ['G'],
    8,
    new Set(),
    new Set(),
    null,
    null,
    null,
    null,
    OWNED,
    'USD',
    false,
    '',
    'full',
    false,
    false,
    undefined,
    undefined,
    ownedPool ? { ownedPool } : undefined,
    undefined,
    'spell'
  );

describe('fillWithScryfall draws an owned-only fill from the collection', () => {
  it('the global page holds none of the collection: without the pool the fill is empty', async () => {
    expect(await fill()).toEqual([]);
  });

  it('with the pool it seats owned cards the global page never showed', async () => {
    expect(POOL.length).toBeGreaterThan(40);
    const out = await fill(POOL);
    expect(out).toHaveLength(8);
    for (const c of out) expect(OWNED.has(c.name)).toBe(true);
  });

  it('asks Scryfall for the collection by name, under the fill query', async () => {
    await fill(POOL);
    const q = searchCards.mock.calls[0][0] as string;
    expect(q).toContain('t:creature');
    expect(q).toMatch(/!"[^"]+"/);
  });

  it('keeps going past the first chunk when its owned cards are all used', async () => {
    const first = POOL.slice(0, 30).map((e) => e.name);
    const used = new Set(first);
    const out = await fillWithScryfall(
      't:creature',
      ['G'],
      8,
      used,
      new Set(),
      null,
      null,
      null,
      null,
      OWNED,
      'USD',
      false,
      '',
      'full',
      false,
      false,
      undefined,
      undefined,
      { ownedPool: POOL },
      undefined,
      'spell'
    );
    expect(out).toHaveLength(8);
    for (const c of out) expect(first).not.toContain(c.name);
  });

  it('prefer mode still reads the global page: the pool is for owned-only fills', async () => {
    const out = await fillWithScryfall(
      't:creature',
      ['G'],
      3,
      new Set(),
      new Set(),
      null,
      null,
      null,
      null,
      OWNED,
      'USD',
      false,
      '',
      'prefer',
      false,
      false,
      undefined,
      undefined,
      { ownedPool: POOL },
      undefined,
      'spell'
    );
    expect(out.map((c) => c.name)).toEqual(GLOBAL_PAGE.slice(0, 3).map((c) => c.name));
  });
});
