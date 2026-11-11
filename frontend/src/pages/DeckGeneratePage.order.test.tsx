// @vitest-environment happy-dom
/**
 * The generator's order, once a commander is picked. Generate sat 3,300px
 * down on desktop and 4,000px on a phone, below a 1,400px Customize section,
 * with Themes (the choice most builds make) after all of it. Themes now come
 * straight after the build method, and Generate and Start blank ride a sticky
 * bar at the foot of the page. Brew is a door on the start page, not here.
 */
import 'fake-indexeddb/auto';
import { render, screen, within } from '@testing-library/react';
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
vi.mock('@/lib/sync', () => ({ isOnline: () => true, onSyncedChange: () => () => {} }));
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchCommanderData: () => Promise.resolve(null),
  fetchPartnerCommanderData: () => Promise.resolve(null),
}));
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

import { DeckGeneratePage } from './DeckGeneratePage';
import { useDeckBuilderStore } from '@/deck-builder/store';
import type { ScryfallCard } from '@/deck-builder/types';

const krenko = {
  id: 'krenko',
  name: 'Krenko, Mob Boss',
  color_identity: ['R'],
  type_line: 'Legendary Creature — Goblin Warrior',
  oracle_text: '{T}: Create X 1/1 red Goblin creature tokens.',
  legalities: { commander: 'legal' },
} as unknown as ScryfallCard;

const before = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

function renderPage(commander?: ScryfallCard, format?: string) {
  const entry = commander
    ? { pathname: '/decks/new/generate', state: { prefill: { commander, format } } }
    : '/decks/new/generate';
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <DeckGeneratePage />
    </MemoryRouter>
  );
}

describe('DeckGeneratePage order', () => {
  beforeEach(() => {
    localStorage.clear();
    useDeckBuilderStore.getState().reset();
    // Below 1024px the choices recap in the bottom bar.
    window.innerWidth = 800;
  });

  it('runs the steps in order: commander, Theme, How to build, Settings, Who can see it', () => {
    renderPage(krenko);
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent)
      .filter((t) => ['Theme', 'How to build', 'Settings', 'Who can see it'].includes(t ?? ''));
    expect(headings).toEqual(['Theme', 'How to build', 'Settings', 'Who can see it']);
    const themes = screen.getByTestId('themes');
    const method = screen.getByTestId('method');
    const customize = screen.getByTestId('customize');
    expect(before(themes, method)).toBe(true);
    expect(before(method, customize)).toBe(true);
  });

  it('numbers the steps', () => {
    renderPage(krenko);
    expect([...document.querySelectorAll('.deck-step-head')].map((h) => h.textContent)).toEqual([
      '1Choose a commander',
      '2Theme',
      '3How to build',
      '4Settings',
      '5Who can see it',
    ]);
  });

  it('Pauper Commander has no Theme step and renumbers', () => {
    renderPage(krenko, 'paupercommander');
    expect([...document.querySelectorAll('.deck-step-head')].map((h) => h.textContent)).toEqual([
      '1Choose a commander',
      '2How to build',
      '3Settings',
      '4Who can see it',
    ]);
  });

  it('puts Generate and Start blank in the build bar, after every setting', () => {
    renderPage(krenko);
    const bar = screen.getByRole('group', { name: 'Build this deck' });
    const generate = screen.getByRole('button', { name: 'Generate deck' });
    expect(bar.contains(generate)).toBe(true);
    expect(bar.contains(screen.getByRole('button', { name: 'Start blank' }))).toBe(true);
    expect(before(screen.getByTestId('customize'), bar)).toBe(true);
    // The bar is the page's last child, so at the end of the page it sits in
    // flow below the last section and covers none of it.
    expect(bar.parentElement?.lastElementChild).toBe(bar);
  });

  it('recaps the choices in the bar: commander, method and bracket', () => {
    renderPage(krenko);
    const bar = screen.getByRole('group', { name: 'Build this deck' });
    expect(bar.textContent).toContain('Krenko · EDHREC');
    expect(bar.textContent).toMatch(/Any bracket|Bracket \d/);
  });

  it('from 1024px recaps the choices in the sticky "Your deck" aside instead of the bar', () => {
    window.innerWidth = 1280;
    renderPage(krenko);
    const aside = screen.getByRole('complementary', { name: 'Your deck' });
    for (const label of ['Commander', 'Theme', 'Method', 'Bracket', 'Cards', 'Who sees it']) {
      expect(within(aside).getByText(label)).toBeTruthy();
    }
    expect(aside.textContent).toContain('Krenko, Mob Boss');
    expect(aside.textContent).toContain('EDHREC');
    // The two buttons live in the aside; there is one build group, not two.
    const groups = screen.getAllByRole('group', { name: 'Build this deck' });
    expect(groups).toHaveLength(1);
    expect(aside.contains(groups[0])).toBe(true);
    expect(within(aside).getByRole('button', { name: 'Generate deck' })).toBeTruthy();
    expect(within(aside).getByRole('button', { name: 'Start blank' })).toBeTruthy();
  });

  it('has no build bar and no Brew door before a commander is picked', () => {
    renderPage();
    expect(screen.queryByRole('group', { name: 'Build this deck' })).toBeNull();
    expect(screen.queryByRole('link', { name: /brew/i })).toBeNull();
  });
});
