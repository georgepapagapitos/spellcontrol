import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureCombosCached, resetCombosCacheForTesting } from './ensure-combos';
import {
  getOfflineDataStats,
  readManifest,
  readStandaloneCombosVersion,
  writeStandaloneCombosVersion,
} from './db';
import { importCombos } from './combos-import';

vi.mock('./db', () => ({
  getOfflineDataStats: vi.fn(),
  readManifest: vi.fn(),
  readStandaloneCombosVersion: vi.fn(),
  writeStandaloneCombosVersion: vi.fn(),
}));
// The streaming importer owns the /api/offline/combos fetch + IDB writes; here
// we only care that ensure-combos calls it at the right moments.
vi.mock('./combos-import', () => ({ importCombos: vi.fn() }));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const manifest = (combosVersion: string) => ({ combosVersion });

/** fetch stub routing combos-version/combos URLs to canned responses. */
function routeFetch(routes: { manifest?: Response | Error; combos?: Response | Error }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const u = String(url);
    const pick = u.includes('/api/offline/combos-version') ? routes.manifest : routes.combos;
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
    const fetchSpy = routeFetch({ manifest: jsonResponse(manifest('v1')) });

    expect(await ensureCombosCached()).toBe(true);
    expect(importCombos).toHaveBeenCalledTimes(1);
    // The version stamp is what makes the rows "cached" — written only after
    // the importer resolved, never before.
    expect(writeStandaloneCombosVersion).toHaveBeenCalledWith('v1');
    expect(fetchSpy).toHaveBeenCalledTimes(1); // the manifest; the importer owns the bulk fetch
  });

  it('finishes an interrupted first download instead of serving unstamped rows', async () => {
    // Rows present but no version stamp = a stream that died mid-way. The
    // importer upserts by id, so re-running it completes the dataset.
    vi.mocked(getOfflineDataStats).mockResolvedValue({ cardCount: 0, comboCount: 3 });
    routeFetch({ manifest: jsonResponse(manifest('v1')) });

    expect(await ensureCombosCached()).toBe(true);
    expect(importCombos).toHaveBeenCalledTimes(1);
    expect(writeStandaloneCombosVersion).toHaveBeenCalledWith('v1');
  });

  it('refuses unstamped rows when the server is unreachable', async () => {
    vi.mocked(getOfflineDataStats).mockResolvedValue({ cardCount: 0, comboCount: 3 });
    routeFetch({ manifest: new TypeError('offline') });

    expect(await ensureCombosCached()).toBe(false); // partial dataset is not an answer
    expect(importCombos).not.toHaveBeenCalled();
  });

  it('serves the cache without re-downloading when the version is unchanged', async () => {
    vi.mocked(getOfflineDataStats).mockResolvedValue({ cardCount: 0, comboCount: 3 });
    vi.mocked(readStandaloneCombosVersion).mockResolvedValue('v1');
    const fetchSpy = routeFetch({ manifest: jsonResponse(manifest('v1')) });

    expect(await ensureCombosCached()).toBe(true);
    expect(importCombos).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // only the manifest
  });

  it('refreshes a moved dataset in the background, answering from the cache meanwhile', async () => {
    vi.mocked(getOfflineDataStats).mockResolvedValue({ cardCount: 0, comboCount: 3 });
    vi.mocked(readStandaloneCombosVersion).mockResolvedValue('v1');
    routeFetch({ manifest: jsonResponse(manifest('v2')) });
    let finishImport!: () => void;
    vi.mocked(importCombos).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishImport = resolve;
      }) as never
    );

    // Resolves while the download is still running: a combo check never waits
    // on the nightly refresh when a usable dataset is already on the device.
    expect(await ensureCombosCached()).toBe(true);
    await vi.waitFor(() => expect(importCombos).toHaveBeenCalledTimes(1));
    expect(writeStandaloneCombosVersion).not.toHaveBeenCalled();

    finishImport();
    await vi.waitFor(() => expect(writeStandaloneCombosVersion).toHaveBeenCalledWith('v2'));
  });

  it('falls back to the full manifest version when no standalone version is stored', async () => {
    vi.mocked(getOfflineDataStats).mockResolvedValue({ cardCount: 0, comboCount: 3 });
    vi.mocked(readStandaloneCombosVersion).mockResolvedValue(null);
    vi.mocked(readManifest).mockResolvedValue({
      oracleVersion: 'o1',
      oracleCardCount: 0,
      oracleByteSize: 0,
      oracleUpdatedAt: 0,
      combosVersion: 'v9',
      combosCount: 3,
      combosByteSize: 100,
      combosUpdatedAt: 0,
    });
    routeFetch({ manifest: jsonResponse(manifest('v9')) });

    expect(await ensureCombosCached()).toBe(true);
    expect(importCombos).not.toHaveBeenCalled(); // versions agree → no download
  });

  it('returns false when nothing is cached and the manifest is unreachable', async () => {
    routeFetch({ manifest: new TypeError('offline') });
    expect(await ensureCombosCached()).toBe(false);
    expect(importCombos).not.toHaveBeenCalled();
  });

  it('serves the stale cache when offline but combos are present', async () => {
    vi.mocked(getOfflineDataStats).mockResolvedValue({ cardCount: 0, comboCount: 3 });
    vi.mocked(readStandaloneCombosVersion).mockResolvedValue('v1');
    routeFetch({ manifest: new TypeError('offline') });
    expect(await ensureCombosCached()).toBe(true);
    expect(importCombos).not.toHaveBeenCalled();
  });

  it('keeps the stale cache when a refresh download fails', async () => {
    vi.mocked(getOfflineDataStats).mockResolvedValue({ cardCount: 0, comboCount: 3 });
    vi.mocked(readStandaloneCombosVersion).mockResolvedValue('v1');
    routeFetch({ manifest: jsonResponse(manifest('v2')) });
    vi.mocked(importCombos).mockRejectedValueOnce(
      new Error("Couldn't download the combo data. Try again in a moment.")
    );

    expect(await ensureCombosCached()).toBe(true); // stale served, not a hard failure
    await vi.waitFor(() => expect(importCombos).toHaveBeenCalledTimes(1));
    expect(writeStandaloneCombosVersion).not.toHaveBeenCalled(); // v1 stamp stays
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

    routeFetch({ manifest: jsonResponse(manifest('v1')) });
    expect(await ensureCombosCached()).toBe(true);
    expect(importCombos).toHaveBeenCalledTimes(1);
  });
});
