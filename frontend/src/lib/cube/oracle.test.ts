import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EnrichedCard } from '@/types';

const gate = vi.hoisted(() => ({ offline: false }));
const scryfall = vi.hoisted(() => ({ getCardsByNames: vi.fn() }));

vi.mock('@/store/offline', () => ({
  useOfflineStore: { getState: () => ({}) },
  offlineDataAvailable: () => gate.offline,
}));

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardsByNames: scryfall.getCardsByNames,
}));

import { fetchCubeOracle } from './oracle';

function owned(name: string, scryfallId: string): EnrichedCard {
  return {
    copyId: `${name}-1`,
    name,
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId,
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'manual',
    finish: 'nonfoil',
    foil: false,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  gate.offline = false;
  scryfall.getCardsByNames.mockReset();
  scryfall.getCardsByNames.mockResolvedValue(new Map());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchCubeOracle', () => {
  it('resolves the pool from our backend, not Scryfall', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse({ cards: [{ name: 'Sol Ring', oracle_text: 'Add CC.', cmc: 1 }] })
      );

    const result = await fetchCubeOracle(['Sol Ring'], [owned('Sol Ring', 'print-1')]);

    expect(result.get('Sol Ring')?.oracle_text).toBe('Add CC.');
    expect(scryfall.getCardsByNames).not.toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/api/cards/oracle-facts');
    // The owned printing id rides along so the server gets a primary-key hit.
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      cards: [{ name: 'Sol Ring', scryfallId: 'print-1' }],
    });
  });

  it('chunks a collection-sized pool instead of sending one giant body', async () => {
    const names = Array.from({ length: 4500 }, (_, i) => `Card ${i}`);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => jsonResponse({ cards: [] }));

    const progress: Array<[number, number]> = [];
    await fetchCubeOracle(names, [], (fetched, total) => progress.push([fetched, total]));

    // 2000-name chunks — 3 requests, not 4500 and not 1.
    expect(fetchSpy.mock.calls.length).toBe(3);
    for (const [, init] of fetchSpy.mock.calls) {
      const body = JSON.parse(String((init as RequestInit).body)) as { cards: unknown[] };
      expect(body.cards.length).toBeLessThanOrEqual(2000);
    }
    expect(progress[progress.length - 1]).toEqual([4500, 4500]);
  });

  it('falls back to the live Scryfall path when the backend is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'));
    scryfall.getCardsByNames.mockResolvedValue(
      new Map([['Sol Ring', { name: 'Sol Ring', oracle_text: 'Add CC.' }]])
    );

    const result = await fetchCubeOracle(['Sol Ring'], []);

    expect(scryfall.getCardsByNames).toHaveBeenCalledWith(['Sol Ring'], undefined);
    expect(result.get('Sol Ring')?.oracle_text).toBe('Add CC.');
  });

  it('falls back when the backend answers with an error status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));

    await fetchCubeOracle(['Sol Ring'], []);

    expect(scryfall.getCardsByNames).toHaveBeenCalled();
  });

  // Native with the offline bundle already holds every oracle row locally.
  it('reads the local oracle store and skips the network when offline data is present', async () => {
    gate.offline = true;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await fetchCubeOracle(['Sol Ring'], [owned('Sol Ring', 'print-1')]);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(scryfall.getCardsByNames).toHaveBeenCalled();
  });

  it('makes no request at all for an empty pool', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect((await fetchCubeOracle([], [])).size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
