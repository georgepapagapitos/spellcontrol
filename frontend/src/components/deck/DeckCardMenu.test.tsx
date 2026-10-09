// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard, type DeckDisplayProps } from './DeckDisplay';

vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('@/lib/cards/use-tagger-ready', () => ({ useTaggerReady: () => false }));

// The menu picks its variant off a media query; happy-dom has no real
// matchMedia, so pin the desktop (floating) form for these assertions.
function setDesktop() {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function card(name: string, type_line: string): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `oracle-${name}`,
    name,
    cmc: 2,
    type_line,
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: { usd: '1.00' },
    legalities: {},
  } as unknown as ScryfallCard;
}

function deck(): DeckDisplayCard[] {
  return [
    { slotId: 's0', card: card('Brago', 'Legendary Creature — Spirit'), tags: ['Blink'] },
    { slotId: 's1', card: card('Bear', 'Creature — Bear') },
  ];
}

function renderDeck(props: Partial<DeckDisplayProps> = {}) {
  return render(
    <MemoryRouter>
      <DeckDisplay
        title="Test deck"
        commander={null}
        format="commander"
        cards={deck()}
        onSetCardTags={vi.fn()}
        {...props}
      />
    </MemoryRouter>
  );
}

const rowFor = (container: HTMLElement, name: string) =>
  container.querySelector(`.deck-row[data-peek-name="${name}"]`) as HTMLElement;
// A row's tap target is the button stretched over it, not the <li>.
const openFor = (container: HTMLElement, name: string) =>
  rowFor(container, name).querySelector('.deck-row-open') as HTMLElement;

describe('deck card menu', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-decks-view-mode', 'list');
    setDesktop();
  });

  it('opens on right-click of a list row, titled with the card', () => {
    const { container, getByRole } = renderDeck();
    fireEvent.contextMenu(rowFor(container, 'Bear'));
    expect(getByRole('menu', { name: 'Bear' })).toBeTruthy();
  });

  it('closes on Escape', () => {
    const { container, queryByRole } = renderDeck();
    fireEvent.contextMenu(rowFor(container, 'Bear'));
    expect(queryByRole('menu', { name: 'Bear' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByRole('menu', { name: 'Bear' })).toBeNull();
  });

  it('leaves the native menu alone over a text field', () => {
    // The deck toolbar's own search input lives inside the surface, and a
    // right-click there must still offer paste.
    const { container, queryByRole } = renderDeck();
    const input = container.querySelector('input[type="search"], input[type="text"]');
    expect(input).not.toBeNull();
    fireEvent.contextMenu(input!);
    expect(queryByRole('menu', { name: 'Bear' })).toBeNull();
  });

  it('groups its actions under labeled headings rather than one flat list', () => {
    const { container, getByRole } = renderDeck({ onRemoveCard: vi.fn(), onEditCard: vi.fn() });
    fireEvent.contextMenu(rowFor(container, 'Bear'));
    const menu = getByRole('menu', { name: 'Bear' });
    expect(menu.querySelectorAll('.deck-card-menu-heading').length).toBeGreaterThan(0);
  });

  describe('grid and stacks tiles', () => {
    beforeEach(() => localStorage.setItem('mtg-decks-view-mode', 'grid'));

    it('carry a kebab, since right-click is unreachable on touch and by keyboard', () => {
      const { getByRole } = renderDeck();
      const kebab = getByRole('button', { name: 'Actions for Bear' });
      expect(kebab.tagName).toBe('BUTTON');
      // A sibling of the tile, never nested inside it: the tile is a button.
      expect(kebab.closest('.deck-card-grid-tile')).toBeNull();
    });

    it('open the same menu from the kebab', () => {
      const { getByRole } = renderDeck();
      fireEvent.click(getByRole('button', { name: 'Actions for Bear' }));
      expect(getByRole('menu', { name: 'Bear' })).toBeTruthy();
    });

    it('open the menu on right-click too', () => {
      const { container, getByRole } = renderDeck();
      const cell = container.querySelector('.deck-card-grid-cell') as HTMLElement;
      fireEvent.contextMenu(cell);
      expect(getByRole('menu')).toBeTruthy();
    });
  });

  describe('tag actions', () => {
    it('lists the deck’s tags and marks the one this card is filed under', () => {
      const { container, getByRole } = renderDeck();
      fireEvent.contextMenu(rowFor(container, 'Brago'));
      fireEvent.click(getByRole('menuitem', { name: /Move to tag/ }));
      const pick = getByRole('menuitemradio', { name: 'Blink' });
      expect(pick.getAttribute('aria-checked')).toBe('true');
    });

    it('moving to a tag hoists it to primary and keeps the others', () => {
      const onSetCardTags = vi.fn();
      const cards: DeckDisplayCard[] = [
        { slotId: 's0', card: card('Brago', 'Creature'), tags: ['Blink', 'Wincon'] },
        { slotId: 's1', card: card('Bear', 'Creature'), tags: ['Draw'] },
      ];
      const { container, getByRole } = renderDeck({ cards, onSetCardTags });
      fireEvent.contextMenu(rowFor(container, 'Brago'));
      fireEvent.click(getByRole('menuitem', { name: /Move to tag/ }));
      fireEvent.click(getByRole('menuitemradio', { name: 'Draw' }));
      expect(onSetCardTags).toHaveBeenCalledWith('cards', ['s0'], ['Draw', 'Blink', 'Wincon']);
    });

    it('names a new tag and files the card under it', () => {
      const onSetCardTags = vi.fn();
      const { container, getByRole, getByLabelText } = renderDeck({ onSetCardTags });
      fireEvent.contextMenu(rowFor(container, 'Bear'));
      fireEvent.click(getByRole('menuitem', { name: /Move to tag/ }));
      const input = getByLabelText('New tag');
      fireEvent.change(input, { target: { value: '  Ramp  ' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      // Whitespace is normalized, and the card lands under the new tag.
      expect(onSetCardTags).toHaveBeenCalledWith('cards', ['s1'], ['Ramp']);
    });

    it('ignores a new tag name that is only whitespace', () => {
      const onSetCardTags = vi.fn();
      const { container, getByRole, getByLabelText } = renderDeck({ onSetCardTags });
      fireEvent.contextMenu(rowFor(container, 'Bear'));
      fireEvent.click(getByRole('menuitem', { name: /Move to tag/ }));
      const input = getByLabelText('New tag');
      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSetCardTags).not.toHaveBeenCalled();
    });

    it('takes a card out of its tag without touching its other tags', () => {
      const onSetCardTags = vi.fn();
      const cards: DeckDisplayCard[] = [
        { slotId: 's0', card: card('Brago', 'Creature'), tags: ['Blink', 'Wincon'] },
      ];
      const { container, getByRole } = renderDeck({ cards, onSetCardTags });
      fireEvent.contextMenu(rowFor(container, 'Brago'));
      fireEvent.click(getByRole('menuitem', { name: 'Take out of Blink' }));
      expect(onSetCardTags).toHaveBeenCalledWith('cards', ['s0'], ['Wincon']);
    });

    it('adds a tag WITHOUT re-filing the card, which Move to tag cannot do', () => {
      // The gap this page exists to close: before it, the only fast way to
      // tag a card also moved it out of the section it was in.
      const onSetCardTags = vi.fn();
      const cards: DeckDisplayCard[] = [
        { slotId: 's0', card: card('Brago', 'Creature'), tags: ['Blink'] },
        { slotId: 's1', card: card('Bear', 'Creature'), tags: ['Wincon'] },
      ];
      const { container, getByRole } = renderDeck({ cards, onSetCardTags });
      fireEvent.contextMenu(rowFor(container, 'Brago'));
      fireEvent.click(getByRole('menuitem', { name: /Add tag/ }));
      fireEvent.click(getByRole('menuitemcheckbox', { name: 'Wincon' }));
      // Appended, not hoisted: Blink is still first, so Brago stays filed
      // under Blink.
      expect(onSetCardTags).toHaveBeenCalledWith('cards', ['s0'], ['Blink', 'Wincon']);
    });

    it('marks every tag the card carries on the add page, not just the primary', () => {
      const cards: DeckDisplayCard[] = [
        { slotId: 's0', card: card('Brago', 'Creature'), tags: ['Blink', 'Wincon'] },
      ];
      const { container, getByRole } = renderDeck({ cards, onSetCardTags: vi.fn() });
      fireEvent.contextMenu(rowFor(container, 'Brago'));
      fireEvent.click(getByRole('menuitem', { name: /Add tag/ }));
      expect(getByRole('menuitemcheckbox', { name: 'Blink' }).getAttribute('aria-checked')).toBe(
        'true'
      );
      expect(getByRole('menuitemcheckbox', { name: 'Wincon' }).getAttribute('aria-checked')).toBe(
        'true'
      );
    });

    it('un-toggles a tag from the add page', () => {
      const onSetCardTags = vi.fn();
      const cards: DeckDisplayCard[] = [
        { slotId: 's0', card: card('Brago', 'Creature'), tags: ['Blink', 'Wincon'] },
      ];
      const { container, getByRole } = renderDeck({ cards, onSetCardTags });
      fireEvent.contextMenu(rowFor(container, 'Brago'));
      fireEvent.click(getByRole('menuitem', { name: /Add tag/ }));
      fireEvent.click(getByRole('menuitemcheckbox', { name: 'Wincon' }));
      expect(onSetCardTags).toHaveBeenCalledWith('cards', ['s0'], ['Blink']);
    });

    it('a new tag from the add page appends, so the section does not change', () => {
      const onSetCardTags = vi.fn();
      const cards: DeckDisplayCard[] = [
        { slotId: 's0', card: card('Brago', 'Creature'), tags: ['Blink'] },
      ];
      const { container, getByRole, getByLabelText } = renderDeck({ cards, onSetCardTags });
      fireEvent.contextMenu(rowFor(container, 'Brago'));
      fireEvent.click(getByRole('menuitem', { name: /Add tag/ }));
      const input = getByLabelText('New tag');
      fireEvent.change(input, { target: { value: 'Combo' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSetCardTags).toHaveBeenCalledWith('cards', ['s0'], ['Blink', 'Combo']);
    });

    it('a new tag from the MOVE page still hoists, so the card re-files', () => {
      const onSetCardTags = vi.fn();
      const cards: DeckDisplayCard[] = [
        { slotId: 's0', card: card('Brago', 'Creature'), tags: ['Blink'] },
      ];
      const { container, getByRole, getByLabelText } = renderDeck({ cards, onSetCardTags });
      fireEvent.contextMenu(rowFor(container, 'Brago'));
      fireEvent.click(getByRole('menuitem', { name: /Move to tag/ }));
      const input = getByLabelText('New tag');
      fireEvent.change(input, { target: { value: 'Combo' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSetCardTags).toHaveBeenCalledWith('cards', ['s0'], ['Combo', 'Blink']);
    });

    it('offers no tag actions when tags are read-only', () => {
      // Another action keeps the menu alive: a card with nothing to do has no
      // menu at all (see "has no menu when the deck is read-only").
      const { container, getByRole } = renderDeck({
        onSetCardTags: undefined,
        onRemoveCard: vi.fn(),
      });
      fireEvent.contextMenu(rowFor(container, 'Brago'));
      const menu = getByRole('menu', { name: 'Brago' });
      expect(within(menu).queryByRole('menuitem', { name: /Move to tag/ })).toBeNull();
    });
  });

  it('shows the same actions in the row kebab and the pointer menu', () => {
    // The two renderers share one action list; this is the guard that they
    // keep doing so.
    const handlers = { onRemoveCard: vi.fn(), onEditCard: vi.fn(), onSetCardTags: vi.fn() };
    const { container, getByRole, getAllByRole } = renderDeck(handlers);

    fireEvent.contextMenu(rowFor(container, 'Bear'));
    const fromPointer = within(getByRole('menu', { name: 'Bear' }))
      .getAllByRole('menuitem')
      .map((el) => el.textContent?.trim());
    fireEvent.keyDown(document, { key: 'Escape' });

    const kebab = within(rowFor(container, 'Bear')).getByRole('button', { name: 'Card actions' });
    fireEvent.click(kebab);
    const fromKebab = getAllByRole('menuitem').map((el) => el.textContent?.trim());

    expect(fromKebab).toEqual(fromPointer);
  });

  // ── T162: one menu, one mark, no dead ends ────────────────────────────
  it('has no menu when the deck is read-only: no ⋮, and right-click is the browser’s', () => {
    // A shared deck passes no card handlers; its menu used to open on a lone
    // disabled "Remove from deck".
    const { container, queryByRole } = renderDeck({ onSetCardTags: undefined });
    const row = rowFor(container, 'Bear');
    expect(within(row).queryByRole('button', { name: 'Card actions' })).toBeNull();
    expect(fireEvent.contextMenu(row)).toBe(true);
    expect(queryByRole('menu')).toBeNull();
  });

  it('marks the card its menu is open for, and clears it on close', () => {
    const { container } = renderDeck({ onRemoveCard: vi.fn() });
    const row = rowFor(container, 'Bear');
    fireEvent.contextMenu(row);
    expect(row.hasAttribute('data-menu-open')).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(row.hasAttribute('data-menu-open')).toBe(false);

    fireEvent.click(within(row).getByRole('button', { name: 'Card actions' }));
    expect(row.hasAttribute('data-menu-open')).toBe(true);
  });

  it('keeps a stacked card open while its menu is: the tile is marked', () => {
    localStorage.setItem('mtg-decks-view-mode', 'stacks');
    const { container } = renderDeck({ onRemoveCard: vi.fn() });
    const cell = container
      .querySelector('.deck-card-grid-tile[data-peek-name="Bear"]')!
      .closest('li') as HTMLElement;
    fireEvent.contextMenu(cell, { clientX: 20, clientY: 20 });
    // styles/deck-builder-card-list.css holds the tail open on this attribute.
    expect(cell.hasAttribute('data-menu-open')).toBe(true);
  });

  it('gives sideboard and considering rows the same menu from ⋮ and right-click', () => {
    // List mode's out-zone rows had a ⋮ but no right-click, and their ⋮ built
    // its actions from a narrower prop set than stacks mode's menu did.
    const sb = [{ slotId: 'sb1', card: card('Naturalize', 'Instant') }];
    const { container, getByRole, getAllByRole } = renderDeck({
      sideboard: sb,
      onRemoveCard: vi.fn(),
      onRemoveSideboardCard: vi.fn(),
      onMoveToMainboard: vi.fn(),
    });
    const row = rowFor(container, 'Naturalize');
    expect(fireEvent.contextMenu(row)).toBe(false);
    const fromPointer = within(getByRole('menu', { name: 'Naturalize' }))
      .getAllByRole('menuitem')
      .map((el) => el.textContent?.trim());
    expect(fromPointer).toContain('Move to mainboard');
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.click(within(row).getByRole('button', { name: 'Card actions' }));
    const fromKebab = getAllByRole('menuitem').map((el) => el.textContent?.trim());
    expect(fromKebab).toEqual(fromPointer);
  });

  it('opens the selection’s actions on a right-click of a selected card (T162)', () => {
    const onBulkMove = vi.fn();
    const { container, getByRole } = renderDeck({
      onRemoveCard: vi.fn(),
      onBulkMove,
      onBulkRemove: vi.fn(),
    });
    fireEvent.click(getByRole('button', { name: 'Select' }));
    fireEvent.click(openFor(container, 'Brago'));
    fireEvent.click(openFor(container, 'Bear'));

    const bar = getByRole('region', { name: 'Bulk actions' });
    const barLabels = within(bar)
      .getAllByRole('button')
      .map((el) => el.textContent?.trim())
      .filter((t) => t === 'Move to considering' || t === 'Remove');

    fireEvent.contextMenu(rowFor(container, 'Bear'), { clientX: 30, clientY: 30 });
    const menu = getByRole('menu', { name: '2 cards selected' });
    const menuLabels = within(menu)
      .getAllByRole('menuitem')
      .map((el) => el.textContent?.trim());
    expect(barLabels).toEqual(['Move to considering', 'Remove']);
    // The bar's moves and Remove, from the same list.
    for (const label of barLabels) expect(menuLabels).toContain(label);

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move to considering' }));
    expect(onBulkMove).toHaveBeenCalledWith(['s0', 's1'], 'cards', 'considering');
  });

  it('opens a card’s own menu when it is outside the selection', () => {
    const { container, getByRole } = renderDeck({
      onRemoveCard: vi.fn(),
      onBulkMove: vi.fn(),
    });
    fireEvent.click(getByRole('button', { name: 'Select' }));
    fireEvent.click(openFor(container, 'Brago'));
    fireEvent.contextMenu(rowFor(container, 'Bear'), { clientX: 30, clientY: 30 });
    expect(getByRole('menu', { name: 'Bear' })).toBeTruthy();
  });
});
