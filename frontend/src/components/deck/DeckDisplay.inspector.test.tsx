// @vitest-environment happy-dom
// The card inspector (2026-09-20): a sticky detail column beside the deck body
// on a wide, hover-capable display, shared by all three view modes, showing
// what a row cannot (oracle text, ownership) and holding a card while it's
// read. Also covers the 2026-09-19 rulings it inherits: rows that rest sparse
// (no role code by default) and a labelled Group dropdown.
// See STYLE_GUIDE § Deck list on a wide screen.
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
    oracle_text: `${name} does a thing when it enters.`,
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
 *  the inspector's own query (≥1440px + fine pointer) and the hover-peek hook's
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

/** Hover a card by its delegated peek attribute, with a stable rect so the
 *  placement math has something to work from. */
function hoverCard(container: HTMLElement, name: string) {
  const el = container.querySelector<HTMLElement>(`[data-peek-name="${name}"]`)!;
  expect(el).not.toBeNull();
  el.getBoundingClientRect = () =>
    ({ top: 100, left: 0, right: 300, bottom: 120, width: 300, height: 20 }) as DOMRect;
  fireEvent.mouseOver(el, { clientX: 10, clientY: 110 });
  return el;
}

const nameOf = (container: HTMLElement) =>
  container.querySelector('.deck-card-inspector-name')?.textContent;

describe('card inspector', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-decks-view-mode', 'list');
  });

  it('shows the commander until a card is hovered', () => {
    const { container } = renderDeck({ wideHover: true });
    expect(container.querySelector('.deck-card-inspector')).not.toBeNull();
    expect(nameOf(container)).toBe('Krenko, Mob Boss');
  });

  it('follows the hovered card and keeps it after the pointer leaves', () => {
    const { container } = renderDeck({ wideHover: true });
    hoverCard(container, 'Goblin Lackey');
    expect(nameOf(container)).toBe('Goblin Lackey');

    // Leaving the list clears the transient peek; the inspector remembers.
    fireEvent.mouseLeave(container.querySelector('.deck-card-list')!);
    expect(container.querySelector('.deck-card-hover-peek')).toBeNull();
    expect(nameOf(container)).toBe('Goblin Lackey');
  });

  it('shows what the row cannot: oracle text and the ownership line', () => {
    const { container } = renderDeck({ wideHover: true });
    hoverCard(container, 'Goblin Lackey');
    expect(container.querySelector('.deck-card-inspector-oracle')!.textContent).toBe(
      'Goblin Lackey does a thing when it enters.'
    );
    expect(container.querySelector('.deck-card-inspector-owned-text')!.textContent).toBeTruthy();
  });

  it('pinning holds the card while the pointer moves on', () => {
    const { container, getByLabelText } = renderDeck({ wideHover: true });
    hoverCard(container, 'Goblin Lackey');
    fireEvent.click(getByLabelText('Pin Goblin Lackey'));

    hoverCard(container, 'Skirk Prospector');
    expect(nameOf(container)).toBe('Goblin Lackey');

    // Unpinning hands the panel back to the pointer's last answer.
    fireEvent.click(getByLabelText('Unpin Goblin Lackey'));
    expect(nameOf(container)).toBe('Skirk Prospector');
  });

  it('answers to the keyboard, not only the pointer', () => {
    const { container } = renderDeck({ wideHover: true });
    const row = container.querySelector<HTMLElement>('[data-peek-name="Skirk Prospector"]')!;
    row.getBoundingClientRect = () =>
      ({ top: 100, left: 0, right: 300, bottom: 120, width: 300, height: 20 }) as DOMRect;
    fireEvent.focus(row.querySelector('button')!);
    expect(nameOf(container)).toBe('Skirk Prospector');
  });

  it('serves the card views too, not just the list', () => {
    localStorage.setItem('mtg-decks-view-mode', 'stacks');
    const { container } = renderDeck({ wideHover: true });
    expect(container.querySelector('.deck-card-inspector')).not.toBeNull();
    hoverCard(container, 'Goblin Lackey');
    expect(nameOf(container)).toBe('Goblin Lackey');
  });

  // A sticky column only sticks for the height of its containing block. While
  // "Not in the deck" sat OUTSIDE .deck-body-layout, the inspector came unstuck
  // at the end of the card list and rode up under the site header for the whole
  // rest of the page — the card you were reading disappeared.
  it('keeps "Not in the deck" inside the column it sticks against', () => {
    const { container } = renderDeck({ wideHover: true });
    const main = container.querySelector('.deck-body-main')!;
    expect(main.closest('.deck-body-layout')).not.toBeNull();
    expect(main.querySelector('.deck-outzone')).not.toBeNull();
  });

  it('is absent below the wide/hover gate, where the floating peek takes over', () => {
    const { container } = renderDeck({ wideHover: false });
    expect(container.querySelector('.deck-card-inspector')).toBeNull();
    expect(container.querySelector('.deck-body-layout')).toBeNull();
  });

  it('with no commander, invites a hover instead of showing nothing', () => {
    const { container } = renderDeck({ wideHover: true, commander: null });
    expect(container.querySelector('.deck-card-inspector-empty')).not.toBeNull();
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
