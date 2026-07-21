import { describe, expect, it, vi } from 'vitest';
import { resolvePlatformCounts } from './CommanderSearch';
import type { ScryfallCard } from '@/deck-builder/types';
import type { CommanderStats } from '@/lib/aggregates-client';

// CommanderSearch.tsx has no test file today (43KB, heavy store/EDHREC/
// Scryfall-client surface) and this PR's own Risks note calls for a strictly
// additive diff there — so rather than standing up a full component mount
// just for the new commander-picker badge, this covers the extracted,
// dependency-injected `resolvePlatformCounts` helper directly: the one piece
// of genuinely new logic (batch-once semantics, skip-on-resolution-failure).
// The surrounding effects that call it (gated on pdh / activeSearchMode,
// cancelled via the same closure-scoped flag every sibling effect in this
// file already uses) are thin wiring proven by code review, matching this
// file's own zero-existing-coverage baseline for that cancellation idiom.

function card(oracleId: string): ScryfallCard {
  return { id: oracleId, oracle_id: oracleId, name: oracleId } as unknown as ScryfallCard;
}

function stats(commanderKey: string, deckCount: number): CommanderStats {
  return {
    commanderKey,
    commanderName: commanderKey,
    partnerName: null,
    deckCount,
    avgBracket: null,
    bracketSampleCount: 0,
    budgetDistribution: { low: null, mid: null, high: null },
    topCards: [],
  };
}

describe('resolvePlatformCounts', () => {
  it('fires exactly one batch call keyed by every resolved candidate', async () => {
    const getCardByName = vi.fn(async (name: string) => card(`oracle-${name}`));
    const getCommanderStatsBatch = vi.fn(async (keys: string[]) => {
      expect(keys.sort()).toEqual(['oracle-atraxa', 'oracle-krenko']);
      return new Map([['oracle-atraxa', stats('oracle-atraxa', 156)]]);
    });

    const result = await resolvePlatformCounts([{ name: 'atraxa' }, { name: 'krenko' }], {
      getCardByName,
      getCommanderStatsBatch,
    });

    expect(getCommanderStatsBatch).toHaveBeenCalledTimes(1);
    expect(result.get('atraxa')).toBe(156);
    // krenko resolved fine but has no stats row (below threshold) — simply absent.
    expect(result.has('krenko')).toBe(false);
  });

  it('skips a candidate whose name resolution fails without blocking the others', async () => {
    const getCardByName = vi.fn(async (name: string) => {
      if (name === 'unknown-name') throw new Error('not found');
      return card(`oracle-${name}`);
    });
    const getCommanderStatsBatch = vi.fn(async (keys: string[]) => {
      expect(keys).toEqual(['oracle-atraxa']);
      return new Map([['oracle-atraxa', stats('oracle-atraxa', 42)]]);
    });

    const result = await resolvePlatformCounts([{ name: 'atraxa' }, { name: 'unknown-name' }], {
      getCardByName,
      getCommanderStatsBatch,
    });

    expect(result.get('atraxa')).toBe(42);
    expect(result.has('unknown-name')).toBe(false);
  });

  it('returns an empty map without calling the batch endpoint when every candidate fails to resolve', async () => {
    const getCardByName = vi.fn(async () => {
      throw new Error('offline');
    });
    const getCommanderStatsBatch = vi.fn();

    const result = await resolvePlatformCounts([{ name: 'atraxa' }], {
      getCardByName,
      getCommanderStatsBatch,
    });

    expect(result.size).toBe(0);
    expect(getCommanderStatsBatch).not.toHaveBeenCalled();
  });

  it('returns an empty map for an empty candidate list', async () => {
    const getCardByName = vi.fn();
    const getCommanderStatsBatch = vi.fn();
    const result = await resolvePlatformCounts([], { getCardByName, getCommanderStatsBatch });
    expect(result.size).toBe(0);
    expect(getCardByName).not.toHaveBeenCalled();
    expect(getCommanderStatsBatch).not.toHaveBeenCalled();
  });
});
