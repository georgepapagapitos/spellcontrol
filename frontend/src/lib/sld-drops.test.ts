import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseCollectorNumber, dropsForNumber, parseSldDrops } from './sld-drops';

const VALID = {
  generatedAt: '2026-07-16T00:00:00.000Z',
  drops: [
    { name: 'OMG KITTIES', releasedAt: '2019-12-02', numbers: ['92', '93'] },
    { name: 'Allied Talismans', releasedAt: '2023-05-01', numbers: ['708'] },
    { name: 'Enemy Talismans', releasedAt: '2023-05-01', numbers: ['708'] },
  ],
};

describe('baseCollectorNumber', () => {
  it('strips trailing variant suffixes only', () => {
    expect(baseCollectorNumber('1627★')).toBe('1627');
    expect(baseCollectorNumber('119a')).toBe('119');
    expect(baseCollectorNumber('92')).toBe('92');
  });
});

describe('parseSldDrops', () => {
  it('indexes every number, tolerating numeric entries', () => {
    const index = parseSldDrops({
      drops: [{ name: 'X', releasedAt: '2020-01-01', numbers: [92, '93'] }],
    })!;
    expect(index.byNumber.get('92')![0].name).toBe('X');
    expect(index.byNumber.get('93')![0].name).toBe('X');
  });

  it('defaults a missing releasedAt to empty string', () => {
    const index = parseSldDrops({ drops: [{ name: 'X', numbers: ['1'] }] })!;
    expect(index.drops[0].releasedAt).toBe('');
  });

  it('rejects malformed payloads', () => {
    expect(parseSldDrops(null)).toBeNull();
    expect(parseSldDrops({})).toBeNull();
    expect(parseSldDrops({ drops: [{ name: 42, numbers: [] }] })).toBeNull();
    expect(parseSldDrops({ drops: [{ name: 'X' }] })).toBeNull();
  });
});

describe('dropsForNumber', () => {
  const index = parseSldDrops(VALID)!;

  it('returns every drop a number was sold in', () => {
    expect(dropsForNumber(index, '708').map((d) => d.name)).toEqual([
      'Allied Talismans',
      'Enemy Talismans',
    ]);
  });

  it('falls back to the base number for suffixed variants', () => {
    expect(dropsForNumber(index, '92★').map((d) => d.name)).toEqual(['OMG KITTIES']);
  });

  it('returns [] for unmapped numbers', () => {
    expect(dropsForNumber(index, '9999')).toEqual([]);
  });
});

describe('getSldDrops', () => {
  // Fresh module per test — the loader caches its promise at module scope.
  async function freshLoader() {
    vi.resetModules();
    return (await import('./sld-drops')).getSldDrops;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads and parses the snapshot once per page-load', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(VALID) });
    vi.stubGlobal('fetch', fetchMock);
    const load = await freshLoader();
    const first = await load();
    expect(first?.drops).toHaveLength(3);
    await load();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolves null on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const load = await freshLoader();
    await expect(load()).resolves.toBeNull();
  });

  it('resolves null on a network failure and allows a retry', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(VALID) });
    vi.stubGlobal('fetch', fetchMock);
    const load = await freshLoader();
    await expect(load()).resolves.toBeNull();
    const retried = await load();
    expect(retried?.drops).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
