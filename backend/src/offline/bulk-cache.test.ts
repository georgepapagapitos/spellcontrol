import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __getRefreshTimerForTesting,
  __resetOracleBulkForTesting,
  __runDailyRefreshTickForTesting,
  getOracleBulk,
} from './bulk-cache';

function mockScryfallFetch() {
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
      return new Response(
        JSON.stringify([
          {
            id: 's-1',
            oracle_id: 'o-1',
            name: 'Test Card',
            cmc: 1,
            type_line: 'Creature',
            colors: ['G'],
            color_identity: ['G'],
            keywords: [],
            legalities: { commander: 'legal' },
            set: 'tst',
            set_name: 'Test Set',
            collector_number: '1',
            games: ['paper'],
          },
        ]),
        { headers: { 'Content-Type': 'application/json' } }
      );
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
