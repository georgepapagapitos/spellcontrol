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

describe('DeckDisplay stacks lens', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-decks-view-mode', 'list');
    localStorage.setItem('mtg-decks-group-by', 'stack');
  });

  it('renders user stacks first, then the type fallbacks', () => {
    const { container } = renderDeck(deck());
    expect(sectionTitles(container)).toEqual(['Blink', 'Draw', 'Creature', 'Land']);
  });

  it('does NOT show the tag-overlap banner, because this lens partitions', () => {
    const { container } = renderDeck(deck());
    expect(container.querySelector('.deck-tag-honesty-banner')).toBeNull();
    expect(container.textContent).toContain('Each card sits in one stack');
  });

  it('still shows the overlap banner under the tag lens', () => {
    localStorage.setItem('mtg-decks-group-by', 'tag');
    const { container } = renderDeck(deck());
    expect(container.querySelector('.deck-tag-honesty-banner')).not.toBeNull();
  });

  it('keeps the tag manager reachable, since the banner that hosts it is gone', () => {
    const { getByRole } = renderDeck(deck(), {
      onRenameDeckTag: vi.fn(),
      onRemoveDeckTag: vi.fn(),
    });
    expect(getByRole('button', { name: 'Manage deck stacks' })).toBeTruthy();
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
    // The header survives: a collapsed stack that still states its size is
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

  it('gives grid and stacks section headers a price, which was list-only before', () => {
    localStorage.setItem('mtg-decks-view-mode', 'stacks');
    const { container } = renderDeck(deck());
    expect(container.querySelector('.deck-grid-section .deck-section-subtotal')).not.toBeNull();
  });
});
