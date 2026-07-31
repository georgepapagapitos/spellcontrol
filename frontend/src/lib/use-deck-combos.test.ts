// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { __testing, useDeckCombos } from './use-deck-combos';
import type { ComboMatch, ComboMatchResponse } from '../types/combos';

const { filterByIdentity, cache } = __testing;

const matchCombos = vi.fn();
vi.mock('./api/combos', () => ({ matchCombos: (req: unknown) => matchCombos(req) }));

const match = (id: string, identity: string): ComboMatch => ({
  combo: {
    id,
    identity,
    produces: [],
    prerequisites: null,
    description: null,
    manaNeeded: null,
    popularity: 0,
    cardCount: 2,
    bracket: null,
    cards: [],
  },
  presentOracleIds: [],
  missingOracleIds: ['m1'],
});

const response = (): ComboMatchResponse => ({
  inDeck: [match('in-r', 'r')],
  oneAway: [match('ug', 'gu'), match('r', 'r'), match('c', 'c'), match('unknown', '')],
  almostInCollection: [match('wub', 'wub')],
  source: 'local',
});

describe('filterByIdentity', () => {
  it('passes everything through when no identity restriction (null)', () => {
    expect(filterByIdentity(response(), null)).toEqual(response());
  });

  it('drops suggestion combos whose identity escapes the deck, keeps in-identity ones', () => {
    const out = filterByIdentity(response(), 'GU');
    expect(out.oneAway.map((m) => m.combo.id)).toEqual(['ug', 'c', 'unknown']);
    expect(out.almostInCollection).toHaveLength(0);
  });

  it('never filters inDeck — assembled combos are facts, not suggestions', () => {
    expect(filterByIdentity(response(), 'GU').inDeck.map((m) => m.combo.id)).toEqual(['in-r']);
  });

  it('colorless commander ("") keeps only colorless/unknown combos', () => {
    const out = filterByIdentity(response(), '');
    expect(out.oneAway.map((m) => m.combo.id)).toEqual(['c', 'unknown']);
  });
});

/**
 * E212: matchCombos() falls back to the server matcher (capped at 2000
 * candidates) when the device-local combo dataset can't be used. That result
 * must never be presented as final the way a full local result is — this
 * guards the two mechanisms that prevent it: the fallback is never
 * module-cached (so the next mount retries automatically), and `data.source`
 * tells the caller which answer it got so the UI can render a degraded state.
 */
describe('useDeckCombos — server-fallback result never sticks', () => {
  beforeEach(() => {
    cache.clear();
    matchCombos.mockReset();
  });

  const args = { deckOracleIds: [], ownedOracleIds: ['a', 'b'], format: 'commander' };

  it('does not cache a source:"server" result, so a later mount refetches', async () => {
    matchCombos.mockResolvedValue({ ...response(), source: 'server' });

    const first = renderHook(() => useDeckCombos(args));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current.data?.source).toBe('server');
    first.unmount();

    // Same inputs, fresh mount — a real `source: 'local'` result would have
    // been served instantly from the module cache with zero extra calls.
    const callsAfterFirst = matchCombos.mock.calls.length;
    const second = renderHook(() => useDeckCombos(args));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(matchCombos.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('caches a source:"local" result normally (no refetch on remount)', async () => {
    matchCombos.mockResolvedValue({ ...response(), source: 'local' });

    const first = renderHook(() => useDeckCombos(args));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();
    const callsAfterFirst = matchCombos.mock.calls.length;

    const second = renderHook(() => useDeckCombos(args));
    await waitFor(() => expect(second.result.current.data).not.toBeNull());
    expect(matchCombos.mock.calls.length).toBe(callsAfterFirst);
  });

  it('refetch() re-runs the match, bypassing the cache', async () => {
    matchCombos.mockResolvedValue({ ...response(), source: 'server' });
    const { result } = renderHook(() => useDeckCombos(args));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const callsBefore = matchCombos.mock.calls.length;

    result.current.refetch();
    await waitFor(() => expect(matchCombos.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});
