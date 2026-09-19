// @vitest-environment happy-dom
// The deck list on a wide screen (2026-09-19): a pinned card rail beside the
// columns on a wide, hover-capable display; rows that rest sparse (no role
// code by default); and a labelled Group dropdown in place of the three-icon
// toggle. See STYLE_GUIDE § Deck list on a wide screen.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';

vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

function card(name: string, over: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `oracle-${name}`,
    name,
    mana_cost: '{1}{R}',
    cmc: 2,
    type_line: 'Creature — Goblin',
    color_identity: ['R'],
    keywords: [],
    rarity: 'common',
    set: 'lea',
    collector_number: '1',
    set_name: 'Test Set',
    prices: { usd: '1.00' },
    legalities: {},
    image_uris: { normal: `https://img/${name}.jpg`, large: `https://img/${name}-large.jpg` },
    ...over,
  } as unknown as ScryfallCard;
}

function slots(names: string[]): DeckDisplayCard[] {
  return names.map((name, i) => ({ slotId: `slot-${name}-${i}`, card: card(name) }));
}

/** DeckDisplay reads its breakpoints through matchMedia. `wideHover` answers
 *  the rail's own query (≥1280px + fine pointer) and the hover-peek hook's
 *  capability query; the narrow breakpoints always say no. */
function setViewport(wideHover: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: /max-width/.test(query) ? false : wideHover,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
  Object.defineProperty(window, 'innerWidth', { writable: true, value: wideHover ? 1600 : 900 });
  Object.defineProperty(window, 'innerHeight', { writable: true, value: 900 });
}

function renderDeck(opts: { wideHover: boolean; commander?: ScryfallCard | null }) {
  setViewport(opts.wideHover);
  return render(
    <MemoryRouter>
      <DeckDisplay
        title="Test deck"
        commander={opts.commander === undefined ? card('Krenko, Mob Boss') : opts.commander}
        format="commander"
        cards={slots(['Goblin Lackey', 'Skirk Prospector'])}
      />
    </MemoryRouter>
  );
}

describe('deck list on a wide screen — pinned card rail', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-decks-view-mode', 'list');
  });

  it('shows the commander in the rail until a row is hovered', () => {
    const { container } = renderDeck({ wideHover: true });
    const rail = container.querySelector('.deck-card-rail');
    expect(rail).not.toBeNull();
    expect(rail!.querySelector('.deck-card-rail-name')!.textContent).toBe('Krenko, Mob Boss');
  });

  it('follows the hovered row and keeps it after the pointer leaves', () => {
    const { container } = renderDeck({ wideHover: true });
    const row = container.querySelector<HTMLElement>('[data-peek-name="Goblin Lackey"]')!;
    expect(row).not.toBeNull();
    row.getBoundingClientRect = () =>
      ({ top: 100, left: 0, right: 300, bottom: 120, width: 300, height: 20 }) as DOMRect;
    fireEvent.mouseOver(row, { clientX: 10, clientY: 110 });
    expect(container.querySelector('.deck-card-rail-name')!.textContent).toBe('Goblin Lackey');

    // Leaving the list clears the transient peek but the rail remembers.
    fireEvent.mouseLeave(container.querySelector('.deck-card-list')!);
    expect(container.querySelector('.deck-card-hover-peek')).toBeNull();
    expect(container.querySelector('.deck-card-rail-name')!.textContent).toBe('Goblin Lackey');
  });

  it('is absent below the wide/hover gate (the floating peek path is untouched)', () => {
    const { container } = renderDeck({ wideHover: false });
    expect(container.querySelector('.deck-card-rail')).toBeNull();
    expect(container.querySelector('.deck-list-layout')).toBeNull();
  });

  it('with no commander, invites a hover instead of showing nothing', () => {
    const { container } = renderDeck({ wideHover: true, commander: null });
    expect(container.querySelector('.deck-card-rail-empty')).not.toBeNull();
  });
});

describe('deck list on a wide screen — sparse rows and a labelled Group menu', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-decks-view-mode', 'list');
  });

  it('renders no role code on a row by default (Show → Roles opts in)', () => {
    const { container } = renderDeck({ wideHover: false });
    expect(container.querySelector('.deck-row .deck-row-role-badge')).toBeNull();
  });

  it('a stored Roles preference still wins', () => {
    localStorage.setItem(
      'mtg-decks-show-prefs',
      JSON.stringify({ price: true, roles: true, mana: true })
    );
    const { container } = renderDeck({ wideHover: false });
    expect(container.querySelector('.deck-row .deck-row-role-badge')).not.toBeNull();
  });

  it('the group lens is a labelled dropdown, not an unlabelled icon group', () => {
    const { getByRole, queryByRole } = renderDeck({ wideHover: false });
    // The trigger carries its visible label + current value ("Group" "Type").
    expect(getByRole('button', { name: /Group.*Type/ })).toBeTruthy();
    expect(queryByRole('group', { name: /Group cards by/ })).toBeNull();
  });
});
