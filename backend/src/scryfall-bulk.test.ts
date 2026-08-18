import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { gzipSync } from 'node:zlib';
import { ScryfallCache } from './cache';
import { Readable } from 'node:stream';
import {
  projectBulkCard,
  ingestScryfallBulk,
  runScryfallBulkIngest,
  readBulkMeta,
  writeBulkMeta,
  fetchScryfallBulkEntry,
  streamBulkJsonl,
} from './scryfall-bulk';

let dir: string;
let dbPath: string;
let cache: ScryfallCache;

beforeEach(() => {
  vi.restoreAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-test-'));
  dbPath = path.join(dir, 'scryfall-cache.db');
  cache = new ScryfallCache(dbPath);
});

afterEach(() => {
  cache.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function bulk(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sf-1',
    name: 'Sol Ring',
    set: 'cmr',
    set_name: 'Commander Legends',
    collector_number: '472',
    rarity: 'uncommon',
    games: ['paper', 'mtgo'],
    layout: 'normal',
    ...overrides,
  };
}

describe('projectBulkCard', () => {
  it('projects the fields the app reads', () => {
    const out = projectBulkCard(bulk({ oracle_id: 'o-1', cmc: 1 }) as never);
    expect(out).toMatchObject({
      id: 'sf-1',
      name: 'Sol Ring',
      set: 'cmr',
      collector_number: '472',
      rarity: 'uncommon',
      oracle_id: 'o-1',
      cmc: 1,
    });
  });

  it('defaults missing rarity / set_name', () => {
    const out = projectBulkCard(bulk({ rarity: undefined, set_name: undefined }) as never);
    expect(out?.rarity).toBe('common');
    expect(out?.set_name).toBe('');
  });

  it('drops non-paper (digital-only) printings', () => {
    expect(projectBulkCard(bulk({ games: ['arena', 'mtgo'] }) as never)).toBeNull();
  });

  it('drops Alchemy printings', () => {
    expect(projectBulkCard(bulk({ set_type: 'alchemy' }) as never)).toBeNull();
  });

  it('drops malformed entries missing required fields', () => {
    expect(projectBulkCard(bulk({ name: '' }) as never)).toBeNull();
    expect(projectBulkCard(bulk({ collector_number: '' }) as never)).toBeNull();
  });

  it('keeps cards with no games field (treats as paper-eligible)', () => {
    expect(projectBulkCard(bulk({ games: undefined }) as never)).not.toBeNull();
  });
});

describe('ingestScryfallBulk', () => {
  async function* gen(cards: unknown[]) {
    for (const c of cards) yield c as never;
  }

  it('idles between flushes so it cannot monopolise a shared CPU', async () => {
    // The regression this guards: `setImmediate` yields but hands the CPU
    // straight back, so on shared-cpu-1x the ingest still burned the burst
    // quota, Fly throttled the machine, /health took >5s, and the proxy
    // evicted a perfectly healthy instance (2026-08-17 outage). A real delay
    // is what caps the duty cycle. Asserted as "a timer was scheduled with a
    // non-zero delay" rather than wall-clock, so this stays fast and stable.
    const scheduled: number[] = [];
    const realSetTimeout = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      fn: () => void,
      ms?: number
    ) => {
      scheduled.push(ms ?? 0);
      return realSetTimeout(fn, 0);
    }) as typeof globalThis.setTimeout);

    await ingestScryfallBulk(gen([bulk()]), cache);
    spy.mockRestore();

    expect(scheduled.some((ms) => ms > 0)).toBe(true);
  });

  it('writes cards and name+set(+collector) aliases, resolvable from cache', async () => {
    const result = await ingestScryfallBulk(gen([bulk()]), cache);
    expect(result.written).toBe(1);
    expect(result.aliases).toBe(2); // ns + nsc
    expect(result.skipped).toBe(0);

    // by id
    expect(cache.getMany(['sf-1']).get('sf-1')?.name).toBe('Sol Ring');
    // by name+set and name+set+collector
    expect(cache.getManyByKeys(['ns:sol ring|cmr']).get('ns:sol ring|cmr')?.id).toBe('sf-1');
    expect(cache.getManyByKeys(['nsc:sol ring|cmr|472']).get('nsc:sol ring|cmr|472')?.id).toBe(
      'sf-1'
    );
  });

  it('skips non-paper cards', async () => {
    const result = await ingestScryfallBulk(gen([bulk({ games: ['arena'] })]), cache);
    expect(result.written).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('stores tokens by id but excludes them from name+set aliases (no shadowing)', async () => {
    const token = bulk({ id: 'tok-1', name: 'Treasure', set: 'tcmr', layout: 'token' });
    const result = await ingestScryfallBulk(gen([token]), cache);
    expect(result.written).toBe(1);
    expect(result.aliases).toBe(0); // token layout excluded from alias generation
    expect(cache.getMany(['tok-1']).has('tok-1')).toBe(true);
    expect(cache.getManyByKeys(['ns:treasure|tcmr']).size).toBe(0);
  });

  it('uses the front face name for split / DFC alias keys', async () => {
    const dfc = bulk({ id: 'dfc-1', name: 'Front // Back', set: 'mid', collector_number: '50' });
    await ingestScryfallBulk(gen([dfc]), cache);
    // A name+set import row normalizes to the front face, so the alias is keyed by it.
    expect(cache.getManyByKeys(['ns:front|mid']).get('ns:front|mid')?.id).toBe('dfc-1');
  });

  it('flushes across batch boundaries (>FLUSH_AT cards)', async () => {
    const cards = Array.from({ length: 2500 }, (_, i) =>
      bulk({ id: `sf-${i}`, name: `Card ${i}`, collector_number: String(i) })
    );
    const result = await ingestScryfallBulk(gen(cards), cache);
    expect(result.written).toBe(2500);
    expect(cache.getMany(['sf-0', 'sf-2499']).size).toBe(2);
  });
});

describe('bulk meta', () => {
  it('round-trips and returns null when absent', () => {
    expect(readBulkMeta(dbPath)).toBeNull();
    writeBulkMeta(dbPath, { updatedAt: 123 });
    expect(readBulkMeta(dbPath)?.updatedAt).toBe(123);
  });
});

describe('streamBulkJsonl', () => {
  afterEach(() => vi.restoreAllMocks());

  // ⚠️ THIS TEST AND ITS FIX WERE SILENTLY REVERTED ONCE ALREADY. #1656 — an
  // AI-prompt PR cut from a branch older than #1657 — carried the pre-fix
  // version of both this file and scryfall-bulk.ts through its squash-merge.
  // CI stayed green because the test went out with the fix, and the reverted
  // code shipped to production. If you are resolving a conflict here, the
  // forward stays.
  it('a mid-download disconnect rejects the caller instead of killing the process', async () => {
    // ⛔ The regression this guards took production down repeatedly on
    // 2026-08-17. `.pipe()` does NOT forward source errors, so when the
    // ~450MB transfer dropped, `'error'` fired on the undici-backed Readable
    // with nobody listening — process-fatal, `exit_code=1`, and the ingest
    // restarted from zero forever because it only records success.
    //
    // A rejected promise here is the whole point: the JOB fails, the server
    // lives. Without the forward this test does not fail, it CRASHES the
    // worker, which is exactly how it behaved in prod.
    const body = new Readable({ read() {} });
    body.push(gzipSync(Buffer.from('{"id":"a"}\n')));
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: Readable.toWeb(body),
    } as unknown as Response);

    const iter = streamBulkJsonl<{ id: string }>('https://example.test/bulk.jsonl.gz');
    const first = await iter.next();
    expect(first.value).toEqual({ id: 'a' });

    // The socket dies mid-stream, exactly as undici surfaces it.
    body.destroy(new Error('terminated'));

    await expect(iter.next()).rejects.toThrow();
  });
});

describe('runScryfallBulkIngest', () => {
  it('skips when a recent run is recorded and force is not set', async () => {
    writeBulkMeta(dbPath, { updatedAt: Date.now() });
    const fetchSpy = vi.spyOn(global, 'fetch');
    const result = await runScryfallBulkIngest(cache, dbPath);
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ingests from the network and stamps meta when forced', async () => {
    // Scryfall's real index shape: `jsonl_download_uri` pointing at a gzipped,
    // line-delimited feed. This test used to mock `download_uri` and a JSON
    // array — a shape Scryfall no longer serves — so it stayed green for weeks
    // while the nightly ingest died on `fetch(undefined)` in production.
    const indexBody = {
      data: [
        { type: 'oracle_cards', jsonl_download_uri: 'https://x/oracle.jsonl.gz', updated_at: 'x' },
        {
          type: 'default_cards',
          jsonl_download_uri: 'https://x/default.jsonl.gz',
          updated_at: 'x',
        },
      ],
    };
    const feed = gzipSync(
      [JSON.stringify(bulk()), JSON.stringify(bulk({ games: ['arena'] }))].join('\n')
    );
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).endsWith('/bulk-data')) {
        return Promise.resolve(
          new Response(JSON.stringify(indexBody), {
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      return Promise.resolve(new Response(new Uint8Array(feed)));
    });

    const result = await runScryfallBulkIngest(cache, dbPath, { force: true });
    expect(result).toEqual({ written: 1, aliases: 2, skipped: 1 });
    expect(cache.getManyByKeys(['nsc:sol ring|cmr|472']).size).toBe(1);
    expect(readBulkMeta(dbPath)).not.toBeNull();
  });
});

describe('fetchScryfallBulkEntry', () => {
  function indexResponse(entries: unknown[]) {
    return Promise.resolve(
      new Response(JSON.stringify({ data: entries }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
  }

  // The regression this whole change exists for.
  it('resolves the JSONL download uri Scryfall actually serves', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() =>
      indexResponse([
        { type: 'default_cards', jsonl_download_uri: 'https://x/d.jsonl.gz', updated_at: 'u' },
      ])
    );
    await expect(fetchScryfallBulkEntry('default_cards')).resolves.toEqual({
      url: 'https://x/d.jsonl.gz',
      updatedAt: 'u',
      jsonl: true,
    });
  });

  it('still accepts a legacy download_uri, in case they put it back', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() =>
      indexResponse([{ type: 'default_cards', download_uri: 'https://x/d.json', updated_at: 'u' }])
    );
    const entry = await fetchScryfallBulkEntry('default_cards');
    expect(entry.url).toBe('https://x/d.json');
    expect(entry.jsonl).toBe(false);
  });

  // The actual failure mode: a missing uri used to return `undefined` and blow
  // up much later as "Failed to parse URL from undefined", inside a catch that
  // only logged. Fail where the problem is.
  it('throws when the entry carries no download uri at all', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() =>
      indexResponse([{ type: 'default_cards', updated_at: 'u' }])
    );
    await expect(fetchScryfallBulkEntry('default_cards')).rejects.toThrow(/no download URI/);
  });

  it('throws when the requested type is absent', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => indexResponse([]));
    await expect(fetchScryfallBulkEntry('default_cards')).rejects.toThrow(/no default_cards/);
  });
});
