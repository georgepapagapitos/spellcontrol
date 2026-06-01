import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureCombosCached, resetCombosCacheForTesting } from './ensure-combos';
import {
  getOfflineDataStats,
  readManifest,
  readStandaloneCombosVersion,
  replaceCombos,
  writeStandaloneCombosVersion,
} from './db';

vi.mock('./db', () => ({
  getOfflineDataStats: vi.fn(),
  readManifest: vi.fn(),
  readStandaloneCombosVersion: vi.fn(),
  replaceCombos: vi.fn(),
  writeStandaloneCombosVersion: vi.fn(),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const manifest = (combosVersion: string) => ({
  oracleVersion: 'o1',
  oracleCardCount: 0,
  oracleByteSize: 0,
  oracleUpdatedAt: 0,
  combosVersion,
  combosCount: 3,
  combosByteSize: 100,
  combosUpdatedAt: 0,
});

/** fetch stub routing manifest/combos URLs to canned responses. */
function routeFetch(routes: { manifest?: Response | Error; combos?: Response | Error }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const u = String(url);
    const pick = u.includes('/api/offline/manifest') ? routes.manifest : routes.combos;
    if (pick instanceof Error) return Promise.reject(pick);
    if (pick) return Promise.resolve(pick);
    throw new Error(`unexpected fetch ${u}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCombosCacheForTesting();
  vi.mocked(getOfflineDataStats).mockResolvedValue({ cardCount: 0, comboCount: 0 });
  vi.mocked(readManifest).mockResolvedValue(null);
  vi.mocked(readStandaloneCombosVersion).mockResolvedValue(null);
});

describe('ensureCombosCached', () => {
  it('downloads + stores the dataset when nothing is cached', async () => {
    const combos = [{ id: 'c1' }];
    const fetchSpy = routeFetch({
      manifest: jsonResponse(manifest('v1')),
      combos: jsonResponse(combos),
    });

    expect(await ensureCombosCached()).toBe(true);
    expect(replaceCombos).toHaveBeenCalledWith(combos);
    expect(writeStandaloneCombosVersion).toHaveBeenCalledWith('v1');
    expect(fetchSpy).toHaveBeenCalledTimes(2); // manifest + combos
  });

  it('serves the cache without re-downloading when the version is unchanged', async () => {
    vi.mocked(getOfflineDataStats).mockResolvedValue({ cardCount: 0, comboCount: 3 });
    vi.mocked(readStandaloneCombosVersion).mockResolvedValue('v1');
    const fetchSpy = routeFetch({ manifest: jsonResponse(manifest('v1')) });

    expect(await ensureCombosCached()).toBe(true);
    expect(replaceCombos).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // only the manifest
  });

  it('re-downloads when the dataset version moved', async () => {
    vi.mocked(getOfflineDataStats).mockResolvedValue({ cardCount: 0, comboCount: 3 });
    vi.mocked(readStandaloneCombosVersion).mockResolvedValue('v1');
    routeFetch({ manifest: jsonResponse(manifest('v2')), combos: jsonResponse([{ id: 'c2' }]) });

    expect(await ensureCombosCached()).toBe(true);
    expect(replaceCombos).toHaveBeenCalledWith([{ id: 'c2' }]);
    expect(writeStandaloneCombosVersion).toHaveBeenCalledWith('v2');
  });

  it('falls back to the full manifest version when no standalone version is stored', async () => {
    vi.mocked(getOfflineDataStats).mockResolvedValue({ cardCount: 0, comboCount: 3 });
    vi.mocked(readStandaloneCombosVersion).mockResolvedValue(null);
    vi.mocked(readManifest).mockResolvedValue(manifest('v9'));
    routeFetch({ manifest: jsonResponse(manifest('v9')) });

    expect(await ensureCombosCached()).toBe(true);
    expect(replaceCombos).not.toHaveBeenCalled(); // versions agree → no download
  });

  it('returns false when nothing is cached and the manifest is unreachable', async () => {
    routeFetch({ manifest: new TypeError('offline') });
    expect(await ensureCombosCached()).toBe(false);
    expect(replaceCombos).not.toHaveBeenCalled();
  });

  it('serves the stale cache when offline but combos are present', async () => {
    vi.mocked(getOfflineDataStats).mockResolvedValue({ cardCount: 0, comboCount: 3 });
    routeFetch({ manifest: new TypeError('offline') });
    expect(await ensureCombosCached()).toBe(true);
    expect(replaceCombos).not.toHaveBeenCalled();
  });

  it('keeps the stale cache when a refresh download fails', async () => {
    vi.mocked(getOfflineDataStats).mockResolvedValue({ cardCount: 0, comboCount: 3 });
    vi.mocked(readStandaloneCombosVersion).mockResolvedValue('v1');
    routeFetch({
      manifest: jsonResponse(manifest('v2')),
      combos: jsonResponse({ error: 'x' }, 503),
    });

    expect(await ensureCombosCached()).toBe(true); // stale served, not a hard failure
    expect(replaceCombos).not.toHaveBeenCalled();
  });

  it('dedupes concurrent calls into a single run', async () => {
    vi.mocked(getOfflineDataStats).mockResolvedValue({ cardCount: 0, comboCount: 3 });
    vi.mocked(readStandaloneCombosVersion).mockResolvedValue('v1');
    const fetchSpy = routeFetch({ manifest: jsonResponse(manifest('v1')) });

    const [a, b] = await Promise.all([ensureCombosCached(), ensureCombosCached()]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // shared inflight run
  });

  it('retries after a negative result (inflight is cleared)', async () => {
    routeFetch({ manifest: new TypeError('offline') });
    expect(await ensureCombosCached()).toBe(false);

    routeFetch({ manifest: jsonResponse(manifest('v1')), combos: jsonResponse([{ id: 'c1' }]) });
    expect(await ensureCombosCached()).toBe(true);
    expect(replaceCombos).toHaveBeenCalledWith([{ id: 'c1' }]);
  });
});
