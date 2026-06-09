// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DeckTokensSheet } from './DeckTokensSheet';
import type { DeckToken } from '@/lib/deck-tokens';

const GOBLINS: DeckToken = {
  name: 'Goblin',
  typeLine: 'Token Creature — Goblin',
  producers: ['Goblin Rabblemaster', 'Krenko, Mob Boss'],
};
const TREASURE: DeckToken = {
  name: 'Treasure',
  typeLine: 'Token Artifact — Treasure',
  producers: ['Dockside Extortionist'],
};

describe('DeckTokensSheet', () => {
  it('lists tokens as name + count chips, count in the subtitle', () => {
    render(<DeckTokensSheet tokens={[GOBLINS, TREASURE]} onClose={() => {}} />);
    expect(screen.getByText('Goblin')).toBeTruthy();
    expect(screen.getByText('×2')).toBeTruthy();
    expect(screen.getByText('Treasure')).toBeTruthy();
    expect(screen.getByText(/2 tokens/)).toBeTruthy();
    // Producers hidden until a chip is opened.
    expect(screen.queryByText(/Goblin Rabblemaster/)).toBeNull();
  });

  it('reveals the cleaned type + producers when a chip is tapped, and toggles off', () => {
    render(<DeckTokensSheet tokens={[GOBLINS]} onClose={() => {}} />);
    const chip = screen.getByRole('button', { name: /Goblin/ });
    fireEvent.click(chip);
    expect(screen.getByText('Creature — Goblin')).toBeTruthy();
    expect(screen.getByText(/Goblin Rabblemaster · Krenko, Mob Boss/)).toBeTruthy();
    fireEvent.click(chip);
    expect(screen.queryByText(/Goblin Rabblemaster/)).toBeNull();
  });

  it('closes from the ✕ button', () => {
    const onClose = vi.fn();
    render(<DeckTokensSheet tokens={[GOBLINS]} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows an empty state for a token-less deck', () => {
    render(<DeckTokensSheet tokens={[]} onClose={() => {}} />);
    expect(screen.getByText(/makes no tokens/)).toBeTruthy();
  });
});
