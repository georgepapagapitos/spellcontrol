import { afterEach, describe, expect, it, vi } from 'vitest';
import { cubeSignalOf, hasCubeSignal, loadCubeSignal, resetCubeSignalForTests } from './signal';

const snapshot = {
  generatedAt: '2026-09-11T00:00:00.000Z',
  cards: {
    'Lightning Bolt': [26.41, 1658],
    'Arcane Signet': [4.25, 1655],
    'Bonecrusher Giant': [9.5, 1600],
  },
};

function stubFetch(impl: () => Promise<Partial<Response>>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetCubeSignalForTests();
});

describe('loadCubeSignal', () => {
  it('loads the snapshot once and answers lookups from it', async () => {
    const fetchMock = stubFetch(async () => ({ ok: true, json: async () => snapshot }));
    expect(hasCubeSignal()).toBe(false);
    expect(cubeSignalOf('Lightning Bolt')).toEqual({});
    await Promise.all([loadCubeSignal(), loadCubeSignal()]);
    await loadCubeSignal();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/cube-signal.json', expect.anything());
    expect(hasCubeSignal()).toBe(true);
    expect(cubeSignalOf('Lightning Bolt')).toEqual({ cubePop: 26.41, cubeElo: 1658 });
    expect(cubeSignalOf('Arcane Signet')).toEqual({ cubePop: 4.25, cubeElo: 1655 });
    expect(cubeSignalOf('Never Cubed')).toEqual({});
    // CubeCobra keys a DFC by its front face; our names carry both faces.
    expect(cubeSignalOf('Bonecrusher Giant // Stomp')).toEqual({ cubePop: 9.5, cubeElo: 1600 });
  });

  it('degrades to "no signal" when the snapshot is unreachable', async () => {
    stubFetch(async () => ({ ok: false, status: 503 }));
    await expect(loadCubeSignal()).resolves.toBeUndefined();
    expect(hasCubeSignal()).toBe(false);
    expect(cubeSignalOf('Lightning Bolt')).toEqual({});
  });

  it('retries a failed load on the next call rather than caching the failure', async () => {
    let calls = 0;
    stubFetch(async () => {
      calls++;
      return calls === 1 ? { ok: false, status: 500 } : { ok: true, json: async () => snapshot };
    });
    await loadCubeSignal();
    expect(hasCubeSignal()).toBe(false);
    await loadCubeSignal();
    expect(hasCubeSignal()).toBe(true);
  });
});
