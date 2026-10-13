// @vitest-environment happy-dom
/**
 * The New deck form already fetches the commander's EDHREC page when one is picked (for the
 * land suggestion). Its profile reads that page's themes, so a vetoed commander stops reading
 * voltron as soon as the page lands, with no extra request (golden.md R11).
 */
import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  vetoedCard,
  vetoedPage,
} from '@/deck-builder/services/deckBuilder/__fixtures__/vetoed-commanders';

vi.mock('@/store/decks', () => ({
  useDecksStore: (sel: (s: { decks: unknown[]; createDeck: () => string }) => unknown) =>
    sel({ decks: [], createDeck: () => 'id' }),
}));
vi.mock('@/lib/sync', () => ({ isOnline: () => true, onSyncedChange: () => () => {} }));

const fetchCommanderData = vi.fn();
vi.mock('@/deck-builder/services/edhrec/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/deck-builder/services/edhrec/client')>()),
  fetchCommanderData: (name: string) => fetchCommanderData(name),
}));

import { useDeckGeneration } from './use-deck-generation';
import { useDeckBuilderStore } from '@/deck-builder/store';

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const isVoltron = (p: { abilities: { keyword: string }[] } | null) =>
  !!p?.abilities.some((a) => a.keyword === 'voltron');

describe('useDeckGeneration commander profile', () => {
  beforeEach(() => {
    localStorage.clear();
    useDeckBuilderStore.getState().reset();
    fetchCommanderData.mockReset();
  });

  it('drops voltron once the pre-fetched page lands', async () => {
    const name = 'Gisela, Blade of Goldnight';
    fetchCommanderData.mockImplementation(async () => vetoedPage(name));
    useDeckBuilderStore.getState().setCommander(vetoedCard(name));
    const { result } = renderHook(() => useDeckGeneration(), { wrapper });

    await waitFor(() => expect(isVoltron(result.current.commanderProfile)).toBe(false));
    expect(fetchCommanderData).toHaveBeenCalledTimes(1);
  });

  it('keeps the text reading when the page is unavailable', async () => {
    const name = 'Emrakul, the Promised End';
    fetchCommanderData.mockRejectedValue(new Error('offline'));
    useDeckBuilderStore.getState().setCommander(vetoedCard(name));
    const { result } = renderHook(() => useDeckGeneration(), { wrapper });

    await waitFor(() => expect(fetchCommanderData).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(isVoltron(result.current.commanderProfile)).toBe(true);
  });
});
