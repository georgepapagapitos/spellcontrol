// @vitest-environment happy-dom
/**
 * E389: the land sliders pre-fill from EDHREC when a commander is picked. For a
 * partner pair they read only the first commander's page, so the same pair got
 * 35 or 39 lands depending on which partner was picked first, while the pair's
 * own page (the one the generator reads) says 36.
 */
import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

vi.mock('../store/decks', () => ({
  useDecksStore: (sel: (s: { decks: unknown[]; createDeck: () => string }) => unknown) =>
    sel({ decks: [], createDeck: () => 'id' }),
}));
vi.mock('./sync', () => ({ isOnline: () => true, onSyncedChange: () => () => {} }));

const landsFor = (total: number, nonbasic: number) => ({
  stats: { landDistribution: { total, nonbasic, basic: total - nonbasic } },
});
const fetchCommanderData = vi.fn(async (name: string) =>
  name === 'Clara Oswald' ? landsFor(35, 10) : landsFor(39, 15)
);
const fetchPartnerCommanderData = vi.fn(async () => landsFor(36, 12));
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchCommanderData: (name: string) => fetchCommanderData(name),
  fetchPartnerCommanderData: (a: string, b: string) => fetchPartnerCommanderData(a, b),
}));

import { useDeckGeneration } from './use-deck-generation';
import { useDeckBuilderStore } from '@/deck-builder/store';

const card = (name: string, colors: string[]) =>
  ({ id: name, name, color_identity: colors, type_line: 'Legendary Creature' }) as ScryfallCard;
const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

describe('useDeckGeneration land pre-fill', () => {
  beforeEach(() => {
    localStorage.clear();
    useDeckBuilderStore.getState().reset();
    fetchCommanderData.mockClear();
    fetchPartnerCommanderData.mockClear();
  });

  it("reads a partner pair's own page", async () => {
    const store = useDeckBuilderStore.getState();
    store.setCommander(card('Clara Oswald', []));
    store.setPartnerCommander(card('The Tenth Doctor', ['U', 'R']));
    renderHook(() => useDeckGeneration(), { wrapper });

    await waitFor(() => expect(useDeckBuilderStore.getState().customization.landCount).toBe(36));
    expect(useDeckBuilderStore.getState().customization.nonBasicLandCount).toBe(12);
    expect(fetchPartnerCommanderData).toHaveBeenCalledWith('Clara Oswald', 'The Tenth Doctor');
  });

  it("reads a lone commander's page", async () => {
    useDeckBuilderStore.getState().setCommander(card('The Tenth Doctor', ['U', 'R']));
    renderHook(() => useDeckGeneration(), { wrapper });

    await waitFor(() => expect(useDeckBuilderStore.getState().customization.landCount).toBe(39));
    expect(fetchPartnerCommanderData).not.toHaveBeenCalled();
  });
});
