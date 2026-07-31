import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { ScryfallCache } from './cache';
import { resolveOracleFacts, toOracleFacts } from './oracle-facts';
import type { ScryfallCard } from './types';

const resolveCardsMock = vi.hoisted(() => vi.fn());
vi.mock('./scryfall', () => ({ resolveCards: resolveCardsMock }));

function card(overrides: Partial<ScryfallCard> & { id: string; name: string }): ScryfallCard {
  return {
    rarity: 'rare',
    set: 'cmr',
    set_name: 'Commander Legends',
    collector_number: '1',
    ...overrides,
  };
}

let dir: string;
let cache: ScryfallCache;

beforeEach(() => {
  resolveCardsMock.mockReset();
  resolveCardsMock.mockResolvedValue({ resolved: [], unresolvedNames: [], fetchErrorNames: [] });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-facts-'));
  cache = new ScryfallCache(path.join(dir, 'cards.db'));
});

afterEach(() => {
  cache.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Backdate every cached row past the 7-day TTL. */
function expireCache(): void {
  const db = (
    cache as unknown as {
      db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
    }
  ).db;
  const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
  db.prepare('UPDATE cards SET cached_at = ?').run(eightDaysAgo);
  db.prepare('UPDATE card_lookups SET cached_at = ?').run(eightDaysAgo);
}

describe('toOracleFacts', () => {
  it('joins both faces of a DFC so the classifier sees all the rules text', () => {
    const facts = toOracleFacts(
      'Jwari Disruption // Jwari Ruins',
      card({
        id: 'dfc',
        name: 'Jwari Disruption // Jwari Ruins',
        card_faces: [
          { name: 'Jwari Disruption', type_line: 'Instant', oracle_text: 'Counter it.', cmc: 1 },
          { name: 'Jwari Ruins', type_line: 'Land', oracle_text: 'Tap for U.' },
        ],
      })
    );

    expect(facts.oracle_text).toBe('Counter it.\nTap for U.');
    // Top-level type/cmc are null on these layouts — fall back to the front face.
    expect(facts.type_line).toBe('Instant');
    expect(facts.cmc).toBe(1);
  });

  it('carries only oracle facts — no images, prices or legalities', () => {
    const facts = toOracleFacts(
      'Sol Ring',
      card({
        id: 'a',
        name: 'Sol Ring',
        oracle_text: 'Add CC.',
        prices: { usd: '1.50' },
        legalities: { commander: 'legal' },
        image_uris: { normal: 'https://example.invalid/x.jpg' },
      })
    );

    expect(facts.oracle_text).toBe('Add CC.');
    expect(Object.keys(facts).sort()).toEqual([
      'cmc',
      'colors',
      'edhrec_rank',
      'keywords',
      'name',
      'oracle_id',
      'oracle_text',
      'type_line',
    ]);
  });
});

describe('resolveOracleFacts', () => {
  it('resolves by printing id without touching Scryfall, even past the TTL', async () => {
    cache.setMany([card({ id: 'print-1', name: 'Sol Ring', oracle_text: 'Add CC.' })]);
    expireCache();

    const facts = await resolveOracleFacts([{ name: 'Sol Ring', scryfallId: 'print-1' }], cache);

    expect(facts).toEqual([expect.objectContaining({ name: 'Sol Ring', oracle_text: 'Add CC.' })]);
    expect(resolveCardsMock).not.toHaveBeenCalled();
  });

  it('falls back to the name alias when the row has no printing id', async () => {
    cache.setMany([card({ id: 'print-2', name: 'Lightning Bolt', oracle_text: 'Deal 3.' })]);
    cache.setLookups([{ key: 'n:lightning bolt', scryfallId: 'print-2' }]);
    expireCache();

    const facts = await resolveOracleFacts([{ name: 'Lightning Bolt' }], cache);

    expect(facts[0]?.oracle_text).toBe('Deal 3.');
    expect(resolveCardsMock).not.toHaveBeenCalled();
  });

  it('sends only genuinely uncached names upstream', async () => {
    cache.setMany([card({ id: 'have', name: 'Sol Ring' })]);
    resolveCardsMock.mockResolvedValue({
      resolved: [card({ id: 'fetched', name: 'Birds of Paradise', oracle_text: 'Fly.' })],
      unresolvedNames: [],
      fetchErrorNames: [],
    });

    const facts = await resolveOracleFacts(
      [{ name: 'Sol Ring', scryfallId: 'have' }, { name: 'Birds of Paradise' }],
      cache
    );

    expect(resolveCardsMock).toHaveBeenCalledTimes(1);
    const rows = resolveCardsMock.mock.calls[0][0] as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toEqual(['Birds of Paradise']);
    expect(facts.map((f) => f.name).sort()).toEqual(['Birds of Paradise', 'Sol Ring']);
  });

  it('dedupes repeated names', async () => {
    cache.setMany([card({ id: 'dup', name: 'Sol Ring' })]);

    const facts = await resolveOracleFacts(
      [
        { name: 'Sol Ring', scryfallId: 'dup' },
        { name: 'Sol Ring', scryfallId: 'dup' },
      ],
      cache
    );

    expect(facts).toHaveLength(1);
  });

  // A cube still generates from the client's own collection rows, so a dead
  // upstream must degrade to a partial answer rather than failing the request.
  it('returns the cached subset when the upstream resolve throws', async () => {
    cache.setMany([card({ id: 'kept', name: 'Sol Ring' })]);
    resolveCardsMock.mockRejectedValue(new Error('scryfall down'));

    const facts = await resolveOracleFacts(
      [{ name: 'Sol Ring', scryfallId: 'kept' }, { name: 'Unknown Card' }],
      cache
    );

    expect(facts.map((f) => f.name)).toEqual(['Sol Ring']);
  });
});
