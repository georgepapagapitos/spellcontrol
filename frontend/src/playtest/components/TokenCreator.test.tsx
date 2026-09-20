// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DeckToken } from '@/lib/deck-tokens';
import type { TokenOption } from '@/deck-builder/services/scryfall/client';
import { TokenCreator } from './TokenCreator';

const deckTokens = vi.hoisted(() => ({ current: [] as DeckToken[] }));
const searchTokens = vi.hoisted(() => vi.fn());
const resolveTokenOption = vi.hoisted(() => vi.fn());

vi.mock('@/components/deck/use-deck-tokens', () => ({
  useDeckTokens: () => deckTokens.current,
}));

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  searchTokens,
  resolveTokenOption,
}));

vi.mock('@/lib/use-lock-body-scroll', () => ({ useLockBodyScroll: () => {} }));

function open(onCreate = vi.fn()) {
  render(<TokenCreator deckCards={[]} onCreate={onCreate} onClose={vi.fn()} />);
  return onCreate;
}

beforeEach(() => {
  deckTokens.current = [];
  searchTokens.mockReset().mockResolvedValue([]);
  resolveTokenOption.mockReset().mockResolvedValue(null);
});

describe('TokenCreator', () => {
  it('opens on the deck’s own tokens, because that is what people make', async () => {
    deckTokens.current = [
      { name: 'Treasure', typeLine: 'Token Artifact — Treasure', producers: ['Dockside'] },
      { name: 'Bird', typeLine: 'Token Creature — Bird', producers: ['Kindred Discovery'] },
    ];
    open();
    expect(screen.getByText('Deck tokens')).toBeTruthy();
    expect(screen.getByText('Treasure')).toBeTruthy();
    expect(screen.getByText('Bird')).toBeTruthy();
    // No search fires until somebody types.
    await waitFor(() => expect(searchTokens).not.toHaveBeenCalled());
  });

  it('creates the token a deck tile names, with its type line', () => {
    deckTokens.current = [
      { name: 'Bird', typeLine: 'Token Creature — Bird', producers: ['Kindred Discovery'] },
    ];
    const onCreate = open();
    fireEvent.click(screen.getByRole('button', { name: /Bird/ }));
    expect(onCreate).toHaveBeenCalledWith({ name: 'Bird', typeLine: 'Token Creature — Bird' });
  });

  // Art is the enhancement; the pick works before (and without) it.
  it('renders a deck tile before its face resolves, then swaps the art in', async () => {
    deckTokens.current = [{ name: 'Treasure', producers: ['Dockside'] }];
    const face: TokenOption = {
      id: 'o1',
      name: 'Treasure',
      typeLine: 'Token Artifact — Treasure',
      imageUrl: 'https://img/treasure.jpg',
    };
    let release: (v: TokenOption) => void = () => {};
    resolveTokenOption.mockReturnValue(
      new Promise<TokenOption>((r) => {
        release = r;
      })
    );
    const { container } = render(
      <TokenCreator deckCards={[]} onCreate={vi.fn()} onClose={vi.fn()} />
    );
    // The tile is pickable before any art exists.
    expect(screen.getByRole('button', { name: /Treasure/ })).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    release(face);
    // The art is decorative (`alt=""`), so it has no img ROLE to query by.
    await waitFor(() =>
      expect(container.querySelector('img')?.getAttribute('src')).toBe('https://img/treasure.jpg')
    );
  });

  it('searches for everything else once you type', async () => {
    searchTokens.mockResolvedValue([
      { id: 'o9', name: 'Goblin', typeLine: 'Token Creature — Goblin', imageUrl: 'g.jpg' },
    ] satisfies TokenOption[]);
    const onCreate = open();
    fireEvent.change(screen.getByLabelText('Search for a token by name'), {
      target: { value: 'goblin' },
    });
    await waitFor(() => expect(screen.getByText('Search results')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Goblin')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Goblin/ }));
    expect(onCreate).toHaveBeenCalledWith({
      name: 'Goblin',
      typeLine: 'Token Creature — Goblin',
      imageUrl: 'g.jpg',
    });
  });

  // The floor this picker must never drop below: no network, no deck, no
  // match, and a name you typed still makes a token.
  it('creates whatever you typed even when the search found nothing', async () => {
    searchTokens.mockResolvedValue([]);
    const onCreate = open();
    fireEvent.change(screen.getByLabelText('Search for a token by name'), {
      target: { value: 'Grizzly 4/4' },
    });
    await waitFor(() => expect(screen.getByText(/No token called/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Create/ }));
    expect(onCreate).toHaveBeenCalledWith({ name: 'Grizzly 4/4' });
  });

  it('Enter submits the typed name without waiting for a search', () => {
    const onCreate = open();
    const input = screen.getByLabelText('Search for a token by name');
    fireEvent.change(input, { target: { value: 'Soldier 1/1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCreate).toHaveBeenCalledWith({ name: 'Soldier 1/1' });
  });

  it('says so when the deck makes no tokens at all', () => {
    open();
    expect(screen.getByText('This deck makes no tokens.')).toBeTruthy();
  });
});
