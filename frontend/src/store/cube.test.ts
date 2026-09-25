// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { flushSync } from '../lib/sync';
import { useCubeStore, type CubePickSlot, type SavedCube } from './cube';
import { migrateLegacyCubes } from '../lib/sync';
import {
  bucketOf,
  generateCube,
  type CubeCard,
  type GeneratedCube,
  type Pick,
} from '../lib/cube/generate';
import type { EnrichedCard } from '../types';
import type { Deck } from './decks';
import * as queue from '../lib/mutation-queue';
import * as estore from '../lib/entity-store';

function makeCube(size: 360 | 540 = 360): GeneratedCube {
  return {
    size,
    picks: [],
    byBucket: { W: 0, U: 0, B: 0, R: 0, G: 0, multicolor: 0, colorless: 0, land: 0 },
    targetByBucket: { W: 0, U: 0, B: 0, R: 0, G: 0, multicolor: 0, colorless: 0, land: 0 },
    gaps: [],
    shortfall: 0,
    poolSize: 0,
  };
}

function cardOf(oracleId: string, overrides: Partial<CubeCard> = {}): CubeCard {
  return {
    name: overrides.name ?? oracleId,
    oracleId,
    colors: overrides.colors ?? ['R'],
    cmc: overrides.cmc ?? 2,
    typeLine: overrides.typeLine ?? 'Creature — Goblin',
    role: overrides.role ?? null,
  };
}

function cubeWithPicks(cards: CubeCard[], size: 360 | 540 = 360): GeneratedCube {
  const picks: Pick[] = cards.map((c) => ({ card: c, bucket: bucketOf(c), reason: '' }));
  const byBucket = { W: 0, U: 0, B: 0, R: 0, G: 0, multicolor: 0, colorless: 0, land: 0 };
  for (const p of picks) byBucket[p.bucket]++;
  return {
    size,
    picks,
    byBucket,
    targetByBucket: { ...byBucket },
    gaps: [],
    shortfall: 0,
    poolSize: cards.length,
    score: { total: 0.5 } as never, // stale score, cleared by any pick-editing action
  };
}

function enrichedCard(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: 'copy-1',
    name: 'Card',
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'uncommon',
    scryfallId: 'sf-1',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    ...overrides,
  } as EnrichedCard;
}

function physicalSaved(overrides: Partial<SavedCube> = {}): SavedCube {
  return {
    id: 'cube-1',
    name: 'Physical',
    size: 360,
    cube: cubeWithPicks([cardOf('a'), cardOf('b')]),
    isPhysical: true,
    savedAt: 0,
    picks: [
      {
        slotId: '0',
        card: cardOf('a'),
        allocatedCopyId: 'copy-a',
        printingFinishKey: 'sf-a:nonfoil',
      },
      {
        slotId: '1',
        card: cardOf('b'),
        allocatedCopyId: 'copy-b',
        printingFinishKey: 'sf-b:nonfoil',
      },
    ] as CubePickSlot[],
    ...overrides,
  };
}

/** Poll the queue until a predicate passes or a budget elapses (subscriber-driven writes are async). */
async function waitForQueue(
  pred: (ops: Array<{ op: string; kind: string; id: string }>) => boolean,
  budgetMs = 500
): Promise<Array<{ op: string; kind: string; id: string }>> {
  const start = Date.now();
  while (Date.now() - start < budgetMs) {
    const batch = await queue.peekBatch(1000);
    const ops = batch.map(({ m }) => ({ op: m.op, kind: m.kind, id: m.id }));
    if (pred(ops)) return ops;
    await new Promise((r) => setTimeout(r, 10));
  }
  const batch = await queue.peekBatch(1000);
  return batch.map(({ m }) => ({ op: m.op, kind: m.kind, id: m.id }));
}

beforeEach(async () => {
  estore._resetDbPromiseForTests();
  queue._resetDbPromiseForTests();
  useCubeStore.setState({ size: 540, result: null, loadedId: null, saved: [] });
  localStorage.clear();
  await estore.wipeAll();
  await queue.clear();
});

// Drop the push debounce a mutation armed, so no timer outlives the test.
afterEach(() => flushSync());

describe('useCubeStore', () => {
  it('starts with no result', () => {
    expect(useCubeStore.getState().result).toBeNull();
    expect(useCubeStore.getState().size).toBe(540);
  });

  it('setResult stores size and cube', () => {
    const cube = makeCube(360);
    useCubeStore.getState().setResult(360, cube);
    const state = useCubeStore.getState();
    expect(state.size).toBe(360);
    expect(state.result).toBe(cube);
  });

  it('clear removes result', () => {
    useCubeStore.getState().setResult(360, makeCube(360));
    useCubeStore.getState().clear();
    expect(useCubeStore.getState().result).toBeNull();
  });

  it('size is preserved after clear', () => {
    useCubeStore.getState().setResult(360, makeCube(360));
    useCubeStore.getState().clear();
    // size is not cleared — user's last chosen size should persist
    expect(useCubeStore.getState().size).toBe(360);
  });
});

describe('useCubeStore — saved cubes', () => {
  it('saveCurrent snapshots the working cube (newest first) with its own size', () => {
    useCubeStore.getState().setResult(360, makeCube(360));
    useCubeStore.getState().saveCurrent('First');
    useCubeStore.getState().setResult(540, makeCube(540));
    useCubeStore.getState().saveCurrent('Second');
    const saved = useCubeStore.getState().saved;
    expect(saved.map((c) => c.name)).toEqual(['Second', 'First']);
    expect(saved[0].size).toBe(540);
    expect(saved[1].size).toBe(360);
    expect(saved[0].id).not.toBe(saved[1].id);
  });

  it('saveCurrent is a no-op when there is no working cube', () => {
    useCubeStore.getState().saveCurrent('Nothing');
    expect(useCubeStore.getState().saved).toHaveLength(0);
  });

  it('clear keeps saved cubes; only the working result drops', () => {
    useCubeStore.getState().setResult(360, makeCube(360));
    useCubeStore.getState().saveCurrent('Keep me');
    useCubeStore.getState().clear();
    expect(useCubeStore.getState().result).toBeNull();
    expect(useCubeStore.getState().saved).toHaveLength(1);
  });

  it('loadSaved makes a saved cube the working result (and restores its size)', () => {
    useCubeStore.getState().setResult(360, makeCube(360));
    useCubeStore.getState().saveCurrent('Loadable');
    useCubeStore.getState().clear();
    const id = useCubeStore.getState().saved[0].id;
    useCubeStore.getState().loadSaved(id);
    expect(useCubeStore.getState().result).not.toBeNull();
    expect(useCubeStore.getState().size).toBe(360);
  });

  it('loadedId tracks which saved cube the working result is', () => {
    const s = () => useCubeStore.getState();
    s().setResult(360, makeCube(360));
    expect(s().loadedId).toBeNull(); // a fresh build is nobody's cube yet
    s().saveCurrent('Kept');
    const id = s().saved[0].id;
    expect(s().loadedId).toBe(id); // saving makes the working cube THAT cube
    s().setResult(540, makeCube(540));
    expect(s().loadedId).toBeNull(); // a rebuild is a new, unsaved cube again
    s().loadSaved(id);
    expect(s().loadedId).toBe(id);
    s().clear();
    expect(s().loadedId).toBeNull();
  });

  it('removeSaved of the cube on screen drops the working result with it', () => {
    const s = () => useCubeStore.getState();
    s().setResult(360, makeCube(360));
    s().saveCurrent('A');
    const a = s().saved[0].id;
    s().setResult(360, makeCube(360));
    s().saveCurrent('B');
    s().loadSaved(a);
    s().removeSaved(s().saved.find((c) => c.name === 'B')!.id);
    expect(s().result).not.toBeNull(); // deleting ANOTHER cube leaves the view alone
    expect(s().loadedId).toBe(a);
    s().removeSaved(a);
    expect(s().result).toBeNull();
    expect(s().loadedId).toBeNull();
  });

  it('renameSaved and removeSaved mutate the right entry', () => {
    useCubeStore.getState().setResult(360, makeCube(360));
    useCubeStore.getState().saveCurrent('Old name');
    const id = useCubeStore.getState().saved[0].id;
    useCubeStore.getState().renameSaved(id, 'New name');
    expect(useCubeStore.getState().saved[0].name).toBe('New name');
    useCubeStore.getState().removeSaved(id);
    expect(useCubeStore.getState().saved).toHaveLength(0);
  });

  it('releaseCubePick nulls the matching pick (leave-gap) and leaves others intact', () => {
    useCubeStore.setState({
      saved: [
        {
          id: 'cube-1',
          name: 'Physical',
          size: 360,
          cube: makeCube(360),
          isPhysical: true,
          savedAt: 0,
          picks: [
            {
              slotId: '0',
              card: { name: 'Sol Ring' } as never,
              allocatedCopyId: 'copy-a',
              printingFinishKey: 'sf-1:nonfoil',
            },
            {
              slotId: '1',
              card: { name: 'Arcane Signet' } as never,
              allocatedCopyId: 'copy-b',
              printingFinishKey: 'sf-2:nonfoil',
            },
          ],
        },
      ],
    });
    useCubeStore.getState().releaseCubePick('cube-1', 'copy-a');
    const picks = useCubeStore.getState().saved[0].picks;
    // The released pick keeps its card but drops the copy + printing shadow.
    expect(picks[0]).toMatchObject({ allocatedCopyId: null, printingFinishKey: null });
    expect(picks[0].card.name).toBe('Sol Ring');
    // The sibling pick is untouched.
    expect(picks[1].allocatedCopyId).toBe('copy-b');
  });

  it('releaseCubePick is a no-op when no pick holds the copy', () => {
    useCubeStore.setState({
      saved: [
        {
          id: 'cube-1',
          name: 'Physical',
          size: 360,
          cube: makeCube(360),
          isPhysical: true,
          savedAt: 0,
          picks: [
            {
              slotId: '0',
              card: { name: 'Sol Ring' } as never,
              allocatedCopyId: 'copy-a',
              printingFinishKey: 'sf-1:nonfoil',
            },
          ],
        },
      ],
    });
    useCubeStore.getState().releaseCubePick('cube-1', 'nonexistent');
    expect(useCubeStore.getState().saved[0].picks[0].allocatedCopyId).toBe('copy-a');
  });

  it('reset wipes both the working result and every saved cube (logout)', () => {
    useCubeStore.getState().setResult(360, makeCube(360));
    useCubeStore.getState().saveCurrent('Gone on logout');
    useCubeStore.getState().reset();
    expect(useCubeStore.getState().result).toBeNull();
    expect(useCubeStore.getState().saved).toHaveLength(0);
  });

  it('saved cubes are NOT written to localStorage (size/result only persisted)', async () => {
    useCubeStore.getState().setResult(360, makeCube(360));
    useCubeStore.getState().saveCurrent('My cube');
    // Give zustand-persist a tick to flush
    await new Promise((r) => setTimeout(r, 20));
    const raw = localStorage.getItem('spellcontrol-cube');
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
      // saved must not be in the persisted blob
      expect(parsed.state).not.toHaveProperty('saved');
    }
    // saved is in memory
    expect(useCubeStore.getState().saved).toHaveLength(1);
  });
});

describe('useCubeStore — lock / ban', () => {
  it('toggleLock adds then removes an oracleId', () => {
    useCubeStore.setState({ saved: [{ ...physicalSaved(), isPhysical: false, picks: [] }] });
    useCubeStore.getState().toggleLock('cube-1', 'a');
    expect(useCubeStore.getState().saved[0].locked).toEqual(['a']);
    useCubeStore.getState().toggleLock('cube-1', 'a');
    expect(useCubeStore.getState().saved[0].locked).toEqual([]);
  });

  it('toggleLock works on an old saved cube with no locked field (undefined → [])', () => {
    const legacy: SavedCube = {
      id: 'legacy',
      name: 'Old',
      size: 360,
      cube: cubeWithPicks([cardOf('a')]),
      isPhysical: false,
      savedAt: 0,
      picks: [],
      // no `locked`, `banned`, or `settings` — as a pre-feature synced row.
    };
    useCubeStore.setState({ saved: [legacy] });
    useCubeStore.getState().toggleLock('legacy', 'a');
    expect(useCubeStore.getState().saved[0].locked).toEqual(['a']);
  });

  it('banCard bans, un-locks, and drops the pick (non-physical)', () => {
    useCubeStore.setState({
      saved: [{ ...physicalSaved(), isPhysical: false, picks: [], locked: ['a'] }],
    });
    useCubeStore.getState().banCard('cube-1', 'a');
    const c = useCubeStore.getState().saved[0];
    expect(c.banned).toEqual(['a']);
    expect(c.locked).toEqual([]);
    expect(c.cube.picks.map((p) => p.card.oracleId)).toEqual(['b']);
    expect(c.cube.byBucket).toEqual(expect.objectContaining({ [c.cube.picks[0].bucket]: 1 }));
    expect(c.cube.score).toBeUndefined(); // stale score cleared
  });

  it('banning a locked card releases its copy on a physical cube', () => {
    useCubeStore.setState({ saved: [physicalSaved({ locked: ['a'] })] });
    useCubeStore.getState().banCard('cube-1', 'a');
    const c = useCubeStore.getState().saved[0];
    expect(c.locked).toEqual([]);
    expect(c.picks.map((p) => p.card.oracleId)).toEqual(['b']); // slot for 'a' is gone (released)
    expect(c.picks[0].allocatedCopyId).toBe('copy-b'); // sibling binding untouched
  });

  it('banCard is a no-op on picks when the card is not currently in the cube', () => {
    useCubeStore.setState({ saved: [{ ...physicalSaved(), isPhysical: false, picks: [] }] });
    useCubeStore.getState().banCard('cube-1', 'not-in-cube');
    const c = useCubeStore.getState().saved[0];
    expect(c.banned).toEqual(['not-in-cube']);
    expect(c.cube.picks.map((p) => p.card.oracleId)).toEqual(['a', 'b']); // untouched
  });

  it('unbanCard removes the ban without re-adding the pick', () => {
    useCubeStore.setState({
      saved: [{ ...physicalSaved(), isPhysical: false, picks: [], banned: ['a'] }],
    });
    useCubeStore.getState().unbanCard('cube-1', 'a');
    const c = useCubeStore.getState().saved[0];
    expect(c.banned).toEqual([]);
    expect(c.cube.picks.map((p) => p.card.oracleId)).toEqual(['a', 'b']); // never removed to begin with
  });
});

describe('useCubeStore — swapPick / removePick / addPick', () => {
  it('swapPick replaces the pick at the given index (non-physical)', () => {
    useCubeStore.setState({ saved: [{ ...physicalSaved(), isPhysical: false, picks: [] }] });
    useCubeStore.getState().swapPick('cube-1', 0, cardOf('c'));
    const c = useCubeStore.getState().saved[0];
    expect(c.cube.picks.map((p) => p.card.oracleId)).toEqual(['c', 'b']);
    expect(c.cube.score).toBeUndefined();
  });

  it('swapPick refuses to introduce a duplicate oracleId already elsewhere in the cube', () => {
    useCubeStore.setState({ saved: [{ ...physicalSaved(), isPhysical: false, picks: [] }] });
    useCubeStore.getState().swapPick('cube-1', 0, cardOf('b')); // 'b' is already pick 1
    expect(useCubeStore.getState().saved[0].cube.picks.map((p) => p.card.oracleId)).toEqual([
      'a',
      'b',
    ]); // unchanged
  });

  it('swapPick on a physical cube releases the old copy and binds the new card', () => {
    const collection: EnrichedCard[] = [
      enrichedCard({ copyId: 'copy-a', name: 'a' }),
      enrichedCard({ copyId: 'copy-b', name: 'b' }),
      enrichedCard({ copyId: 'copy-c', name: 'c' }),
    ];
    useCubeStore.setState({ saved: [physicalSaved()] });
    useCubeStore.getState().swapPick('cube-1', 0, cardOf('c'), collection, [] as Deck[]);
    const c = useCubeStore.getState().saved[0];
    expect(c.picks[0].card.oracleId).toBe('c');
    expect(c.picks[0].allocatedCopyId).toBe('copy-c'); // freshly bound
    expect(c.picks[1].allocatedCopyId).toBe('copy-b'); // sibling untouched
    // 'copy-a' is free again — nothing in the cube's picks references it.
    expect(c.picks.some((p) => p.allocatedCopyId === 'copy-a')).toBe(false);
  });

  it('removePick drops the pick and recomputes byBucket/shortfall', () => {
    useCubeStore.setState({ saved: [{ ...physicalSaved(), isPhysical: false, picks: [] }] });
    useCubeStore.getState().removePick('cube-1', 0);
    const c = useCubeStore.getState().saved[0];
    expect(c.cube.picks.map((p) => p.card.oracleId)).toEqual(['b']);
    expect(c.cube.shortfall).toBe(359); // size 360, 1 pick left
    expect(c.cube.score).toBeUndefined();
  });

  it('removePick on a physical cube releases the copy (no rebind needed)', () => {
    useCubeStore.setState({ saved: [physicalSaved()] });
    useCubeStore.getState().removePick('cube-1', 0);
    const c = useCubeStore.getState().saved[0];
    expect(c.picks).toHaveLength(1);
    expect(c.picks[0].card.oracleId).toBe('b');
    expect(c.picks[0].allocatedCopyId).toBe('copy-b');
  });

  it('addPick appends a new pick', () => {
    useCubeStore.setState({ saved: [{ ...physicalSaved(), isPhysical: false, picks: [] }] });
    useCubeStore.getState().addPick('cube-1', cardOf('c'));
    const c = useCubeStore.getState().saved[0];
    expect(c.cube.picks.map((p) => p.card.oracleId)).toEqual(['a', 'b', 'c']);
  });

  it('addPick is a no-op for a card already in the cube', () => {
    useCubeStore.setState({ saved: [{ ...physicalSaved(), isPhysical: false, picks: [] }] });
    useCubeStore.getState().addPick('cube-1', cardOf('a'));
    expect(useCubeStore.getState().saved[0].cube.picks).toHaveLength(2);
  });

  it('addPick is a no-op for a banned card', () => {
    useCubeStore.setState({
      saved: [{ ...physicalSaved(), isPhysical: false, picks: [], banned: ['c'] }],
    });
    useCubeStore.getState().addPick('cube-1', cardOf('c'));
    expect(useCubeStore.getState().saved[0].cube.picks.map((p) => p.card.oracleId)).toEqual([
      'a',
      'b',
    ]);
  });

  it('addPick on a physical cube binds a free copy, leaving existing bindings alone', () => {
    const collection: EnrichedCard[] = [
      enrichedCard({ copyId: 'copy-a', name: 'a' }),
      enrichedCard({ copyId: 'copy-b', name: 'b' }),
      enrichedCard({ copyId: 'copy-c', name: 'c' }),
    ];
    useCubeStore.setState({ saved: [physicalSaved()] });
    useCubeStore.getState().addPick('cube-1', cardOf('c'), collection, [] as Deck[]);
    const c = useCubeStore.getState().saved[0];
    expect(c.picks[0].allocatedCopyId).toBe('copy-a');
    expect(c.picks[1].allocatedCopyId).toBe('copy-b');
    expect(c.picks[2].card.oracleId).toBe('c');
    expect(c.picks[2].allocatedCopyId).toBe('copy-c');
  });
});

describe('useCubeStore — replaceCube ("Rebuild the rest")', () => {
  it('swaps the generated cube and preserves physical bindings for surviving cards', () => {
    const collection: EnrichedCard[] = [
      enrichedCard({ copyId: 'copy-a', name: 'a' }),
      enrichedCard({ copyId: 'copy-b', name: 'b' }),
      enrichedCard({ copyId: 'copy-c', name: 'c' }),
    ];
    useCubeStore.setState({ saved: [physicalSaved()] });
    // Rebuild keeps 'a' (locked, say) and swaps 'b' for a new 'c'.
    const rebuilt = cubeWithPicks([cardOf('a'), cardOf('c')]);
    useCubeStore.getState().replaceCube('cube-1', rebuilt, collection, [] as Deck[]);
    const c = useCubeStore.getState().saved[0];
    expect(c.cube.picks.map((p) => p.card.oracleId)).toEqual(['a', 'c']);
    expect(c.picks[0].allocatedCopyId).toBe('copy-a'); // preserved
    expect(c.picks[1].allocatedCopyId).toBe('copy-c'); // freshly bound
  });

  it('leaves picks empty for a non-physical cube', () => {
    useCubeStore.setState({ saved: [{ ...physicalSaved(), isPhysical: false, picks: [] }] });
    const rebuilt = cubeWithPicks([cardOf('a')]);
    useCubeStore.getState().replaceCube('cube-1', rebuilt);
    expect(useCubeStore.getState().saved[0].picks).toEqual([]);
  });

  it('does not touch locked/banned/settings — only the generated cube and bindings', () => {
    useCubeStore.setState({
      saved: [{ ...physicalSaved(), isPhysical: false, picks: [], locked: ['a'], banned: ['z'] }],
    });
    useCubeStore.getState().replaceCube('cube-1', cubeWithPicks([cardOf('a')]));
    const c = useCubeStore.getState().saved[0];
    expect(c.locked).toEqual(['a']);
    expect(c.banned).toEqual(['z']);
  });
});

describe('useCubeStore — locking a card then rebuilding keeps it (integration)', () => {
  it('a locked pick survives generateCube run again with it in `locked`', () => {
    // A small owned pool, generate once, lock one of the resulting picks, then
    // rebuild with that card excluded from the pool entirely (as if it had
    // since been sold) — it must still come back via `locked`.
    const pool: CubeCard[] = [];
    for (const colors of [['W'], ['U'], ['B'], ['R'], ['G']] as CubeCard['colors'][]) {
      for (let i = 0; i < 90; i++) {
        pool.push(cardOf(`${colors[0]}-${i}`, { colors, cmc: i % 8 }));
      }
    }
    for (let i = 0; i < 90; i++) pool.push(cardOf(`land-${i}`, { colors: [], typeLine: 'Land' }));

    const first = generateCube(pool, 360);
    const lockedCard = first.picks[0].card;

    useCubeStore.setState({
      saved: [
        {
          id: 'cube-1',
          name: 'Lock test',
          size: 360,
          cube: first,
          isPhysical: false,
          savedAt: 0,
          picks: [],
        },
      ],
    });
    useCubeStore.getState().toggleLock('cube-1', lockedCard.oracleId);
    expect(useCubeStore.getState().saved[0].locked).toEqual([lockedCard.oracleId]);

    // Rebuild without the locked card in the pool — still comes back.
    const poolWithoutLocked = pool.filter((c) => c.oracleId !== lockedCard.oracleId);
    const rebuilt = generateCube(poolWithoutLocked, 360, { locked: [lockedCard] });
    useCubeStore.getState().replaceCube('cube-1', rebuilt);
    expect(
      useCubeStore
        .getState()
        .saved[0].cube.picks.some((p) => p.card.oracleId === lockedCard.oracleId)
    ).toBe(true);
  });
});

describe('useCubeStore — sync subscriber (via IDB queue)', () => {
  it('saving a cube enqueues a cube upsert in the sync queue', async () => {
    useCubeStore.getState().setResult(360, makeCube(360));
    useCubeStore.getState().saveCurrent('Sync me');

    const id = useCubeStore.getState().saved[0].id;
    const ops = await waitForQueue((o) =>
      o.some((x) => x.op === 'upsert' && x.kind === 'cube' && x.id === id)
    );
    expect(ops.some((o) => o.op === 'upsert' && o.kind === 'cube' && o.id === id)).toBe(true);
  });

  it('removing a saved cube enqueues a cube delete', async () => {
    useCubeStore.getState().setResult(360, makeCube(360));
    useCubeStore.getState().saveCurrent('To delete');
    const id = useCubeStore.getState().saved[0].id;
    await queue.clear();

    useCubeStore.getState().removeSaved(id);
    const ops = await waitForQueue((o) =>
      o.some((x) => x.op === 'delete' && x.kind === 'cube' && x.id === id)
    );
    expect(ops.some((o) => o.op === 'delete' && o.kind === 'cube' && o.id === id)).toBe(true);
  });
});

describe('migrateLegacyCubes — pre-sync localStorage → IDB/sync', () => {
  it('moves legacy localStorage cubes into IDB + the sync queue, then strips the blob', async () => {
    const legacy = {
      state: {
        size: 540,
        result: null,
        saved: [
          { id: 'legacy-1', name: 'Old cube', size: 540, cube: makeCube(540), savedAt: 1000 },
        ],
      },
      version: 0,
    };
    localStorage.setItem('spellcontrol-cube', JSON.stringify(legacy));

    await migrateLegacyCubes();

    // Enqueued for upload as a cube row…
    const ops = await waitForQueue((o) =>
      o.some((x) => x.op === 'upsert' && x.kind === 'cube' && x.id === 'legacy-1')
    );
    expect(ops.some((o) => o.op === 'upsert' && o.kind === 'cube' && o.id === 'legacy-1')).toBe(
      true
    );
    // …written to IDB so the next hydrate shows it without a flash…
    expect(await estore.getById('cube', 'legacy-1')).toBeTruthy();
    // …and `saved` stripped from the blob so it never runs twice.
    const after = JSON.parse(localStorage.getItem('spellcontrol-cube')!) as {
      state?: { saved?: unknown };
    };
    expect(after.state?.saved).toBeUndefined();
  });

  it('is a no-op with no legacy blob (and idempotent on a second run)', async () => {
    await migrateLegacyCubes();
    expect(await queue.peekBatch(1000)).toHaveLength(0);
  });
});
