// @vitest-environment happy-dom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  vetoedCard,
  VETOED_COMMANDERS,
} from '@/deck-builder/services/deckBuilder/__fixtures__/vetoed-commanders';
import { resetVoltronVetoForTests } from './commander-voltron-veto';
import { useCommanderProfile } from './use-commander-profile';

// With no EDHREC page cached (offline, or this surface never fetched it), the shipped snapshot
// still gives the profile the same Voltron veto the finder's "Plays like" chips apply.
afterEach(() => {
  vi.unstubAllGlobals();
  resetVoltronVetoForTests();
});

describe('useCommanderProfile with the snapshot and no cached page', () => {
  it('reads Voltron from the text until the snapshot lands, then drops it and says why', async () => {
    const name = VETOED_COMMANDERS[0];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ names: [name.toLowerCase()] }) }))
    );
    const { result } = renderHook(() => useCommanderProfile(vetoedCard(name)));
    expect(result.current?.abilities.some((a) => a.keyword === 'voltron')).toBe(true);
    await waitFor(() => expect(result.current?.voltronVetoed).toBe(true));
    expect(result.current?.abilities.some((a) => a.keyword === 'voltron')).toBe(false);
  });
});
