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
import { packStacks, stackLayout } from './DeckCardGrid';
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
    // No list rows — this is a card-forward view. (The card inspector is a
    // separate, width-gated surface; this viewport is below its gate.)
    expect(container.querySelector('.deck-row')).toBeNull();
    expect(container.querySelector('.deck-card-inspector')).toBeNull();
  });

  it('carries no collapse chevron — a stack is already its own collapse', () => {
    localStorage.setItem('mtg-decks-view-mode', 'stacks');
    const { container } = renderDeck();
    expect(container.querySelectorAll('.deck-grid-section--stack').length).toBeGreaterThan(0);
    expect(
      container.querySelector('.deck-grid-section--stack .deck-section-collapse'),
      'the column shows one strip per card and opens one at a time; a chevron that hides the whole column is a second control in a header trying to be a label'
    ).toBeNull();
    // And a section collapsed in the grid must not arrive here as an empty
    // column with no way to open it.
    expect(container.querySelector('.deck-card-stack[hidden]')).toBeNull();
  });

  it('drops the type glyph from a stack header, keeping the words', () => {
    localStorage.setItem('mtg-decks-view-mode', 'stacks');
    const { container } = renderDeck();
    expect(container.querySelectorAll('.deck-grid-section--stack').length).toBeGreaterThan(0);
    expect(
      container.querySelector('.deck-grid-section--stack .deck-section-icon'),
      'the column is already a wall of card art; the header above it reads as words alone'
    ).toBeNull();
    expect(
      container.querySelector('.deck-grid-section--stack .deck-section-title')?.textContent
    ).toContain('Creature');
  });

  it('shows the out-zone as ONE stack, not a stack per type', () => {
    localStorage.setItem('mtg-decks-view-mode', 'stacks');
    const { container } = render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={null}
          format="commander"
          cards={DECK}
          considering={[
            { slotId: 'c1', card: card('Sol Ring', 'Artifact') },
            { slotId: 'c2', card: card('Counterspell', 'Instant') },
          ]}
        />
      </MemoryRouter>
    );
    const zone = container.querySelector('.deck-outzone-body')!;
    // A holding pile of a handful of cards: one column, and no header over it
    // (the tab directly above already names the pile).
    expect(zone.querySelectorAll('.deck-card-stack')).toHaveLength(1);
    expect(zone.querySelectorAll('.deck-card-grid-tile')).toHaveLength(2);
    expect(zone.querySelector('.deck-section-header')).toBeNull();
    expect(zone.querySelector('.deck-row')).toBeNull();
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

// Packing is pure and computed from the stack width, so it is checked here
// rather than through a render: happy-dom reports a 0px container, which is
// the unmeasured case the component deliberately falls back to a flat row for.
describe('packStacks', () => {
  const g = (title: string, n: number) => ({ title, rows: new Array(n).fill(0) });

  it('fills the shortest column, so a tall stack never holds a row hostage', () => {
    // The flex-wrap bug: Creature (28) made its whole row 28 cards tall, and
    // Sorcery/Land landed below all of it. Here they sit beside it.
    const packed = packStacks([g('Commander', 1), g('Creature', 28), g('Sorcery', 2)], 2, 210);
    expect(packed.map((c) => c.map((s) => s.title))).toEqual([
      ['Commander', 'Sorcery'],
      ['Creature'],
    ]);
  });

  it('keeps every group exactly once, and drops the columns it did not need', () => {
    const groups = [g('a', 3), g('b', 3), g('c', 3)];
    const packed = packStacks(groups, 8, 210);
    expect(packed.flat()).toHaveLength(3);
    expect(packed).toHaveLength(3);
  });

  it('never renders zero columns', () => {
    expect(packStacks([g('a', 1)], 0, 210)).toEqual([[g('a', 1)]]);
  });
});

describe('stackLayout', () => {
  it('gives a phone one stack, as wide as the screen', () => {
    // Two 154px columns put four cards on the first screen and made every
    // name strip a squint.
    const { phone, columns, stackW } = stackLayout(390, 374, 1);
    expect(phone).toBe(true);
    expect(columns).toBe(1);
    expect(stackW).toBe(374 - 27);
  });

  it('keeps the size stepper in charge on anything wider', () => {
    const narrow = stackLayout(900, 860, 1).stackW;
    const wide = stackLayout(1440, 1400, 1).stackW;
    expect(narrow).toBe(154); // the mobile ladder, at the default step
    expect(wide).toBe(210); // the desktop ladder
    expect(stackLayout(1440, 1400, 4).stackW).toBeGreaterThan(wide); // + is still +
  });

  it('fits as many columns as the CONTAINER holds, never the viewport', () => {
    // A 1400px container of 210px stacks: 237px a column including its chrome,
    // 16px between them.
    expect(stackLayout(1440, 1400, 1).columns).toBe(5);
    expect(stackLayout(1440, 700, 1).columns).toBe(2);
    expect(stackLayout(1440, 0, 1).columns).toBe(1);
  });
});
