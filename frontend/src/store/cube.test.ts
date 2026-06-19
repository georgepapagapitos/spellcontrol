// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { useCubeStore } from './cube';
import { migrateLegacyCubes } from '../lib/sync';
import type { GeneratedCube } from '../lib/cube/generate';
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
  useCubeStore.setState({ size: 540, result: null, saved: [] });
  localStorage.clear();
  await estore.wipeAll();
  await queue.clear();
});

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

  it('renameSaved and removeSaved mutate the right entry', () => {
    useCubeStore.getState().setResult(360, makeCube(360));
    useCubeStore.getState().saveCurrent('Old name');
    const id = useCubeStore.getState().saved[0].id;
    useCubeStore.getState().renameSaved(id, 'New name');
    expect(useCubeStore.getState().saved[0].name).toBe('New name');
    useCubeStore.getState().removeSaved(id);
    expect(useCubeStore.getState().saved).toHaveLength(0);
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
