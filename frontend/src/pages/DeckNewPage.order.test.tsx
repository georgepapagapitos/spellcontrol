// @vitest-environment happy-dom
/**
 * The new-deck page's order, once a commander is picked. Generate sat 3,300px
 * down on desktop and 4,000px on a phone, below a 1,400px Customize section,
 * with Themes (the choice most builds make) after all of it. Themes now come
 * straight after the build method, and the Brew promo joins Generate and Start
 * blank as the third way to build.
 */
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return { ...real, useNavigate: () => vi.fn() };
});
vi.mock('../store/decks', () => ({
  useDecksStore: (sel: (s: { decks: unknown[]; createDeck: () => string }) => unknown) =>
    sel({ decks: [], createDeck: () => 'id' }),
}));
vi.mock('../store/auth', () => ({
  useAuth: <T,>(selector: (s: { status: string }) => T): T => selector({ status: 'authed' }),
}));
vi.mock('../lib/sync', () => ({ isOnline: () => true, onSyncedChange: () => () => {} }));
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchCommanderData: () => Promise.resolve(null),
  fetchPartnerCommanderData: () => Promise.resolve(null),
}));
vi.mock('../components/deck/ImportDeckDialog', () => ({ ImportDeckDialog: () => null }));
vi.mock('../components/deck/CommanderSearch', () => ({ CommanderSearch: () => null }));
vi.mock('../components/deck/CommanderProfileCard', () => ({
  CommanderProfileCard: () => <div data-testid="profile" />,
}));
vi.mock('../components/deck/PartnerCommanderSelector', () => ({
  PartnerCommanderSelector: () => <div data-testid="partner" />,
}));
vi.mock('../components/deck/ThemePicker', () => ({
  ThemePicker: () => <div data-testid="themes" />,
}));
vi.mock('../components/deck/DeckCustomizer', () => ({
  DeckCustomizer: () => <div data-testid="customize" />,
}));
vi.mock('../components/deck/GenerationModePicker', () => ({
  GenerationModePicker: () => <div data-testid="method" />,
}));
vi.mock('../components/deck/GenerationTakeover', () => ({ GenerationTakeover: () => null }));

import { DeckNewPage } from './DeckNewPage';
import { useDeckBuilderStore } from '@/deck-builder/store';
import type { ScryfallCard } from '@/deck-builder/types';

const krenko = {
  id: 'krenko',
  name: 'Krenko, Mob Boss',
  color_identity: ['R'],
  type_line: 'Legendary Creature — Goblin Warrior',
  oracle_text: '{T}: Create X 1/1 red Goblin creature tokens.',
} as unknown as ScryfallCard;

const before = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

function renderPage(commander?: ScryfallCard) {
  const entry = commander
    ? { pathname: '/decks/new', state: { prefill: { commander } } }
    : '/decks/new';
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <DeckNewPage />
    </MemoryRouter>
  );
}

describe('DeckNewPage order', () => {
  beforeEach(() => {
    localStorage.clear();
    useDeckBuilderStore.getState().reset();
  });

  it('puts Themes right after the build method, ahead of Customize', () => {
    renderPage(krenko);
    const method = screen.getByTestId('method');
    const themes = screen.getByTestId('themes');
    const customize = screen.getByTestId('customize');
    expect(before(method, themes)).toBe(true);
    expect(before(themes, customize)).toBe(true);
  });

  it('offers Brew beside Generate once a commander is picked', () => {
    renderPage(krenko);
    const generate = screen.getByRole('button', { name: 'Generate deck' });
    const brew = screen.getByRole('button', { name: /Start brewing/ });
    expect(before(generate, brew)).toBe(true);
    expect(before(screen.getByTestId('customize'), brew)).toBe(true);
  });

  it('keeps the Brew promo under the picker before a commander is picked', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Start brewing/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Generate deck' })).toBeNull();
  });
});
