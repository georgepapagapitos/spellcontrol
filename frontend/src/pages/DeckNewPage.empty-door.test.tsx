// @vitest-environment happy-dom
/**
 * The "Empty deck" door on /decks/new (E465): one tap to a deck with no
 * commander, in the selected format, created Private. It sits above Format so
 * it is the first thing in reach, and it steps aside whenever the page already
 * carries an intent (a prefill, the binder door) or a commander is picked.
 */
import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return { ...real, useNavigate: () => navigateMock };
});
const createDeckMock = vi.fn((_input: Record<string, unknown>) => 'empty-deck-id');
vi.mock('../store/decks', () => ({
  useDecksStore: (sel: (s: { decks: unknown[]; createDeck: typeof createDeckMock }) => unknown) =>
    sel({ decks: [], createDeck: createDeckMock }),
}));
vi.mock('../store/auth', () => ({
  useAuth: <T,>(selector: (s: { status: string }) => T): T => selector({ status: 'authed' }),
}));
vi.mock('../lib/sync', () => ({ isOnline: () => true, onSyncedChange: () => () => {} }));
vi.mock('../components/deck/ImportDeckDialog', () => ({ ImportDeckDialog: () => null }));
vi.mock('../components/deck/CommanderSearch', () => ({
  CommanderSearch: () => <div data-testid="commander-search" />,
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
  fetchPartnerCommanderData: vi.fn(() => Promise.resolve(null)),
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

const follows = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

function renderPage(state?: Record<string, unknown>) {
  return render(
    <MemoryRouter initialEntries={[state ? { pathname: '/decks/new', state } : '/decks/new']}>
      <DeckNewPage />
    </MemoryRouter>
  );
}

const door = () => screen.queryByRole('button', { name: 'Empty deck' });

beforeEach(() => {
  localStorage.clear();
  useDeckBuilderStore.getState().reset();
});
afterEach(() => {
  navigateMock.mockClear();
  createDeckMock.mockClear();
});

describe('DeckNewPage — Empty deck door', () => {
  it('sits above Format and ahead of Commander search', () => {
    renderPage();
    const empty = door()!;
    expect(empty).toBeTruthy();
    const format = screen.getByRole('heading', { name: 'Format' });
    const commander = screen.getByRole('heading', { name: 'Commander' });
    expect(follows(empty, format)).toBe(true);
    expect(follows(format, commander)).toBe(true);
    expect(follows(empty, screen.getByTestId('commander-search'))).toBe(true);
    // Below the page header, not above it.
    expect(follows(screen.getByRole('heading', { name: 'New deck' }), empty)).toBe(true);
  });

  it('describes itself to assistive tech without folding the hint into its name', () => {
    renderPage();
    expect(door()!.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('creates a Private deck with no commander and opens it', () => {
    renderPage();
    fireEvent.click(door()!);
    expect(createDeckMock).toHaveBeenCalledTimes(1);
    expect(createDeckMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'manual',
        format: 'commander',
        commander: null,
        partnerCommander: null,
        initialVisibility: 'private',
      })
    );
    // The store default names it; the door never invents a name.
    expect(createDeckMock.mock.calls[0][0]).not.toHaveProperty('name');
    expect(navigateMock).toHaveBeenCalledWith('/decks/empty-deck-id');
  });

  it('uses the selected format pill', () => {
    renderPage();
    fireEvent.click(screen.getByRole('radio', { name: 'Brawl' }));
    fireEvent.click(door()!);
    expect(createDeckMock).toHaveBeenCalledWith(expect.objectContaining({ format: 'brawl' }));
  });

  it('steps aside for a format without a commander, which already creates in one step', () => {
    renderPage();
    fireEvent.click(screen.getByRole('radio', { name: 'Standard' }));
    expect(door()).toBeNull();
    expect(screen.getByRole('button', { name: 'Create deck' })).toBeTruthy();
  });

  it('steps aside when the page opened with a prefill', () => {
    renderPage({ prefill: { commander: TEYSA } });
    expect(door()).toBeNull();
  });

  it('steps aside for the "From my binder" door', () => {
    renderPage({ commanderSource: 'binder' });
    expect(door()).toBeNull();
  });

  it('steps aside once a commander is picked, where Start blank is the same start', () => {
    renderPage();
    expect(door()).toBeTruthy();
    act(() => useDeckBuilderStore.getState().setCommander(TEYSA));
    expect(door()).toBeNull();
    expect(screen.getByRole('button', { name: 'Start blank' })).toBeTruthy();
  });
});
