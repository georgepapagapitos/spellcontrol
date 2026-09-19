// @vitest-environment happy-dom
// Stacks view (2026-09-19): the Moxfield/Archidekt visual-stacks layout —
// one column per group, the grid's own tile overlapped so only each name
// strip shows. See STYLE_GUIDE § Deck list on a wide screen.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';
import { readStoredViewMode } from './deck-display-rows';

vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

function card(name: string, type_line: string): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `oracle-${name}`,
    name,
    mana_cost: '{1}{R}',
    cmc: 2,
    type_line,
    color_identity: ['R'],
    keywords: [],
    rarity: 'common',
    set: 'lea',
    collector_number: '1',
    set_name: 'Test Set',
    prices: { usd: '1.00' },
    legalities: {},
    image_uris: { normal: `https://img/${name}.jpg` },
  } as unknown as ScryfallCard;
}

const DECK: DeckDisplayCard[] = [
  { slotId: 's1', card: card('Goblin Lackey', 'Creature — Goblin') },
  { slotId: 's2', card: card('Skirk Prospector', 'Creature — Goblin') },
  { slotId: 's3', card: card('Lightning Bolt', 'Instant') },
];

function setWide() {
  window.matchMedia = ((query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

function renderDeck() {
  setWide();
  return render(
    <MemoryRouter>
      <DeckDisplay title="Test deck" commander={null} format="commander" cards={DECK} />
    </MemoryRouter>
  );
}

describe('deck Stacks view', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders one overlapped column per group, using the grid tile', () => {
    localStorage.setItem('mtg-decks-view-mode', 'stacks');
    const { container } = renderDeck();
    const stacks = container.querySelectorAll('.deck-card-stack');
    expect(stacks.length).toBe(2); // Creature, Instant
    // Same tile as the grid: qty/alloc/legality/badges all come along.
    expect(container.querySelectorAll('.deck-card-stack .deck-card-grid-tile').length).toBe(3);
    expect(container.querySelector('.deck-card-grid-sections--stacks')).not.toBeNull();
    // No list rows, no rail — this is a card-forward view.
    expect(container.querySelector('.deck-row')).toBeNull();
    expect(container.querySelector('.deck-card-rail')).toBeNull();
  });

  it('sets a per-zoom card width on each stack', () => {
    localStorage.setItem('mtg-decks-view-mode', 'stacks');
    const { container } = renderDeck();
    const section = container.querySelector<HTMLElement>('.deck-grid-section--stack')!;
    expect(section.style.getPropertyValue('--stack-w-desktop')).toMatch(/^\d+px$/);
    expect(section.style.getPropertyValue('--stack-w-mobile')).toMatch(/^\d+px$/);
  });

  it('is the middle option of the view toggle and persists like the others', () => {
    localStorage.setItem('mtg-decks-view-mode', 'grid');
    const { getByRole, container } = renderDeck();
    const group = getByRole('group', { name: /Deck view mode/ });
    const labels = Array.from(group.querySelectorAll('button')).map((b) =>
      b.getAttribute('aria-label')
    );
    expect(labels).toEqual(['Grid view', 'Stacks view', 'List view']);

    fireEvent.click(getByRole('button', { name: 'Stacks view' }));
    expect(container.querySelector('.deck-card-stack')).not.toBeNull();
    expect(readStoredViewMode()).toBe('stacks');
  });

  it('shows the card-size stepper in stacks, as in the grid', () => {
    localStorage.setItem('mtg-decks-view-mode', 'stacks');
    const { queryByRole } = renderDeck();
    expect(queryByRole('button', { name: 'Bigger cards' })).not.toBeNull();
  });
});
