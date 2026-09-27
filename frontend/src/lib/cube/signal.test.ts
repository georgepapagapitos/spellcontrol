import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cubeSignalOf,
  hasCubeSignal,
  loadCubeSignal,
  rankedCubeSignalNames,
  rankedScopedSignalNames,
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

const pauperSnapshot = {
  generatedAt: '2026-09-27T00:00:00.000Z',
  cards: { Mulldrifter: 90, 'Bonecrusher Giant': 12.5 },
};
const peasantSnapshot = {
  generatedAt: '2026-09-27T00:00:00.000Z',
  // Mulldrifter deliberately carries a DIFFERENT number than the pauper
  // fixture above — the cross-talk test below proves reading one scope never
  // leaks the other's value for the same card.
  cards: { Mulldrifter: 40, 'Ninja of the Deep Hours': 55 },
};

function stubScopedFetch() {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : String(input);
    if (url.endsWith('/cube-signal.json')) return { ok: true, json: async () => snapshot };
    if (url.endsWith('/cube-signal-pauper.json'))
      return { ok: true, json: async () => pauperSnapshot };
    if (url.endsWith('/cube-signal-peasant.json'))
      return { ok: true, json: async () => peasantSnapshot };
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('cubeSignalOf with an explicit scope', () => {
  it('substitutes the corpus play-share for cubePop on a card the corpus has seen', async () => {
    const fetchMock = stubScopedFetch();
    await loadCubeSignal('pauper');
    expect(fetchMock).toHaveBeenCalledWith('/cube-signal-pauper.json', expect.anything());
    // Corpus-seen card: cubePop replaced, cubeElo (all-cube) untouched.
    expect(cubeSignalOf('Mulldrifter', 'pauper')).toEqual({ cubePop: 90 });
    // DFC front-face lookup still works under a scope.
    expect(cubeSignalOf('Bonecrusher Giant // Stomp', 'pauper')).toEqual({
      cubePop: 12.5,
      cubeElo: 1600,
    });
  });

  it('falls back to the all-cube number for a card the corpus never saw', async () => {
    stubScopedFetch();
    await loadCubeSignal('pauper');
    // Lightning Bolt is in the all-cube snapshot but not the pauper corpus fixture.
    expect(cubeSignalOf('Lightning Bolt', 'pauper')).toEqual({ cubePop: 26.41, cubeElo: 1658 });
    expect(cubeSignalOf('Never Cubed', 'pauper')).toEqual({});
  });

  it('a call with no scope argument reads the plain all-cube signal, even once a scope has loaded', async () => {
    stubScopedFetch();
    await loadCubeSignal('pauper');
    // Mulldrifter has no all-cube entry — the default scope ('any') must not
    // pick up the pauper corpus value just because it happens to be loaded.
    expect(cubeSignalOf('Mulldrifter')).toEqual({});
    expect(cubeSignalOf('Lightning Bolt')).toEqual({ cubePop: 26.41, cubeElo: 1658 });
  });

  it('degrades to the all-cube signal when the scoped snapshot fails to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : String(input);
        if (url.endsWith('/cube-signal.json')) return { ok: true, json: async () => snapshot };
        if (url.endsWith('/cube-signal-peasant.json')) return { ok: false, status: 404 };
        throw new Error(`unexpected fetch ${url}`);
      })
    );
    await loadCubeSignal('peasant');
    expect(hasCubeSignal('peasant')).toBe(false);
    expect(cubeSignalOf('Mulldrifter', 'peasant')).toEqual({});
    expect(cubeSignalOf('Lightning Bolt', 'peasant')).toEqual({ cubePop: 26.41, cubeElo: 1658 });
  });

  it('loads a scope only once', async () => {
    const fetchMock = stubScopedFetch();
    await loadCubeSignal('pauper');
    await loadCubeSignal('pauper');
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/cube-signal-pauper.json')).toHaveLength(1);
  });

  // The bug this guards: signal.ts used to keep a module-level "active scope"
  // set by the last loadCubeSignal(scope) call, so two consumers on one page
  // wanting different scopes (a Cards-tab pool load and a Shopping-tab
  // candidate walk) would race — whichever load ran last silently decided how
  // BOTH read. Scope is now an explicit argument everywhere, so there is
  // nothing left to race: reading one scope can never see another's value,
  // however their loads interleave.
  it('reads two scopes without cross-talk, however their loads interleave', async () => {
    stubScopedFetch();
    await Promise.all([loadCubeSignal('peasant'), loadCubeSignal('pauper')]);
    // Same card name, a different reading per the CALLER's own scope argument.
    expect(cubeSignalOf('Mulldrifter', 'pauper')).toEqual({ cubePop: 90 });
    expect(cubeSignalOf('Mulldrifter', 'peasant')).toEqual({ cubePop: 40 });
    expect(cubeSignalOf('Mulldrifter', 'any')).toEqual({});
    // A peasant-only card reads correctly under peasant and falls back to the
    // all-cube number (absent, here) under pauper or 'any'.
    expect(cubeSignalOf('Ninja of the Deep Hours', 'peasant')).toEqual({ cubePop: 55 });
    expect(cubeSignalOf('Ninja of the Deep Hours', 'pauper')).toEqual({});
  });
});

describe('hasCubeSignal', () => {
  it('checks the requested scope independently of the all-cube signal and of other scopes', async () => {
    stubScopedFetch();
    await loadCubeSignal('pauper');
    expect(hasCubeSignal()).toBe(true); // all-cube loads as a side effect of any loadCubeSignal call
    expect(hasCubeSignal('pauper')).toBe(true);
    expect(hasCubeSignal('peasant')).toBe(false); // never requested
  });
});

describe('rankedScopedSignalNames', () => {
  it('is empty until that scope has loaded', () => {
    expect(rankedScopedSignalNames('pauper')).toEqual([]);
  });

  it("ranks a scope's corpus by play-share, independent of the other scope", async () => {
    stubScopedFetch();
    await Promise.all([loadCubeSignal('pauper'), loadCubeSignal('peasant')]);
    expect(rankedScopedSignalNames('pauper')).toEqual(['Mulldrifter', 'Bonecrusher Giant']);
    expect(rankedScopedSignalNames('peasant')).toEqual(['Ninja of the Deep Hours', 'Mulldrifter']);
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
