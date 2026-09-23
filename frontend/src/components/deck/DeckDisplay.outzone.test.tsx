// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';

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
  view?: 'list' | 'grid';
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
      />
    </MemoryRouter>
  );
}

describe('DeckDisplay "Not in the deck" zone (E176)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders sideboard + considering rows in grid view (the hoisted defect)', () => {
    const { container } = renderDeck({
      sideboard: ['Sideboard Card'],
      considering: ['Considering Card'],
      view: 'grid',
    });

    // The zone exists and holds a compact row list, not thumbnail tiles.
    const outzone = container.querySelector('.deck-outzone');
    expect(outzone).not.toBeNull();
    expect(outzone!.querySelector('.deck-card-grid-tile')).toBeNull();
    expect(outzone!.textContent).toContain('Sideboard Card');
  });

  it('switches between Sideboard and Considering via the segmented tabs', () => {
    const { container, getByRole } = renderDeck({
      sideboard: ['Sideboard Card'],
      considering: ['Considering Card'],
    });
    const outzone = container.querySelector('.deck-outzone')!;

    expect(outzone.textContent).toContain('Sideboard Card');
    expect(outzone.textContent).not.toContain('Considering Card');

    fireEvent.click(getByRole('tab', { name: /Considering/ }));

    expect(outzone.textContent).not.toContain('Sideboard Card');
    expect(outzone.textContent).toContain('Considering Card');
  });

  it('always mounts the zone, even at 0 sideboard and 0 considering', () => {
    const { container } = renderDeck({});
    expect(container.querySelector('.deck-outzone')).not.toBeNull();
    expect(container.querySelector('#deck-outzone')).not.toBeNull();
  });

  it('the jump-target heading carries id + tabIndex=-1 on the SAME element', () => {
    const { container } = renderDeck({ sideboard: ['Sideboard Card'] });
    const target = container.querySelector('#deck-outzone');
    expect(target).not.toBeNull();
    expect(target!.tagName).toBe('H3');
    expect(target!.getAttribute('tabindex')).toBe('-1');
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
