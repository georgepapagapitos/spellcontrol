import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  __getRefreshTimerForTesting,
  __resetOracleBulkForTesting,
  __runDailyRefreshTickForTesting,
  getOracleBulk,
} from './bulk-cache';

const DEFAULT_BULK_CARD = {
  id: 's-1',
  oracle_id: 'o-1',
  name: 'Test Card',
  cmc: 1,
  type_line: 'Creature',
  colors: ['G'],
  color_identity: ['G'],
  keywords: [],
  legalities: { commander: 'legal' },
  rarity: 'rare',
  set: 'tst',
  set_name: 'Test Set',
  collector_number: '1',
  games: ['paper'],
};

function mockScryfallFetch(cards: Record<string, unknown>[] = [DEFAULT_BULK_CARD]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const u = typeof input === 'string' ? input : input.toString();
    if (u.includes('/bulk-data')) {
      return new Response(
        JSON.stringify({
          data: [
            {
              type: 'oracle_cards',
              download_uri: 'https://example/bulk-oracle.json',
              updated_at: '2026-05-19T00:00:00Z',
            },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (u.includes('bulk-oracle.json')) {
      return new Response(JSON.stringify(cards), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`Unexpected fetch in test: ${u}`);
  });
}

describe('bulk-cache scheduling', () => {
  const originalDisabled = process.env.OFFLINE_BULK_DISABLED;

  beforeEach(async () => {
    await __resetOracleBulkForTesting();
    delete process.env.OFFLINE_BULK_DISABLED;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await __resetOracleBulkForTesting();
    if (originalDisabled === undefined) {
      delete process.env.OFFLINE_BULK_DISABLED;
    } else {
      process.env.OFFLINE_BULK_DISABLED = originalDisabled;
    }
  });

  it('does not arm the daily refresh timer until the bulk is built', () => {
    // No build has happened yet — the timer must not be armed at module load.
    expect(__getRefreshTimerForTesting()).toBeNull();
  });

  it('arms the daily refresh timer after the first successful build', async () => {
    mockScryfallFetch();
    await getOracleBulk();
    expect(__getRefreshTimerForTesting()).not.toBeNull();
  });

  it('honors OFFLINE_BULK_DISABLED — no timer even after a successful build', async () => {
    process.env.OFFLINE_BULK_DISABLED = '1';
    mockScryfallFetch();
    await getOracleBulk();
    expect(__getRefreshTimerForTesting()).toBeNull();
  });

  it('periodic tick is a no-op when current is null', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    // current is null after the beforeEach reset.
    __runDailyRefreshTickForTesting();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('periodic tick triggers a refresh when current is populated', async () => {
    mockScryfallFetch();
    await getOracleBulk();
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.spyOn>;
    fetchSpy.mockClear();
    __runDailyRefreshTickForTesting();
    // Give the in-flight refresh a microtask to start.
    await Promise.resolve();
    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe('bulk-cache disk persistence', () => {
  const originalOfflineDir = process.env.OFFLINE_DATA_DIR;
  const originalDbPath = process.env.DB_PATH;
  let tmpDir: string;

  beforeEach(async () => {
    await __resetOracleBulkForTesting();
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bulk-cache-test-'));
    process.env.OFFLINE_DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await __resetOracleBulkForTesting();
    if (originalOfflineDir === undefined) {
      delete process.env.OFFLINE_DATA_DIR;
    } else {
      process.env.OFFLINE_DATA_DIR = originalOfflineDir;
    }
    if (originalDbPath === undefined) {
      delete process.env.DB_PATH;
    } else {
      process.env.DB_PATH = originalDbPath;
    }
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('persists bulk + meta to OFFLINE_DATA_DIR after a fresh build', async () => {
    mockScryfallFetch();
    await getOracleBulk();
    // persistToDisk is fire-and-forget — let the microtask queue drain.
    await new Promise((r) => setTimeout(r, 50));
    const blob = await fs.promises.stat(path.join(tmpDir, 'offline-oracle.json.gz'));
    const meta = await fs.promises.stat(path.join(tmpDir, 'offline-oracle.meta.json'));
    expect(blob.size).toBeGreaterThan(0);
    expect(meta.size).toBeGreaterThan(0);
  });

  it('loads from disk on the next getOracleBulk without re-fetching Scryfall', async () => {
    mockScryfallFetch();
    await getOracleBulk();
    await new Promise((r) => setTimeout(r, 50));

    // Drop in-memory state but keep disk cache. Next getOracleBulk should
    // hit loadFromDisk and skip the network entirely.
    await __resetOracleBulkForTesting();
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.spyOn>;
    fetchSpy.mockClear();

    const fromDisk = await getOracleBulk();
    expect(fromDisk.cardCount).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to dirname(DB_PATH) when OFFLINE_DATA_DIR is unset', async () => {
    delete process.env.OFFLINE_DATA_DIR;
    process.env.DB_PATH = path.join(tmpDir, 'scryfall-cache.db');
    mockScryfallFetch();
    await getOracleBulk();
    await new Promise((r) => setTimeout(r, 50));
    const blob = await fs.promises.stat(path.join(tmpDir, 'offline-oracle.json.gz'));
    expect(blob.size).toBeGreaterThan(0);
  });

  it('rebuilds (ignores disk) when the persisted meta has a stale builderVersion', async () => {
    mockScryfallFetch();
    await getOracleBulk();
    await new Promise((r) => setTimeout(r, 50));

    // Simulate a payload persisted by an older builder.
    const metaPath = path.join(tmpDir, 'offline-oracle.meta.json');
    const meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8'));
    await fs.promises.writeFile(metaPath, JSON.stringify({ ...meta, builderVersion: 1 }));

    await __resetOracleBulkForTesting();
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.spyOn>;
    fetchSpy.mockClear();

    // Stale builder → loadFromDisk returns null → fresh build hits the network.
    await getOracleBulk();
    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe('bulk-cache slimCard filtering', () => {
  const originalOfflineDir = process.env.OFFLINE_DATA_DIR;
  let tmpDir: string;

  beforeEach(async () => {
    await __resetOracleBulkForTesting();
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bulk-cache-slim-'));
    process.env.OFFLINE_DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await __resetOracleBulkForTesting();
    if (originalOfflineDir === undefined) delete process.env.OFFLINE_DATA_DIR;
    else process.env.OFFLINE_DATA_DIR = originalOfflineDir;
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('excludes art-series and other non-playable layouts from the bulk', async () => {
    mockScryfallFetch([
      { ...DEFAULT_BULK_CARD, id: 's-real', oracle_id: 'o-real', name: 'Arcane Signet' },
      {
        ...DEFAULT_BULK_CARD,
        id: 's-art',
        oracle_id: 'o-art',
        name: 'Arcane Signet',
        layout: 'art_series',
        set: 'acmm',
        legalities: { commander: 'not_legal' },
      },
      { ...DEFAULT_BULK_CARD, id: 's-tok', oracle_id: 'o-tok', name: 'Soldier', layout: 'token' },
      {
        ...DEFAULT_BULK_CARD,
        id: 's-emb',
        oracle_id: 'o-emb',
        name: 'Emblem',
        layout: 'emblem',
      },
    ]);
    const bulk = await getOracleBulk();
    // Only the real Arcane Signet survives — art card / token / emblem dropped.
    expect(bulk.cardCount).toBe(1);
  });

  it('carries rarity through to the slim payload', async () => {
    mockScryfallFetch([
      { ...DEFAULT_BULK_CARD, id: 's-real', oracle_id: 'o-real', name: 'Beast Whisperer' },
    ]);
    const bulk = await getOracleBulk();
    const slims = JSON.parse(gunzipSync(bulk.gzipped).toString('utf8')) as Array<{
      name: string;
      rarity?: string;
    }>;
    expect(slims).toHaveLength(1);
    expect(slims[0].rarity).toBe('rare');
  });

  it('excludes memorabilia set_type (oversized / championship printings)', async () => {
    mockScryfallFetch([
      { ...DEFAULT_BULK_CARD, id: 's-real', oracle_id: 'o-real', name: 'Real Card' },
      {
        ...DEFAULT_BULK_CARD,
        id: 's-mem',
        oracle_id: 'o-mem',
        name: 'Oversized Thing',
        set_type: 'memorabilia',
      },
    ]);
    const bulk = await getOracleBulk();
    expect(bulk.cardCount).toBe(1);
  });
});
