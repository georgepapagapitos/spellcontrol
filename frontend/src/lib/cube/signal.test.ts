import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cubeSignalOf,
  hasCubeSignal,
  loadCubeSignal,
  rankedCubeSignalNames,
  resetCubeSignalForTests,
} from './signal';

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

const scopedSnapshot = {
  generatedAt: '2026-09-27T00:00:00.000Z',
  cards: { Mulldrifter: 90, 'Bonecrusher Giant': 12.5 },
};

function stubScopedFetch() {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : String(input);
    if (url.endsWith('/cube-signal.json')) return { ok: true, json: async () => snapshot };
    if (url.endsWith('/cube-signal-pauper.json'))
      return { ok: true, json: async () => scopedSnapshot };
    if (url.endsWith('/cube-signal-peasant.json')) return { ok: false, status: 404 };
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('loadCubeSignal with a scope', () => {
  it('substitutes the corpus play-share for cubePop on a card the corpus has seen', async () => {
    const fetchMock = stubScopedFetch();
    await loadCubeSignal('pauper');
    expect(fetchMock).toHaveBeenCalledWith('/cube-signal-pauper.json', expect.anything());
    // Corpus-seen card: cubePop replaced, cubeElo (all-cube) untouched.
    expect(cubeSignalOf('Mulldrifter')).toEqual({ cubePop: 90 });
    // DFC front-face lookup still works under a scope.
    expect(cubeSignalOf('Bonecrusher Giant // Stomp')).toEqual({ cubePop: 12.5, cubeElo: 1600 });
  });

  it('falls back to the all-cube number for a card the corpus never saw', async () => {
    stubScopedFetch();
    await loadCubeSignal('pauper');
    // Lightning Bolt is in the all-cube snapshot but not the pauper corpus fixture.
    expect(cubeSignalOf('Lightning Bolt')).toEqual({ cubePop: 26.41, cubeElo: 1658 });
    expect(cubeSignalOf('Never Cubed')).toEqual({});
  });

  it('degrades to the all-cube signal when the scoped snapshot fails to load', async () => {
    stubScopedFetch();
    await loadCubeSignal('peasant'); // stubbed 404 above
    expect(cubeSignalOf('Mulldrifter')).toEqual({});
    expect(cubeSignalOf('Lightning Bolt')).toEqual({ cubePop: 26.41, cubeElo: 1658 });
  });

  it('loads a scope only once, and switching scope changes what cubeSignalOf reads', async () => {
    const fetchMock = stubScopedFetch();
    await loadCubeSignal('pauper');
    await loadCubeSignal('pauper');
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/cube-signal-pauper.json')).toHaveLength(1);
    expect(cubeSignalOf('Mulldrifter')).toEqual({ cubePop: 90 });
    await loadCubeSignal('any');
    expect(cubeSignalOf('Mulldrifter')).toEqual({});
  });
});

describe('rankedCubeSignalNames', () => {
  it('is empty until the snapshot loads', () => {
    expect(rankedCubeSignalNames()).toEqual([]);
  });

  it('sorts by popularity, then Elo, once loaded', async () => {
    stubFetch(async () => ({ ok: true, json: async () => snapshot }));
    await loadCubeSignal();
    expect(rankedCubeSignalNames()).toEqual([
      'Lightning Bolt',
      'Bonecrusher Giant',
      'Arcane Signet',
    ]);
  });
});
