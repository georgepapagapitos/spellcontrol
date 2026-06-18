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
  useCubeStore.setState({ size: 540, result: null });
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
