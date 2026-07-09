// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';

// The radial tag menu and the desktop hover-peek share the deck list, and the
// menu's viewport wrapper is pointer-events: none — row hovers keep firing
// under an open ring. The rule under test: the radial supersedes the peek
// (an active peek clears on open, and no new peek floats while it's up).

function bolt(): ScryfallCard {
  return {
    id: 'sf-bolt',
    oracle_id: 'o-bolt',
    name: 'Lightning Bolt',
    mana_cost: '{R}',
    cmc: 1,
    type_line: 'Instant',
    color_identity: ['R'],
    keywords: [],
    rarity: 'common',
    set: 'lea',
    collector_number: '161',
    set_name: 'Test Set',
    prices: { usd: '1.00' },
    legalities: {},
    image_uris: {
      normal: 'https://cards.example/bolt-normal.jpg',
      large: 'https://cards.example/bolt-large.jpg',
    },
  } as unknown as ScryfallCard;
}

function renderDeck() {
  const cards: DeckDisplayCard[] = [{ slotId: 'slot-0', card: bolt() }];
  return render(
    <MemoryRouter>
      <DeckDisplay
        title="Test deck"
        commander={null}
        format="standard"
        cards={cards}
        onToggleCardTag={vi.fn()}
      />
    </MemoryRouter>
  );
}

const peek = () => document.querySelector('.deck-card-hover-peek');

describe('DeckDisplay radial tag menu vs hover-peek', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-decks-view-mode', 'list');
    // The peek is capability-gated to a fine+hover pointer and a >=1024px
    // viewport (gutter anchor) — mock both so it actually fires.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: query === '(hover: hover) and (pointer: fine)',
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }),
    });
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 1400 });
    Object.defineProperty(window, 'innerHeight', { writable: true, value: 900 });
  });

  it('opening the radial clears an active hover-peek', () => {
    const { container } = renderDeck();
    fireEvent.mouseOver(container.querySelector('[data-peek-name]')!);
    expect(peek()).not.toBeNull();

    fireEvent.pointerDown(container.querySelector('.deck-row-tag-btn')!, {
      clientX: 500,
      clientY: 300,
    });
    expect(document.querySelector('.radial-tag-menu')).not.toBeNull();
    expect(peek()).toBeNull();
  });

  it('row hovers while the radial is open do not float a peek', () => {
    const { container } = renderDeck();
    fireEvent.pointerDown(container.querySelector('.deck-row-tag-btn')!, {
      clientX: 500,
      clientY: 300,
    });
    expect(document.querySelector('.radial-tag-menu')).not.toBeNull();

    fireEvent.mouseOver(container.querySelector('[data-peek-name]')!);
    expect(peek()).toBeNull();
  });

  it('the peek works again after the menu closes', () => {
    const { container } = renderDeck();
    fireEvent.pointerDown(container.querySelector('.deck-row-tag-btn')!, {
      clientX: 500,
      clientY: 300,
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('.radial-tag-menu')).toBeNull();

    fireEvent.mouseOver(container.querySelector('[data-peek-name]')!);
    expect(peek()).not.toBeNull();
  });
});
