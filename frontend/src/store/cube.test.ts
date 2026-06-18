import { describe, it, expect, beforeEach } from 'vitest';
import { useCubeStore } from './cube';
import type { GeneratedCube } from '../lib/cube/generate';

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

beforeEach(() => {
  useCubeStore.setState({ size: 540, result: null, saved: [] });
  localStorage.clear();
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
});
