// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard, type DeckDisplayProps } from './DeckDisplay';

vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

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

// A deck with two tagged cards and two untagged ones, so every branch of the
// partition is exercised by one fixture.
function deck(): DeckDisplayCard[] {
  return [
    { slotId: 's0', card: card('Brago', 'Legendary Creature — Spirit'), tags: ['Blink'] },
    { slotId: 's1', card: card('Brainstorm', 'Instant'), tags: ['Draw'] },
    { slotId: 's2', card: card('Bear', 'Creature — Bear') },
    { slotId: 's3', card: card('Forest', 'Basic Land — Forest') },
  ];
}

function renderDeck(cards: DeckDisplayCard[], props: Partial<DeckDisplayProps> = {}) {
  return render(
    <MemoryRouter>
      <DeckDisplay title="Test deck" commander={null} format="commander" cards={cards} {...props} />
    </MemoryRouter>
  );
}

function sectionTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.deck-section-title')).map((el) => {
    const countEl = el.querySelector('.deck-section-count');
    const withoutCount = countEl
      ? el.textContent?.replace(countEl.textContent ?? '', '')
      : el.textContent;
    return withoutCount?.replace(/\s+/g, ' ').trim() ?? '';
  });
}

describe('DeckDisplay tag lens', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-decks-view-mode', 'list');
    localStorage.setItem('mtg-decks-group-by', 'tag');
  });

  it("renders the user's own tags first, then the type fallbacks", () => {
    const { container } = renderDeck(deck());
    expect(sectionTitles(container)).toEqual(['Blink', 'Draw', 'Creature', 'Land']);
  });

  it('PARTITIONS: a multi-tagged card appears once, and counts sum to the deck', () => {
    const cards: DeckDisplayCard[] = [
      { slotId: 's0', card: card('Brago', 'Creature'), tags: ['Blink', 'Wincon', 'Combo'] },
      { slotId: 's1', card: card('Bear', 'Creature') },
    ];
    const { container } = renderDeck(cards);
    // The retired overlapping lens would have produced Blink + Wincon + Combo.
    expect(sectionTitles(container)).toEqual(['Blink', 'Creature']);
  });

  it('shows no overlap banner anywhere, because there is no overlapping lens', () => {
    const { container } = renderDeck(deck());
    expect(container.querySelector('.deck-tag-honesty-banner')).toBeNull();
    expect(container.textContent).toContain('Each card is filed under its first tag');
  });

  it('keeps the tag manager reachable from this lens', () => {
    const { getByRole } = renderDeck(deck(), {
      onRenameDeckTag: vi.fn(),
      onRemoveDeckTag: vi.fn(),
    });
    expect(getByRole('button', { name: 'Manage deck tags' })).toBeTruthy();
  });

  it('labels the derived lens "Roles", not "Category"', () => {
    localStorage.setItem('mtg-decks-group-by', 'category');
    const { container } = renderDeck(deck());
    expect(container.textContent).toContain('Each card is filed under one role');
  });

  it('collapses a section and hides only its rows, keeping the header readable', () => {
    const { container, getByRole } = renderDeck(deck());
    const toggle = getByRole('button', { name: 'Collapse Blink' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(toggle);

    const reToggle = getByRole('button', { name: 'Expand Blink' });
    expect(reToggle.getAttribute('aria-expanded')).toBe('false');
    const listId = reToggle.getAttribute('aria-controls');
    expect((container.querySelector(`#${listId}`) as HTMLElement).hidden).toBe(true);
    // The header survives: a collapsed section that still states its size is
    // the whole point of collapsing one.
    expect(sectionTitles(container)).toContain('Blink');
  });

  it('persists the collapsed section across a remount, keyed by lens', () => {
    const first = renderDeck(deck());
    fireEvent.click(first.getByRole('button', { name: 'Collapse Blink' }));
    first.unmount();

    const second = renderDeck(deck());
    expect(second.getByRole('button', { name: 'Expand Blink' })).toBeTruthy();

    // A different lens must not inherit the fold.
    second.unmount();
    localStorage.setItem('mtg-decks-group-by', 'type');
    const third = renderDeck(deck());
    expect(third.getByRole('button', { name: 'Collapse Creature' })).toBeTruthy();
  });

  it('filters the deck by TAG as well as by name, in any layout', () => {
    // This is what replaced the overlapping tag lens: "show me everything
    // tagged Combo" is a filter, so it works under every grouping and in all
    // three layouts instead of being a grouping whose counts did not sum.
    localStorage.setItem('mtg-decks-group-by', 'type');
    const cards: DeckDisplayCard[] = [
      { slotId: 's0', card: card('Brago', 'Creature'), tags: ['Blink'] },
      { slotId: 's1', card: card('Bear', 'Creature') },
    ];
    const { container, getByLabelText } = renderDeck(cards);
    fireEvent.change(getByLabelText('Search this deck'), { target: { value: 'blink' } });

    // :not(.is-leaving) matters — a filtered-out row stays mounted through its
    // exit animation, which never fires under happy-dom.
    const names = Array.from(
      container.querySelectorAll('.deck-row[data-peek-name]:not(.is-leaving)')
    ).map((el) => el.getAttribute('data-peek-name'));
    // Brago matches on its tag, not its name; Bear matches neither.
    expect(names).toEqual(['Brago']);
  });

  it('gives grid and stacks section headers a price, which was list-only before', () => {
    localStorage.setItem('mtg-decks-view-mode', 'stacks');
    const { container } = renderDeck(deck());
    expect(container.querySelector('.deck-grid-section .deck-section-subtotal')).not.toBeNull();
  });
});
