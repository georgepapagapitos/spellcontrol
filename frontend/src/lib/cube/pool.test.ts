// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mergePools, fetchFriendCollection, namesToCubePool } from './pool';
import type { CubeCard } from './generate';
import type { FriendCard } from './pool';
import type { EnrichedCard } from '@/types';
import { loadCubeSignal, resetCubeSignalForTests } from './signal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCard(
  oracleId: string,
  name: string,
  rank?: number,
  extra?: Partial<CubeCard>
): CubeCard {
  return {
    oracleId,
    name,
    colors: ['W'],
    cmc: 2,
    typeLine: 'Creature — Human',
    role: null,
    rank,
    ...extra,
  };
}

function makeFriendCard(
  oracleId: string,
  name: string,
  rank?: number,
  extra?: Partial<FriendCard>
): FriendCard {
  return {
    oracleId,
    name,
    colors: ['W'],
    cmc: 2,
    typeLine: 'Creature — Human',
    edhrecRank: rank,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// mergePools
// ---------------------------------------------------------------------------

describe('mergePools', () => {
  it('deduplicates the same oracleId appearing in both me and a friend — one pool entry, both suppliers', () => {
    const myCards: CubeCard[] = [makeCard('oracle-1', 'Card A', 100)];
    const friendCards: FriendCard[] = [makeFriendCard('oracle-1', 'Card A', 200)];

    const { pool, supplierMap } = mergePools(myCards, 'alice', [
      { username: 'bob', cards: friendCards },
    ]);

    // Only one entry for this oracle.
    expect(pool.filter((c) => c.oracleId === 'oracle-1')).toHaveLength(1);
    expect(supplierMap.get('oracle-1')).toEqual(['alice', 'bob']);
  });

  it('keeps the lower-rank (better) copy when the same oracle appears in both', () => {
    const myCards: CubeCard[] = [makeCard('oracle-1', 'Card A', 500)];
    const friendCards: FriendCard[] = [makeFriendCard('oracle-1', 'Card A', 50)];

    const { pool } = mergePools(myCards, 'alice', [{ username: 'bob', cards: friendCards }]);

    const entry = pool.find((c) => c.oracleId === 'oracle-1')!;
    // Friend has rank 50 < 500, so their copy should win.
    expect(entry.rank).toBe(50);
  });

  it('my copy wins when my rank is lower than the friend rank', () => {
    const myCards: CubeCard[] = [makeCard('oracle-1', 'Card A', 30)];
    const friendCards: FriendCard[] = [makeFriendCard('oracle-1', 'Card A', 300)];

    const { pool } = mergePools(myCards, 'alice', [{ username: 'bob', cards: friendCards }]);

    const entry = pool.find((c) => c.oracleId === 'oracle-1')!;
    expect(entry.rank).toBe(30);
  });

  it('skips cards with empty oracleId', () => {
    const myCards: CubeCard[] = [makeCard('', 'No Oracle', 100)];
    const friendCards: FriendCard[] = [makeFriendCard('', 'No Oracle Friend', 100)];

    const { pool, supplierMap } = mergePools(myCards, 'alice', [
      { username: 'bob', cards: friendCards },
    ]);

    expect(pool).toHaveLength(0);
    expect(supplierMap.size).toBe(0);
  });

  it('adds distinct friend cards not in my collection', () => {
    const myCards: CubeCard[] = [makeCard('oracle-1', 'Card A')];
    const friendCards: FriendCard[] = [makeFriendCard('oracle-2', 'Card B')];

    const { pool, supplierMap } = mergePools(myCards, 'alice', [
      { username: 'bob', cards: friendCards },
    ]);

    expect(pool).toHaveLength(2);
    expect(supplierMap.get('oracle-2')).toEqual(['bob']);
  });

  it('multiple friends can each supply the same oracle — all listed as suppliers', () => {
    const myCards: CubeCard[] = [];
    const friend1Cards: FriendCard[] = [makeFriendCard('oracle-shared', 'Shared Card')];
    const friend2Cards: FriendCard[] = [makeFriendCard('oracle-shared', 'Shared Card')];

    const { pool, supplierMap } = mergePools(myCards, 'alice', [
      { username: 'bob', cards: friend1Cards },
      { username: 'carol', cards: friend2Cards },
    ]);

    expect(pool.filter((c) => c.oracleId === 'oracle-shared')).toHaveLength(1);
    expect(supplierMap.get('oracle-shared')).toEqual(['bob', 'carol']);
  });

  it('assigns role:null to friend cards', () => {
    const myCards: CubeCard[] = [];
    const friendCards: FriendCard[] = [makeFriendCard('oracle-1', 'Card A')];

    const { pool } = mergePools(myCards, 'alice', [{ username: 'bob', cards: friendCards }]);

    expect(pool[0].role).toBeNull();
  });

  it('returns an empty pool when given empty inputs', () => {
    const { pool, supplierMap } = mergePools([], 'alice', []);
    expect(pool).toHaveLength(0);
    expect(supplierMap.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fetchFriendCollection
// ---------------------------------------------------------------------------

describe('fetchFriendCollection', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the parsed response on success', async () => {
    const payload = {
      ownerUsername: 'bob',
      cards: [makeFriendCard('oracle-1', 'Card A')],
    };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => payload,
    } as Response);

    const result = await fetchFriendCollection('friend-id-1');
    expect(result.ownerUsername).toBe('bob');
    expect(result.cards).toHaveLength(1);
  });

  it('throws on 403 (friend not authorised)', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    } as Response);

    await expect(fetchFriendCollection('friend-id-1')).rejects.toThrow();
  });

  it('throws on 401 (not authenticated)', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    } as Response);

    await expect(fetchFriendCollection('friend-id-1')).rejects.toThrow();
  });

  it('throws on 404 (friend not found)', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' }),
    } as Response);

    await expect(fetchFriendCollection('friend-id-1')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// namesToCubePool
// ---------------------------------------------------------------------------

describe('namesToCubePool', () => {
  const owned = [
    {
      name: 'Llanowar Elves',
      oracleId: 'own-elves',
      colors: ['G'],
      cmc: 1,
      typeLine: 'Creature — Elf Druid',
    },
    {
      name: 'Swords to Plowshares',
      oracleId: 'own-swords',
      colors: ['W'],
      cmc: 1,
      typeLine: 'Instant',
    },
  ] as unknown as EnrichedCard[];

  it('prefers oracle facts over the owned copy, and classifies synergy from the rules text', () => {
    const facts = new Map([
      [
        'Llanowar Elves',
        {
          name: 'Llanowar Elves',
          oracle_id: 'scry-elves',
          cmc: 1,
          type_line: 'Creature — Elf Druid',
          colors: ['G'],
          oracle_text: '{T}: Add {G}.',
          edhrec_rank: 120,
        },
      ],
    ]);
    const [elves, swords] = namesToCubePool(
      ['Llanowar Elves', 'Swords to Plowshares'],
      owned,
      facts
    );
    expect(elves.oracleId).toBe('scry-elves');
    expect(elves.rank).toBe(120);
    expect(elves.typeLine).toBe('Creature — Elf Druid');
    expect(Array.isArray(elves.synergyProducers)).toBe(true);
    // No facts → the owned copy fills identity/cost/type; rank stays unknown.
    expect(swords.oracleId).toBe('own-swords');
    expect(swords.cmc).toBe(1);
    expect(swords.colors).toEqual(['W']);
    expect(swords.rank).toBeUndefined();
  });

  it('falls back to a lowercase-name id for a card in neither source', () => {
    const [ghost] = namesToCubePool(['Ghost Card'], [], new Map());
    expect(ghost).toMatchObject({ oracleId: 'ghost card', colors: [], cmc: 0, typeLine: '' });
  });
});

describe('cube signal on the pool', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({
        generatedAt: '2026-09-11T00:00:00.000Z',
        cards: { 'Arcane Signet': [4.25, 1655], 'Lightning Bolt': [26.41, 1658] },
      }),
    }));
    await loadCubeSignal();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetCubeSignalForTests();
  });

  it('namesToCubePool attaches cubePop/cubeElo when the snapshot knows the card', () => {
    const [signet, unknown] = namesToCubePool(['Arcane Signet', 'Homemade Card'], [], new Map());
    expect(signet).toMatchObject({ cubePop: 4.25, cubeElo: 1655 });
    expect(unknown.cubePop).toBeUndefined();
    expect(unknown.cubeElo).toBeUndefined();
  });

  it('mergePools attaches the signal to friend cards and prefers the more-cubed copy', () => {
    const mine = [makeCard('o1', 'Lightning Bolt', 158)];
    const { pool } = mergePools(mine, 'me', [
      {
        username: 'pal',
        cards: [
          makeFriendCard('o1', 'Lightning Bolt', 158),
          makeFriendCard('o2', 'Arcane Signet', 3),
        ],
      },
    ]);
    const signet = pool.find((c) => c.oracleId === 'o2');
    expect(signet).toMatchObject({ cubePop: 4.25, cubeElo: 1655, rank: 3 });
  });
});
