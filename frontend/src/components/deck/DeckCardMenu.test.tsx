// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard, type DeckDisplayProps } from './DeckDisplay';

vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('@/lib/use-tagger-ready', () => ({ useTaggerReady: () => false }));

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

  it('groups its actions under labelled headings rather than one flat list', () => {
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

    it('offers no tag actions when the deck is read-only', () => {
      const { container, getByRole } = renderDeck({ onSetCardTags: undefined });
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
});
