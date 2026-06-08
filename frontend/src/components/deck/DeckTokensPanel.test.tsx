// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeckTokensPanel } from './DeckTokensPanel';
import type { DeckToken } from '@/lib/deck-tokens';

const GOBLINS: DeckToken = {
  name: 'Goblin',
  typeLine: 'Token Creature — Goblin',
  producers: ['Goblin Rabblemaster', 'Krenko, Mob Boss'],
};

describe('DeckTokensPanel', () => {
  it('renders nothing when there are no tokens', () => {
    const { container } = render(<DeckTokensPanel tokens={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the token name, cleaned type, producer count and producers', () => {
    render(<DeckTokensPanel tokens={[GOBLINS]} />);
    expect(screen.getByText('Goblin')).toBeTruthy();
    // "Token " prefix stripped for display.
    expect(screen.getByText('Creature — Goblin')).toBeTruthy();
    expect(screen.getByText('2×')).toBeTruthy();
    expect(screen.getByText('Goblin Rabblemaster · Krenko, Mob Boss')).toBeTruthy();
    expect(screen.getByText('1 token')).toBeTruthy();
  });

  it('pluralizes the token total', () => {
    render(
      <DeckTokensPanel
        tokens={[
          GOBLINS,
          { name: 'Treasure', typeLine: 'Token Artifact — Treasure', producers: ['Dockside'] },
        ]}
      />
    );
    expect(screen.getByText('2 tokens')).toBeTruthy();
  });

  it('omits the kind line when a token has no type line', () => {
    render(<DeckTokensPanel tokens={[{ name: 'Clue', producers: ['Tireless Tracker'] }]} />);
    expect(screen.getByText('Clue')).toBeTruthy();
    expect(screen.queryByText('Creature — Goblin')).toBeNull();
  });
});
