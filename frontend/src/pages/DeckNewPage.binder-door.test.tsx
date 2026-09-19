// @vitest-environment happy-dom
/**
 * Arriving at /decks/new from the Decks index's "From my binder" door opens
 * the commander picker on that tab. A plain visit leaves the picker to its
 * own remembered tab.
 */
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('../components/deck/ImportDeckDialog', () => ({ ImportDeckDialog: () => null }));
vi.mock('../components/deck/CommanderSearch', () => ({
  CommanderSearch: ({ initialSearchMode }: { initialSearchMode?: string }) => (
    <div data-testid="commander-search" data-initial-mode={initialSearchMode ?? ''} />
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

import { DeckNewPage } from './DeckNewPage';
import { useDeckBuilderStore } from '@/deck-builder/store';

afterEach(() => useDeckBuilderStore.getState().reset());

describe('DeckNewPage — "From my binder" door', () => {
  it('opens the commander picker on the binder tab when the door sent us', () => {
    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/decks/new', state: { commanderSource: 'binder' } }]}
      >
        <DeckNewPage />
      </MemoryRouter>
    );
    expect(screen.getByTestId('commander-search').getAttribute('data-initial-mode')).toBe('binder');
  });

  it('leaves the picker to its remembered tab on a plain visit', () => {
    render(
      <MemoryRouter initialEntries={['/decks/new']}>
        <DeckNewPage />
      </MemoryRouter>
    );
    expect(screen.getByTestId('commander-search').getAttribute('data-initial-mode')).toBe('');
  });
});
