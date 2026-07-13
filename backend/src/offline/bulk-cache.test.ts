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

/**
 * `gameChangerNames` seeds the mocked `is:gamechanger` search response (one
 * page, `has_more: false`). Pass `null` to simulate a live-search failure so
 * tests can assert the hardcoded-list fallback kicks in.
 */
function mockScryfallFetch(
  cards: Record<string, unknown>[] = [DEFAULT_BULK_CARD],
  gameChangerNames: string[] | null = []
) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const u = typeof input === 'string' ? input : input.toString();
    if (u.includes('/cards/search')) {
      if (gameChangerNames === null) throw new Error('simulated Scryfall outage');
      return new Response(
        JSON.stringify({ data: gameChangerNames.map((name) => ({ name })), has_more: false }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }
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
  const originalOfflineDir = process.env.OFFLINE_DATA_DIR;
  let tmpDir: string;

  beforeEach(async () => {
    await __resetOracleBulkForTesting();
    delete process.env.OFFLINE_BULK_DISABLED;
    // Sandbox the persist target — these tests build with a MOCKED 1-card fetch,
    // and without this they'd write that mock over the real dev/prod offline
    // bundle (default dir is dirname(DB_PATH) = backend/data/). That clobbered a
    // real bundle once.
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bulk-cache-sched-'));
    process.env.OFFLINE_DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await __resetOracleBulkForTesting();
    if (originalDisabled === undefined) {
      delete process.env.OFFLINE_BULK_DISABLED;
    } else {
      process.env.OFFLINE_BULK_DISABLED = originalDisabled;
    }
    if (originalOfflineDir === undefined) delete process.env.OFFLINE_DATA_DIR;
    else process.env.OFFLINE_DATA_DIR = originalOfflineDir;
    // Let any fire-and-forget persistToDisk drain before removing the dir, so a
    // late write can't recreate it.
    await new Promise((r) => setTimeout(r, 60));
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
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
    // Drain any fire-and-forget persistToDisk before removing the dir.
    await new Promise((r) => setTimeout(r, 60));
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
    // Drain any fire-and-forget persistToDisk before removing the dir.
    await new Promise((r) => setTimeout(r, 60));
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

  it('streams a multi-card bulk into valid JSON with correct separators and byte accounting', async () => {
    // Pins the streamed stringify+gzip tail (the OOM fix): the 1-card cases
    // never emit a comma, so a separator bug would ship malformed JSON.
    mockScryfallFetch([
      { ...DEFAULT_BULK_CARD, id: 's-1', oracle_id: 'o-1', name: 'Sol Ring' },
      { ...DEFAULT_BULK_CARD, id: 's-2', oracle_id: 'o-2', name: 'Arcane Signet' },
      { ...DEFAULT_BULK_CARD, id: 's-3', oracle_id: 'o-3', name: 'Cultivate' },
    ]);
    const bulk = await getOracleBulk();
    const raw = gunzipSync(bulk.gzipped);
    const slims = JSON.parse(raw.toString('utf8')) as Array<{ name: string }>;
    expect(slims.map((s) => s.name)).toEqual(['Sol Ring', 'Arcane Signet', 'Cultivate']);
    expect(bulk.cardCount).toBe(3);
    expect(bulk.rawBytes).toBe(raw.byteLength);
    expect(bulk.gzippedBytes).toBe(bulk.gzipped.byteLength);
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

  it('distills token producers from all_parts, dropping non-token relations', async () => {
    mockScryfallFetch([
      {
        ...DEFAULT_BULK_CARD,
        id: 's-krenko',
        oracle_id: 'o-krenko',
        name: 'Krenko, Mob Boss',
        all_parts: [
          // The card itself — a combo_piece, must be dropped.
          { component: 'combo_piece', name: 'Krenko, Mob Boss', type_line: 'Legendary Creature' },
          { component: 'token', name: 'Goblin', type_line: 'Token Creature — Goblin' },
          // Duplicate token entry — must be deduped.
          { component: 'token', name: 'Goblin', type_line: 'Token Creature — Goblin' },
        ],
      },
      // A card with no all_parts at all — tokens must stay absent.
      { ...DEFAULT_BULK_CARD, id: 's-plain', oracle_id: 'o-plain', name: 'Plain Card' },
    ]);
    const bulk = await getOracleBulk();
    const slims = JSON.parse(gunzipSync(bulk.gzipped).toString('utf8')) as Array<{
      name: string;
      tokens?: Array<{ name: string; typeLine?: string }>;
    }>;
    const krenko = slims.find((c) => c.name === 'Krenko, Mob Boss');
    const plain = slims.find((c) => c.name === 'Plain Card');
    expect(krenko?.tokens).toEqual([{ name: 'Goblin', typeLine: 'Token Creature — Goblin' }]);
    expect(plain?.tokens).toBeUndefined();
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

describe('bulk-cache isGameChanger flag (E108)', () => {
  const originalOfflineDir = process.env.OFFLINE_DATA_DIR;
  let tmpDir: string;

  beforeEach(async () => {
    await __resetOracleBulkForTesting();
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bulk-cache-gc-'));
    process.env.OFFLINE_DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await __resetOracleBulkForTesting();
    if (originalOfflineDir === undefined) delete process.env.OFFLINE_DATA_DIR;
    else process.env.OFFLINE_DATA_DIR = originalOfflineDir;
    await new Promise((r) => setTimeout(r, 60));
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('sets isGameChanger:true for a card the live is:gamechanger search returns', async () => {
    mockScryfallFetch(
      [
        { ...DEFAULT_BULK_CARD, id: 's-rs', oracle_id: 'o-rs', name: 'Rhystic Study' },
        { ...DEFAULT_BULK_CARD, id: 's-plain', oracle_id: 'o-plain', name: 'Plain Card' },
      ],
      ['Rhystic Study']
    );
    const bulk = await getOracleBulk();
    const slims = JSON.parse(gunzipSync(bulk.gzipped).toString('utf8')) as Array<{
      name: string;
      isGameChanger?: boolean;
    }>;
    expect(slims.find((c) => c.name === 'Rhystic Study')?.isGameChanger).toBe(true);
    expect(slims.find((c) => c.name === 'Plain Card')?.isGameChanger).toBeUndefined();
  });

  it('falls back to the hardcoded RC list when the live search fails', async () => {
    // gameChangerNames: null → mockScryfallFetch throws on /cards/search,
    // simulating a Scryfall outage during the bulk build.
    mockScryfallFetch(
      [{ ...DEFAULT_BULK_CARD, id: 's-cyc', oracle_id: 'o-cyc', name: 'Cyclonic Rift' }],
      null
    );
    const bulk = await getOracleBulk();
    const slims = JSON.parse(gunzipSync(bulk.gzipped).toString('utf8')) as Array<{
      name: string;
      isGameChanger?: boolean;
    }>;
    // Cyclonic Rift is on the hardcoded fallback list, so the flag still lands
    // even though the live query never returned anything.
    expect(slims.find((c) => c.name === 'Cyclonic Rift')?.isGameChanger).toBe(true);
  });
});
