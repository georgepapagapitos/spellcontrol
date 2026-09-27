// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';
import { COLLAPSED_SECTIONS_STORAGE_KEY } from './deck-display-rows';

// Stub the thumbnail network leaf so nested DeckCardRows don't reach out
// (avoids the post-teardown fetch flake — same stub as the other DeckDisplay
// test suites).
vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

function card(name: string, cmc = 1): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `oracle-${name}`,
    name,
    mana_cost: `{${cmc}}`,
    cmc,
    type_line: 'Artifact',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'lea',
    collector_number: '1',
    set_name: 'Test Set',
    prices: { usd: '1.00' },
    legalities: {},
  } as unknown as ScryfallCard;
}

function slots(names: string[], cmc?: number): DeckDisplayCard[] {
  return names.map((name, i) => ({ slotId: `slot-${name}-${i}`, card: card(name, cmc) }));
}

function renderDeck(opts: {
  sideboard?: string[];
  considering?: string[];
  view?: 'list' | 'grid' | 'stacks';
  onMoveToMainboard?: (slotIds: string[]) => void;
  onMoveFromConsidering?: (slotIds: string[]) => void;
}) {
  localStorage.setItem('mtg-decks-view-mode', opts.view ?? 'grid');
  return render(
    <MemoryRouter>
      <DeckDisplay
        title="Test deck"
        commander={null}
        format="commander"
        cards={slots(['Mainboard Card'])}
        sideboard={slots(opts.sideboard ?? [])}
        considering={slots(opts.considering ?? [], 5)}
        onMoveToMainboard={opts.onMoveToMainboard}
        onMoveFromConsidering={opts.onMoveFromConsidering}
      />
    </MemoryRouter>
  );
}

function pileTitles(outzone: Element): string[] {
  return [...outzone.querySelectorAll('.deck-section-title')].map((t) => t.textContent ?? '');
}

describe('DeckDisplay "Not in the deck" zone (E176)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // The piles used to be rows in a tabbed panel in every view, so under a grid
  // of card art they read as another app. Each view now draws them the way it
  // draws the deck.
  it('draws both piles as tiles in grid view, like the deck above them', () => {
    const { container } = renderDeck({
      sideboard: ['Sideboard Card'],
      considering: ['Considering Card'],
      view: 'grid',
    });
    const outzone = container.querySelector('.deck-outzone')!;
    expect(outzone.querySelectorAll('.deck-grid-section')).toHaveLength(2);
    expect(outzone.querySelectorAll('.deck-card-grid-tile')).toHaveLength(2);
    expect(outzone.querySelector('.deck-row')).toBeNull();
    expect(pileTitles(outzone)).toEqual(['Sideboard (1)', 'Considering (1)']);
  });

  it('draws both piles as rows in list view', () => {
    const { container } = renderDeck({
      sideboard: ['Sideboard Card'],
      considering: ['Considering Card'],
      view: 'list',
    });
    const outzone = container.querySelector('.deck-outzone')!;
    expect(outzone.querySelectorAll('.deck-section')).toHaveLength(2);
    expect(outzone.querySelectorAll('.deck-row')).toHaveLength(2);
    expect(outzone.querySelector('.deck-card-grid-tile')).toBeNull();
    // On the deck's own column grid, one pile per column.
    expect(outzone.querySelectorAll('.deck-card-columns > .deck-card-column')).toHaveLength(2);
  });

  it('shows both piles at once, with no tab strip between them', () => {
    const { container } = renderDeck({
      sideboard: ['Sideboard Card'],
      considering: ['Considering Card'],
    });
    const outzone = container.querySelector('.deck-outzone')!;
    expect(outzone.querySelector('[role="tablist"]')).toBeNull();
    expect(outzone.textContent).toContain('Sideboard Card');
    expect(outzone.textContent).toContain('Considering Card');
  });

  it.each(['grid', 'stacks', 'list'] as const)(
    'keeps an empty pile on the page as its header and one line (%s)',
    (view) => {
      const { container } = renderDeck({ view });
      const outzone = container.querySelector('.deck-outzone')!;
      expect(pileTitles(outzone)).toEqual(['Sideboard (0)', 'Considering (0)']);
      expect(
        [...outzone.querySelectorAll('.deck-section-empty')].map((p) => p.textContent)
      ).toEqual([
        'No sideboard cards yet',
        "Nothing parked here yet. Move a card here when you're unsure about it.",
      ]);
      // An empty pile has no price to state.
      expect(outzone.querySelector('.deck-section-subtotal')).toBeNull();
    }
  );

  it('hides a pile a search empties, rather than calling it empty', () => {
    const { container, getAllByPlaceholderText } = renderDeck({
      sideboard: ['Sideboard Card'],
      considering: ['Considering Card'],
      view: 'list',
    });
    fireEvent.change(getAllByPlaceholderText('Search…')[0], { target: { value: 'Considering' } });
    const outzone = container.querySelector('.deck-outzone')!;
    expect(pileTitles(outzone)).toEqual(['Considering (1)']);
    expect(outzone.querySelector('.deck-section-empty')).toBeNull();
  });

  it('collapses a pile under every lens, and remembers it', () => {
    const { container, getByRole } = renderDeck({ sideboard: ['Sideboard Card'], view: 'list' });
    fireEvent.click(getByRole('button', { name: 'Collapse Sideboard' }));
    const rows = container.querySelector('.deck-outzone .deck-section-rows')!;
    expect(rows.hasAttribute('hidden')).toBe(true);
    expect(localStorage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY)).toContain('outzone:Sideboard');
  });

  // The grid reports a tile's row, not its pile; the menu has to find the pile
  // itself, or "Move to mainboard" on a Considering card runs the sideboard's.
  it("a tile's menu acts on the pile the card is in", () => {
    const onMoveToMainboard = vi.fn();
    const onMoveFromConsidering = vi.fn();
    const { getByRole } = renderDeck({
      sideboard: ['Sideboard Card'],
      considering: ['Considering Card'],
      view: 'grid',
      onMoveToMainboard,
      onMoveFromConsidering,
    });
    fireEvent.click(getByRole('button', { name: 'Actions for Considering Card' }));
    fireEvent.click(getByRole('menuitem', { name: 'Move to mainboard' }));
    expect(onMoveFromConsidering).toHaveBeenCalledWith(['slot-Considering Card-0']);
    expect(onMoveToMainboard).not.toHaveBeenCalled();

    fireEvent.click(getByRole('button', { name: 'Actions for Sideboard Card' }));
    fireEvent.click(getByRole('menuitem', { name: 'Move to mainboard' }));
    expect(onMoveToMainboard).toHaveBeenCalledWith(['slot-Sideboard Card-0']);
  });

  it('always mounts the zone, even at 0 sideboard and 0 considering', () => {
    const { container } = renderDeck({});
    expect(container.querySelector('.deck-outzone')).not.toBeNull();
    expect(container.querySelector('#deck-outzone')).not.toBeNull();
  });

  it('the jump target is focusable and names the zone', () => {
    const { container } = renderDeck({ sideboard: ['Sideboard Card'] });
    const target = container.querySelector('#deck-outzone');
    expect(target).not.toBeNull();
    expect(target!.getAttribute('tabindex')).toBe('-1');
    expect(target!.getAttribute('aria-label')).toBe('Not in the deck');
  });

  // The toolbar's own "Not in deck N" chip is gone (2026-09-20): it restated a
  // count the page hero already gives as "+N sideboard" / "+N considering",
  // as muted text alone on the left of a right-aligned control row. The hero's
  // counts carry the jump now; see DeckEditorPage's deck-hero-outzone-link.
  it('spends no toolbar chip on a count the page hero already gives', () => {
    const { container } = renderDeck({ sideboard: ['A', 'B'], considering: ['C'] });
    expect(container.querySelector('.deck-toolbar-outzone-chip')).toBeNull();
    expect(container.querySelector('.deck-toolbar-summary')).toBeNull();
    // The zone it pointed at is untouched and still the anchor target.
    expect(container.querySelector('#deck-outzone')).not.toBeNull();
  });

  it('considering cards never reach the mainboard stats (E122)', () => {
    const { container } = renderDeck({ considering: ['Considering Card'] });
    // Mainboard is one 1-drop; the 5-drop in Considering must not move the
    // strip's avg mana value (the card count rides the page hero).
    const avg = [...container.querySelectorAll('.deck-stat')].find((el) =>
      el.textContent?.includes('avg mana value')
    );
    expect(avg?.querySelector('.deck-stat-value')?.textContent).toBe('1.00');
  });
});
