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

function card(name: string): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `oracle-${name}`,
    name,
    mana_cost: '{1}',
    cmc: 1,
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

function slots(names: string[]): DeckDisplayCard[] {
  return names.map((name, i) => ({ slotId: `slot-${name}-${i}`, card: card(name) }));
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
        considering={slots(opts.considering ?? [])}
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

  it('the toolbar jump chip points at the zone and reports the combined count', () => {
    const { container } = renderDeck({ sideboard: ['A', 'B'], considering: ['C'] });
    const chip = container.querySelector('.deck-toolbar-outzone-chip');
    expect(chip).not.toBeNull();
    expect(chip!.getAttribute('href')).toBe('#deck-outzone');
    expect(chip!.textContent).toContain('3');
  });

  it('considering cards never reach the mainboard card-count stat (E122)', () => {
    const { container } = renderDeck({ considering: ['Considering Card'] });
    const statValue = container.querySelector('.deck-stat-value');
    // Only the one mainboard card counts — Considering stays excluded.
    expect(statValue?.textContent).toBe('1');
  });
});
