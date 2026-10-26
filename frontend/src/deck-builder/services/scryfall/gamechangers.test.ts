/**
 * Defect A guard: a live `is:gamechanger` fetch that completes fully is
 * authoritative on its own — not unioned with the hardcoded floor — so a card
 * the Rules Committee removes stops flooring the bracket the moment the live
 * list agrees. Only a broken fetch falls back to (page 1) or unions with
 * (page 2+) the hardcoded list, so a page that never arrived can't undercount.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HARDCODED_GAME_CHANGERS } from '@spellcontrol/deck-metrics';
import { pending } from '@/test/pending';

// Re-import per test so the module-level GC cache (and its TTL) resets.
async function freshClient() {
  vi.resetModules();
  return import('./client');
}

function searchPage(names: string[], hasMore: boolean) {
  return new Response(
    JSON.stringify({
      object: 'list',
      total_cards: names.length,
      has_more: hasMore,
      data: names.map((name) => ({ name })),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('liveGetGameChangerNames', () => {
  it('a complete live fetch is authoritative — a hardcoded card the live list drops is not a GC', async () => {
    // Rhystic Study is on the hardcoded list but not returned by this "live"
    // fetch — a stand-in for the RC having removed it.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(searchPage(['Cyclonic Rift'], false));
    const { liveCardRepository } = await freshClient();

    const names = await liveCardRepository.getGameChangerNames();

    expect(names.has('Cyclonic Rift')).toBe(true);
    expect(names.has('Rhystic Study')).toBe(false);
  });

  it('page-1 failure falls back to the hardcoded list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const { liveCardRepository } = await freshClient();

    const names = await liveCardRepository.getGameChangerNames();

    expect(names).toEqual(new Set(HARDCODED_GAME_CHANGERS));
  });

  it('a page-2 failure unions the partial live set with the hardcoded floor, never undercounting', async () => {
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call += 1;
      if (call === 1) return searchPage(['Live-Only Game Changer'], true);
      return new Response('nope', { status: 500 });
    });
    const { liveCardRepository } = await freshClient();

    const names = await liveCardRepository.getGameChangerNames();

    // What page 1 actually returned, plus the hardcoded floor — page 2 never
    // arrived, so it must not silently drop anything.
    expect(names.has('Live-Only Game Changer')).toBe(true);
    expect(names.has('Rhystic Study')).toBe(true);
    for (const name of HARDCODED_GAME_CHANGERS) expect(names.has(name)).toBe(true);
  });
});

describe('getGameChangerNamesNow (E1039)', () => {
  function stubStorage() {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    return store;
  }

  it('answers from the last complete live list without waiting on the network', async () => {
    const store = stubStorage();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(searchPage(['Cyclonic Rift'], false));
    const first = await freshClient();
    await first.liveCardRepository.getGameChangerNames();
    expect(store.size).toBe(1);

    // A cold page: nothing in memory, the live fetch has not been answered yet.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(pending<Response>());
    const cold = await freshClient();
    const names = cold.getGameChangerNamesNow();

    expect([...names]).toEqual(['Cyclonic Rift']);
    // ...and it refreshes the list behind the answer.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to the hardcoded list when nothing was saved', async () => {
    stubStorage();
    vi.spyOn(globalThis, 'fetch').mockReturnValue(pending<Response>());
    const { getGameChangerNamesNow } = await freshClient();

    expect(getGameChangerNamesNow()).toEqual(new Set(HARDCODED_GAME_CHANGERS));
  });

  it('one live fetch serves every caller that arrives while it runs', async () => {
    stubStorage();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => searchPage(['Cyclonic Rift'], false));
    const { liveCardRepository } = await freshClient();

    await Promise.all([
      liveCardRepository.getGameChangerNames(),
      liveCardRepository.getGameChangerNames(),
      liveCardRepository.getGameChangerNames(),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('a hung or failing live fetch (E1039 review)', () => {
  it('times out, answers with the hardcoded floor and frees the latch', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(globalThis, 'fetch').mockReturnValue(pending<Response>());
      const { liveCardRepository } = await freshClient();

      const result = liveCardRepository.getGameChangerNames();
      await vi.advanceTimersByTimeAsync(16_000);

      expect(await result).toEqual(new Set(HARDCODED_GAME_CHANGERS));
    } finally {
      vi.useRealTimers();
    }
  });

  it('a later call after a failure fetches again instead of reusing the floor as fresh', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValue(searchPage(['Cyclonic Rift'], false));
    const { liveCardRepository } = await freshClient();

    const first = await liveCardRepository.getGameChangerNames();
    expect(first).toEqual(new Set(HARDCODED_GAME_CHANGERS));
    const second = await liveCardRepository.getGameChangerNames();

    expect(second).toEqual(new Set(['Cyclonic Rift']));
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
  });

  it('stops paginating at the page cap and keeps the hardcoded floor', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => searchPage(['Live Only'], true));
    const { liveCardRepository } = await freshClient();

    const names = await liveCardRepository.getGameChangerNames();

    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(5);
    expect(names.has('Live Only')).toBe(true);
    for (const n of HARDCODED_GAME_CHANGERS) expect(names.has(n)).toBe(true);
  });
});
