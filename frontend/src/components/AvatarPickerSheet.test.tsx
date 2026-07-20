// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../lib/use-lock-body-scroll', () => ({ useLockBodyScroll: () => {} }));

interface FakeCard {
  copyId: string;
  name: string;
  scryfallId: string;
}

let collectionCards: FakeCard[] = [];
vi.mock('../store/collection', () => ({
  useCollectionStore: (selector: (s: { cards: FakeCard[] }) => unknown) =>
    selector({ cards: collectionCards }),
}));

const useSearchCardsMock = vi.fn();
vi.mock('../lib/use-search-cards', () => ({
  useSearchCards: (query: string) => useSearchCardsMock(query),
}));

// Deterministic stand-ins: imageFromCard/loadCard mirror card-thumbs.ts's real
// contract (an id-bearing object in, an art_crop URL out) without touching
// the real Scryfall client. useCardThumb resolves by name, same as every
// other name-only surface in the app.
const loadCardMock = vi.fn(async (name: string) => ({ id: `resolved-${name}`, name }));
vi.mock('../lib/card-thumbs', () => ({
  imageFromCard: (card: { id: string }) => `https://cards.scryfall.io/art_crop/${card.id}.jpg`,
  useCardThumb: (name: string | undefined) =>
    name ? `https://cards.scryfall.io/art_crop/thumb-${name}.jpg` : undefined,
  loadCard: (name: string) => loadCardMock(name),
}));

import { AvatarPickerSheet } from './AvatarPickerSheet';

function getGrid() {
  return screen.getByRole('listbox', { name: 'Avatar options' });
}

beforeEach(() => {
  collectionCards = [
    { copyId: 'c1', name: 'Forest', scryfallId: 's-forest' },
    { copyId: 'c2', name: 'Island', scryfallId: 's-island' },
    // Duplicate name (alternate printing) — first-seen copy wins the dedupe.
    { copyId: 'c3', name: 'Forest', scryfallId: 's-forest-2' },
  ];
  useSearchCardsMock.mockReset().mockReturnValue({ results: [], loading: false, error: null });
  loadCardMock.mockClear();
});

describe('AvatarPickerSheet', () => {
  it('shows the collection deduped by name in the default (empty-query) view', () => {
    render(<AvatarPickerSheet current={null} onPick={vi.fn()} onClose={vi.fn()} />);
    const options = within(getGrid()).getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(within(getGrid()).getByRole('option', { name: 'Forest' })).toBeTruthy();
    expect(within(getGrid()).getByRole('option', { name: 'Island' })).toBeTruthy();
  });

  it('caps the collection-browse grid at 300 and shows the hint line', () => {
    collectionCards = Array.from({ length: 305 }, (_, i) => ({
      copyId: `c${i}`,
      name: `Card ${String(i).padStart(3, '0')}`,
      scryfallId: `s${i}`,
    }));
    render(<AvatarPickerSheet current={null} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(within(getGrid()).getAllByRole('option')).toHaveLength(300);
    expect(screen.getByText('Showing your first 300 cards — search above for more.')).toBeTruthy();
  });

  it('shows the two-part empty state when the collection is empty', () => {
    collectionCards = [];
    render(<AvatarPickerSheet current={null} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Your collection is empty.')).toBeTruthy();
    expect(screen.getByText('Search below for any card to use as your avatar.')).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('typing a 2+ character query switches to search results', () => {
    useSearchCardsMock.mockReturnValue({
      results: [{ id: 'sc1', name: 'Searched Card' }],
      loading: false,
      error: null,
    });
    render(<AvatarPickerSheet current={null} onPick={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sear' } });
    const options = within(getGrid()).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0].getAttribute('aria-label')).toBe('Searched Card');
  });

  it('moves aria-activedescendant with Arrow keys and picks the active option on Enter', async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<AvatarPickerSheet current={null} onPick={onPick} onClose={onClose} />);
    const input = screen.getByRole('combobox');
    const options = within(getGrid()).getAllByRole('option'); // alphabetical: Forest, Island
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1].id);

    fireEvent.keyDown(input, { key: 'Enter' });
    // Resolution is async (loadCard) even though it resolves from cache —
    // flush its microtasks, mirroring AddCardsSheet.test.tsx's async-confirm
    // pattern.
    await Promise.resolve();
    await Promise.resolve();

    expect(onPick).toHaveBeenCalledWith({
      cardId: 'resolved-Island',
      cardName: 'Island',
      imageUrl: 'https://cards.scryfall.io/art_crop/resolved-Island.jpg',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('"Remove avatar" calls onPick(null) and does not open a picker round-trip', () => {
    const onPick = vi.fn();
    render(
      <AvatarPickerSheet
        current={{
          cardId: 'x',
          cardName: 'X',
          imageUrl: 'https://cards.scryfall.io/art_crop/x.jpg',
        }}
        onPick={onPick}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove avatar' }));
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it('does not render "Remove avatar" when there is no current pick', () => {
    render(<AvatarPickerSheet current={null} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Remove avatar' })).toBeNull();
  });
});
