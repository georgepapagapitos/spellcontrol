// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
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

describe('DeckDisplay empty state (E182)', () => {
  // Default view mode is 'grid' (no persisted choice); pin to 'list' so the
  // populated-deck assertions can check `.deck-card-list` directly rather
  // than the grid's own markup.
  beforeEach(() => localStorage.setItem('mtg-decks-view-mode', 'list'));

  it('renders the empty state for a brand-new manual deck (no commander, no cards)', () => {
    const { container } = render(
      <MemoryRouter>
        <DeckDisplay title="Test deck" commander={null} format="standard" cards={[]} />
      </MemoryRouter>
    );
    const empty = container.querySelector('.deck-empty-state');
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toContain('This deck is empty.');
    expect(container.querySelector('.deck-card-list')).toBeNull();
  });

  it('shows commander-specific copy for a Commander-format deck with no commander yet', () => {
    const { container } = render(
      <MemoryRouter>
        <DeckDisplay title="Test deck" commander={null} format="commander" cards={[]} />
      </MemoryRouter>
    );
    const empty = container.querySelector('.deck-empty-state');
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toContain('This deck needs a commander first.');
  });

  it('calls onAddCards when the CTA is clicked', () => {
    const onAddCards = vi.fn();
    const { getByRole } = render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={null}
          format="standard"
          cards={[]}
          onAddCards={onAddCards}
        />
      </MemoryRouter>
    );
    getByRole('button', { name: 'Add cards' }).click();
    expect(onAddCards).toHaveBeenCalledTimes(1);
  });

  it('does NOT render the empty state once the deck has cards', () => {
    const { container } = render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={null}
          format="standard"
          cards={slots(['Ornithopter'])}
        />
      </MemoryRouter>
    );
    expect(container.querySelector('.deck-empty-state')).toBeNull();
    expect(container.querySelector('.deck-card-list')).not.toBeNull();
  });

  it('does NOT render the empty state when a commander is set, even with 0 other cards', () => {
    const { container } = render(
      <MemoryRouter>
        <DeckDisplay title="Test deck" commander={card('Atraxa')} format="commander" cards={[]} />
      </MemoryRouter>
    );
    expect(container.querySelector('.deck-empty-state')).toBeNull();
    expect(container.querySelector('.deck-card-list')?.textContent).toContain('Atraxa');
  });
});
