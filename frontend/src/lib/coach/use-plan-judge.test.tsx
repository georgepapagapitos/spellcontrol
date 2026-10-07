// @vitest-environment happy-dom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deck } from '@/store/decks';
import type { CutSwapSources } from './objective-for-deck';

const loadSourcesObjective = vi.fn();
vi.mock('./objective-for-deck', () => ({
  loadSourcesObjective: (...args: unknown[]) => loadSourcesObjective(...args),
}));
vi.mock('@/deck-builder/services/scryfall/client', () => ({ getCachedCard: () => undefined }));

const { usePlanJudge } = await import('./use-plan-judge');

const sources = (): CutSwapSources => ({
  deck: { id: 'd1', cards: [], bracketOverride: null } as unknown as Deck,
  combos: null,
  owned: [],
});

describe('usePlanJudge', () => {
  beforeEach(() => {
    loadSourcesObjective.mockReset();
  });

  it('builds nothing while the plan is closed', () => {
    const { result } = renderHook(() => usePlanJudge(sources(), false));
    expect(result.current).toEqual({ status: 'idle' });
    expect(loadSourcesObjective).not.toHaveBeenCalled();
  });

  it('falls back to the plan own rules when the deck has no sources', () => {
    const { result } = renderHook(() => usePlanJudge(undefined, true));
    expect(result.current).toMatchObject({ status: 'fallback' });
  });

  it('loads, then falls back with the reason when the deck cannot be scored', async () => {
    loadSourcesObjective.mockResolvedValue({ ok: false, reason: 'thin-page' });
    const { result } = renderHook(() => usePlanJudge(sources(), true));
    expect(result.current).toEqual({ status: 'loading' });
    await waitFor(() =>
      expect(result.current).toEqual({ status: 'fallback', reason: 'thin-page' })
    );
  });

  it('falls back when building the objective throws', async () => {
    loadSourcesObjective.mockImplementation(async () => {
      throw new Error('boom');
    });
    const { result } = renderHook(() => usePlanJudge(sources(), true));
    await waitFor(() => expect(result.current).toEqual({ status: 'fallback', reason: 'error' }));
  });

  it('waits while the deck combos are still loading', () => {
    const { result } = renderHook(() => usePlanJudge(sources(), true, true));
    expect(result.current).toEqual({ status: 'loading' });
    expect(loadSourcesObjective).not.toHaveBeenCalled();
  });
});
