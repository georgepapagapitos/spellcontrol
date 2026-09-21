// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSearchCards } from './use-search-cards';

// Minimal ScryfallCard shape for testing
const makeCard = (id: string) => ({ id, name: `Card ${id}` }) as never;

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  searchCards: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let mockSearchCards: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.useFakeTimers();
  const mod = await import('@/deck-builder/services/scryfall/client');
  mockSearchCards = mod.searchCards as ReturnType<typeof vi.fn>;
  mockSearchCards.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useSearchCards', () => {
  it('starts with empty results and no loading/error', () => {
    const { result } = renderHook(() => useSearchCards(''));
    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not search when query is shorter than 2 chars', async () => {
    renderHook(() => useSearchCards('a'));
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(mockSearchCards).not.toHaveBeenCalled();
  });

  it('clears results when query drops below 2 chars', async () => {
    const cards = [makeCard('1'), makeCard('2')];
    mockSearchCards.mockResolvedValueOnce({ data: cards });
    const { result, rerender } = renderHook(({ q }) => useSearchCards(q), {
      initialProps: { q: 'lightning' },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(result.current.results).toHaveLength(2);

    rerender({ q: 'l' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('is loading from the first keystroke, so a query waiting out the debounce never reads as "no matches" (playtest batch 10)', async () => {
    mockSearchCards.mockResolvedValue({ data: [] });
    // Every render's `loading`, in order — the FIRST one is the frame a deep
    // link paints before any effect has run.
    const seen: boolean[] = [];
    const { result } = renderHook(() => {
      const r = useSearchCards('lightning');
      seen.push(r.loading);
      return r;
    });
    expect(seen[0]).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current.loading).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(299);
    });
    // Still inside the debounce: no request yet, still pending.
    expect(mockSearchCards).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
    expect(seen).not.toContain(false);
  });

  it('debounces the search by 300ms', async () => {
    mockSearchCards.mockResolvedValue({ data: [] });
    renderHook(() => useSearchCards('lightning'));

    await act(async () => {
      vi.advanceTimersByTime(299);
    });
    expect(mockSearchCards).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(mockSearchCards).toHaveBeenCalledTimes(1);
  });

  it('calls searchCards with skipFormatFilter=true', async () => {
    mockSearchCards.mockResolvedValue({ data: [] });
    renderHook(() => useSearchCards('lightning'));
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(mockSearchCards).toHaveBeenCalledWith('lightning', [], { skipFormatFilter: true });
  });

  it('respects the limit param', async () => {
    const cards = Array.from({ length: 80 }, (_, i) => makeCard(String(i)));
    mockSearchCards.mockResolvedValue({ data: cards });
    const { result } = renderHook(() => useSearchCards('bolt', 40));
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(result.current.results).toHaveLength(40);
  });

  it('defaults to limit 60', async () => {
    const cards = Array.from({ length: 80 }, (_, i) => makeCard(String(i)));
    mockSearchCards.mockResolvedValue({ data: cards });
    const { result } = renderHook(() => useSearchCards('bolt'));
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(result.current.results).toHaveLength(60);
  });

  it('sets error and clears results on search failure', async () => {
    mockSearchCards.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useSearchCards('bolt'));
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(result.current.error).toBe('Network error');
    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  // ── the match count the page is allowed to state (board E341) ──────────
  it('keeps Scryfall’s own match count, which is not the page it returned', async () => {
    const cards = Array.from({ length: 80 }, (_, i) => makeCard(String(i)));
    mockSearchCards.mockResolvedValue({ data: cards, total_cards: 942 });
    const { result } = renderHook(() => useSearchCards('otag:sweeper'));
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    // Capped at 60 held, 942 matched — a caller that only knows the first
    // number tells a reader that 60 is the whole answer.
    expect(result.current.results).toHaveLength(60);
    expect(result.current.total).toBe(942);
  });

  it('reports an unknown total for a fetcher that returns a bare array', async () => {
    const fetcher = vi.fn(async () => ['alpha', 'beta']);
    const { result } = renderHook(() => useSearchCards<string>('bol', { fetcher }));
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(result.current.results).toEqual(['alpha', 'beta']);
    // null, not 2: the endpoint never said how many matched, and guessing the
    // page size is the same lie in a different place.
    expect(result.current.total).toBeNull();
  });

  it('clears the total when the query drops below the minimum or the search fails', async () => {
    mockSearchCards.mockResolvedValue({ data: [makeCard('1')], total_cards: 7 });
    const { result, rerender } = renderHook(({ q }) => useSearchCards(q), {
      initialProps: { q: 'bolt' },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(result.current.total).toBe(7);

    rerender({ q: 'b' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.total).toBeNull();

    mockSearchCards.mockRejectedValue(new Error('Network error'));
    rerender({ q: 'bolt' });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(result.current.total).toBeNull();
  });

  it('trims whitespace from query before searching', async () => {
    mockSearchCards.mockResolvedValue({ data: [] });
    renderHook(() => useSearchCards('  bolt  '));
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(mockSearchCards).toHaveBeenCalledWith('bolt', [], { skipFormatFilter: true });
  });
});
