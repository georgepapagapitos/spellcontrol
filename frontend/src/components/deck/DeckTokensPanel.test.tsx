// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DeckTokensPanel } from './DeckTokensPanel';
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

afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('DeckTokensPanel', () => {
  it('renders nothing when there are no tokens', () => {
    const { container } = render(<DeckTokensPanel tokens={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows compact name + count chips by default, without producer detail', () => {
    render(<DeckTokensPanel tokens={[GOBLINS, TREASURE]} />);
    expect(screen.getByText('Goblin')).toBeTruthy();
    expect(screen.getByText('×2')).toBeTruthy();
    expect(screen.getByText('Treasure')).toBeTruthy();
    expect(screen.getByText('×1')).toBeTruthy();
    // Count in the header, producers hidden until a chip is opened.
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryByText(/Goblin Rabblemaster/)).toBeNull();
  });

  it('reveals the type + producers when a chip is tapped, and hides them again', () => {
    render(<DeckTokensPanel tokens={[GOBLINS]} />);
    const chip = screen.getByRole('button', { name: /Goblin/ });
    fireEvent.click(chip);
    expect(screen.getByText('Creature — Goblin')).toBeTruthy(); // "Token " stripped
    expect(screen.getByText(/Goblin Rabblemaster · Krenko, Mob Boss/)).toBeTruthy();
    fireEvent.click(chip);
    expect(screen.queryByText(/Goblin Rabblemaster/)).toBeNull();
  });

  it('collapses and expands the whole panel from the header (persisted)', () => {
    render(<DeckTokensPanel tokens={[GOBLINS]} />);
    const header = screen.getByRole('button', { name: /Tokens to prep/ });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    // Body (chips) gone while collapsed.
    expect(screen.queryByText('Goblin')).toBeNull();
    expect(window.localStorage.getItem('spellcontrol-deck-tokens-collapsed')).toBe('1');
  });

  it('respects a persisted collapsed preference on mount', () => {
    window.localStorage.setItem('spellcontrol-deck-tokens-collapsed', '1');
    render(<DeckTokensPanel tokens={[GOBLINS]} />);
    expect(
      screen.getByRole('button', { name: /Tokens to prep/ }).getAttribute('aria-expanded')
    ).toBe('false');
    expect(screen.queryByText('Goblin')).toBeNull();
  });
});
