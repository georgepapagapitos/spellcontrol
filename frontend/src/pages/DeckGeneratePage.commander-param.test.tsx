// @vitest-environment happy-dom
/**
 * `?commander=<name>` (the Trending rail's "Build with …" tiles) opens the
 * generator with that commander picked, then drops the param so a later
 * Change survives a reload. A name that doesn't resolve leaves the finder
 * open, and a prefill (regenerate, combo seed) wins over the param.
 */
import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, type InitialEntry } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return { ...real, useNavigate: () => vi.fn() };
});
vi.mock('../store/decks', () => ({
  useDecksStore: (sel: (s: { decks: unknown[]; createDeck: () => string }) => unknown) =>
    sel({ decks: [], createDeck: () => 'new-deck-id' }),
}));
vi.mock('../store/auth', () => ({
  useAuth: <T,>(selector: (s: { status: string }) => T): T => selector({ status: 'guest' }),
}));
vi.mock('../lib/sync', () => ({ isOnline: () => true, onSyncedChange: () => () => {} }));
vi.mock('../components/deck/CommanderSearch', () => ({
  CommanderSearch: ({ value }: { value: ScryfallCard | null }) => (
    <div data-testid="commander-search" data-value={value?.name ?? ''} />
  ),
}));
vi.mock('../components/deck/CommanderProfileCard', () => ({ CommanderProfileCard: () => null }));
vi.mock('../components/deck/PartnerCommanderSelector', () => ({
  PartnerCommanderSelector: () => null,
}));
vi.mock('../components/deck/ThemePicker', () => ({ ThemePicker: () => null }));
vi.mock('../components/deck/DeckCustomizer', () => ({ DeckCustomizer: () => null }));
vi.mock('../components/deck/GenerationModePicker', () => ({ GenerationModePicker: () => null }));
vi.mock('../components/deck/GenerationTakeover', () => ({ GenerationTakeover: () => null }));
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchCommanderData: vi.fn(() => Promise.resolve(null)),
  fetchCommanderThemeData: vi.fn(() => Promise.resolve(null)),
  fetchCommanderThemes: vi.fn(() => Promise.resolve([])),
}));
const getCardByName = vi.fn(async (name: string): Promise<ScryfallCard> => {
  if (name === 'Nobody') throw new Error('not found');
  return {
    id: `id-${name}`,
    oracle_id: `o-${name}`,
    name,
    type_line: 'Legendary Creature — Goblin Warrior',
    color_identity: ['R'],
    oracle_text: '',
    cmc: 3,
    prices: {},
    legalities: { commander: 'legal' },
  } as unknown as ScryfallCard;
});
vi.mock('@/deck-builder/services/scryfall/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/deck-builder/services/scryfall/client')>()),
  getCardByName: (name: string) => getCardByName(name),
}));

import { DeckGeneratePage } from './DeckGeneratePage';
import { useDeckBuilderStore } from '@/deck-builder/store';

afterEach(() => {
  useDeckBuilderStore.getState().reset();
  getCardByName.mockClear();
});

function Search() {
  return <div data-testid="search">{useLocation().search}</div>;
}

const renderAt = (entry: InitialEntry) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <DeckGeneratePage />
      <Search />
    </MemoryRouter>
  );

describe('DeckGeneratePage ?commander=', () => {
  it('opens with that commander picked and drops the param', async () => {
    renderAt('/decks/new/generate?format=commander&commander=Krenko%2C%20Mob%20Boss');
    await waitFor(() =>
      expect(screen.getByTestId('commander-search').dataset.value).toBe('Krenko, Mob Boss')
    );
    expect(getCardByName).toHaveBeenCalledWith('Krenko, Mob Boss');
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe('?format=commander'));
  });

  it('leaves the finder open when the name does not resolve', async () => {
    renderAt('/decks/new/generate?commander=Nobody');
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''));
    expect(screen.getByTestId('commander-search').dataset.value).toBe('');
  });

  it('lets a prefill win over the param', async () => {
    const prefillCommander = {
      id: 'id-meren',
      oracle_id: 'o-meren',
      name: 'Meren of Clan Nel Toth',
      type_line: 'Legendary Creature — Human Shaman',
      color_identity: ['B', 'G'],
      prices: {},
      legalities: { commander: 'legal' },
    } as unknown as ScryfallCard;
    renderAt({
      pathname: '/decks/new/generate',
      search: '?commander=Krenko%2C%20Mob%20Boss',
      state: { prefill: { commander: prefillCommander } },
    });
    await waitFor(() =>
      expect(screen.getByTestId('commander-search').dataset.value).toBe('Meren of Clan Nel Toth')
    );
    expect(getCardByName).not.toHaveBeenCalled();
  });
});
