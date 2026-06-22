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
