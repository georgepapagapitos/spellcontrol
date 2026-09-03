// @vitest-environment happy-dom
/**
 * The brew door on /decks/new sits BELOW the commander picker and carries a
 * commander already picked there, so a phone's first screen is the primary
 * action and brew mode never asks for the same commander twice.
 */
import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return { ...real, useNavigate: () => navigateMock };
});
vi.mock('../store/decks', () => ({
  useDecksStore: (sel: (s: { decks: unknown[]; createDeck: () => string }) => unknown) =>
    sel({ decks: [], createDeck: () => 'new-deck-id' }),
}));
vi.mock('../store/auth', () => ({
  useAuth: <T,>(selector: (s: { status: string }) => T): T => selector({ status: 'guest' }),
}));
vi.mock('../lib/sync', () => ({ isOnline: () => true, onSyncedChange: () => () => {} }));
vi.mock('../components/deck/ImportDeckDialog', () => ({ ImportDeckDialog: () => null }));
vi.mock('../components/deck/CommanderSearch', () => ({ CommanderSearch: () => null }));
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

import { DeckNewPage } from './DeckNewPage';
import { useDeckBuilderStore } from '@/deck-builder/store';

const TEYSA = {
  id: 'c1',
  oracle_id: 'o1',
  name: 'Teysa, Orzhov Scion',
  cmc: 3,
  type_line: 'Legendary Creature — Human Advisor',
  color_identity: ['W', 'B'],
  keywords: [],
  rarity: 'rare',
  set: 'gpt',
  set_name: 'Guildpact',
} as unknown as ScryfallCard;

afterEach(() => {
  navigateMock.mockClear();
  useDeckBuilderStore.getState().reset();
});

describe('DeckNewPage — brew door', () => {
  it('renders after the commander picker, not before it', () => {
    render(
      <MemoryRouter>
        <DeckNewPage />
      </MemoryRouter>
    );
    const commanderHeading = screen.getByRole('heading', { name: 'Commander' });
    const brewDoor = screen.getByText('Prefer to pick every card?');
    expect(
      commanderHeading.compareDocumentPosition(brewDoor) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('carries an already-picked commander into brew mode', () => {
    render(
      <MemoryRouter>
        <DeckNewPage />
      </MemoryRouter>
    );
    act(() => useDeckBuilderStore.getState().setCommander(TEYSA));
    fireEvent.click(screen.getByRole('button', { name: 'Start brewing →' }));
    expect(navigateMock).toHaveBeenCalledWith('/decks/new/brew', { state: { commander: TEYSA } });
  });

  it('opens brew mode plain when no commander is picked yet', () => {
    render(
      <MemoryRouter>
        <DeckNewPage />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start brewing →' }));
    expect(navigateMock).toHaveBeenCalledWith('/decks/new/brew', undefined);
  });
});
