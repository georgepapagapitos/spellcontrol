// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  // List is the default view mode, but pin it explicitly so the populated-deck
  // assertions on `.deck-card-list` don't depend on that default.
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

  // E465: a commander deck is no longer blocked on its commander. The old
  // branch's one button ("Choose a commander") called onAddCards, which the
  // editor answered with an interstitial whose button led back here.
  it('offers Add cards first and Choose a commander beside it for a commander deck with none', () => {
    const onAddCards = vi.fn();
    const onChooseCommander = vi.fn();
    const { container, getByRole } = render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={null}
          format="commander"
          cards={[]}
          onAddCards={onAddCards}
          onChooseCommander={onChooseCommander}
        />
      </MemoryRouter>
    );
    const empty = container.querySelector('.deck-empty-state');
    expect(empty!.textContent).toContain('This deck is empty.');
    expect(empty!.textContent).toContain('Add cards, or choose a commander first.');
    // Add cards stays the one primary; choosing the commander is secondary.
    expect(getByRole('button', { name: 'Add cards' }).className).toContain('btn-primary');
    const choose = getByRole('button', { name: 'Choose a commander' });
    expect(choose.className).not.toContain('btn-primary');

    choose.click();
    expect(onChooseCommander).toHaveBeenCalledTimes(1);
    expect(onAddCards).not.toHaveBeenCalled();

    getByRole('button', { name: 'Add cards' }).click();
    expect(onAddCards).toHaveBeenCalledTimes(1);
    expect(onChooseCommander).toHaveBeenCalledTimes(1);
  });

  it('does not mention a commander when the host has no way to choose one', () => {
    const { container, queryByRole } = render(
      <MemoryRouter>
        <DeckDisplay title="Test deck" commander={null} format="commander" cards={[]} />
      </MemoryRouter>
    );
    expect(container.querySelector('.deck-empty-state')!.textContent).not.toMatch(/commander/i);
    expect(queryByRole('button', { name: 'Choose a commander' })).toBeNull();
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

describe('DeckDisplay command zone open slot (E465)', () => {
  afterEach(() => localStorage.removeItem('mtg-decks-view-mode'));

  function renderDeck(
    viewMode: 'list' | 'grid' | 'stacks',
    props: Partial<Parameters<typeof DeckDisplay>[0]> = {}
  ) {
    localStorage.setItem('mtg-decks-view-mode', viewMode);
    return render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={null}
          format="commander"
          cards={slots(['Sol Ring', 'Goblin Chieftain'])}
          {...props}
        />
      </MemoryRouter>
    );
  }

  it.each(['list', 'grid', 'stacks'] as const)(
    'shows the open slot in %s view, and its Choose button opens the picker',
    (viewMode) => {
      const onChooseCommander = vi.fn();
      const onAddCards = vi.fn();
      const { container, getByRole } = renderDeck(viewMode, { onChooseCommander, onAddCards });
      // Proves the view mode took: only the list view renders `.deck-card-list`.
      expect(!!container.querySelector('.deck-card-list')).toBe(viewMode === 'list');
      const slot = container.querySelector('.commander-open-slot');
      expect(slot?.textContent).toContain('No commander yet');
      getByRole('button', { name: 'Choose a commander' }).click();
      expect(onChooseCommander).toHaveBeenCalledTimes(1);
      expect(onAddCards).not.toHaveBeenCalled();
    }
  );

  it('sits in the list where the commander will appear, above the type columns', () => {
    const { container } = renderDeck('list', { onChooseCommander: vi.fn() });
    const list = container.querySelector('.deck-card-list')!;
    expect(list.firstElementChild?.classList.contains('commander-open-slot')).toBe(true);
  });

  it('is gone once a commander is seated', () => {
    const { container } = renderDeck('list', {
      commander: card('Krenko, Tin Street Kingpin'),
      onChooseCommander: vi.fn(),
    });
    expect(container.querySelector('.commander-open-slot')).toBeNull();
  });

  it('never shows in a format without a command zone', () => {
    const { container } = renderDeck('list', {
      format: 'modern',
      onChooseCommander: vi.fn(),
    });
    expect(container.querySelector('.commander-open-slot')).toBeNull();
  });
});
