import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getCommanderStats,
  getCommanderStatsBatch,
  type CommanderStats,
} from './aggregates-client';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const stats: CommanderStats = {
  commanderKey: 'oracle-atraxa',
  commanderName: "Atraxa, Praetors' Voice",
  partnerName: null,
  deckCount: 156,
  avgBracket: 3.2,
  bracketSampleCount: 140,
  budgetDistribution: { low: 40, mid: 90, high: 26 },
  topCards: [{ oracleId: 'oracle-sol-ring', cardName: 'Sol Ring', deckCount: 150, pct: 96 }],
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('getCommanderStats', () => {
  it('returns the parsed object on 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(stats));
    expect(await getCommanderStats('oracle-atraxa')).toEqual(stats);
  });

  it('returns null on 404 (below threshold)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Not enough public decks yet.' }, { status: 404 })
    );
    expect(await getCommanderStats('oracle-unknown')).toBeNull();
  });

  it('returns null and never rejects on a network throw', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await expect(getCommanderStats('oracle-atraxa')).resolves.toBeNull();
  });
});

describe('getCommanderStatsBatch', () => {
  it('returns a Map keyed by commanderKey, missing keys simply absent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ commanders: [stats] }));
    const map = await getCommanderStatsBatch(['oracle-atraxa', 'oracle-does-not-exist']);
    expect(map.size).toBe(1);
    expect(map.get('oracle-atraxa')).toEqual(stats);
    expect(map.has('oracle-does-not-exist')).toBe(false);
  });

  it('returns an empty Map on total failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const map = await getCommanderStatsBatch(['oracle-atraxa']);
    expect(map.size).toBe(0);
  });

  it('returns an empty Map without fetching when keys is empty', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const map = await getCommanderStatsBatch([]);
    expect(map.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
