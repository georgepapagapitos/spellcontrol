// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommanderResultCard } from './CommanderResultCard';

// No test file existed for this component before the social W4 platform-
// deck-count badge — this covers the new prop plus a small baseline, not a
// full backfill.

vi.mock('@/lib/cards/card-thumbs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cards/card-thumbs')>()),
  useCardThumb: () => undefined,
}));

describe('CommanderResultCard', () => {
  it('renders exactly as before when platformDeckCount is undefined (every existing call site)', () => {
    const { container } = render(
      <CommanderResultCard name="Sol Ring" colors={['C']} onSelect={vi.fn()} />
    );
    expect(container.querySelector('.commander-result-platform-count')).toBeNull();
    expect(screen.getByText('Sol Ring')).toBeTruthy();
  });

  it('renders the platform-count badge with exact copy when defined', () => {
    render(
      <CommanderResultCard
        name="Atraxa, Praetors' Voice"
        colors={['W', 'U', 'B', 'G']}
        onSelect={vi.fn()}
        platformDeckCount={156}
      />
    );
    expect(screen.getByText('156 on SpellControl')).toBeTruthy();
  });

  it('formats a large platform count with a thousands separator', () => {
    render(
      <CommanderResultCard
        name="Krenko"
        colors={['R']}
        onSelect={vi.fn()}
        platformDeckCount={1200}
      />
    );
    expect(screen.getByText('1,200 on SpellControl')).toBeTruthy();
  });

  it('says the colors are unavailable, never Colorless, when the identity is unknown', () => {
    const { container } = render(
      <CommanderResultCard name="Atraxa" colors={[]} colorsUnknown onSelect={vi.fn()} />
    );
    expect(screen.getByText('Colors unavailable')).toBeTruthy();
    expect(screen.queryByText('Colorless')).toBeNull();
    expect(container.querySelector('.commander-result-pips')).toBeNull();
  });

  it('still says Colorless for a real colorless commander', () => {
    render(
      <CommanderResultCard name="Karn" colors={['C']} comboName="Colorless" onSelect={vi.fn()} />
    );
    expect(screen.getByText('Colorless')).toBeTruthy();
    expect(screen.queryByText('Colors unavailable')).toBeNull();
  });

  it('calls onSelect when the card is clicked', () => {
    const onSelect = vi.fn();
    render(<CommanderResultCard name="Sol Ring" colors={['C']} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  describe('completion notes under the coverage bar', () => {
    const score = {
      available: true,
      ownedCount: 61,
      totalCount: 99,
      percent: 62,
      weightedPercent: 70,
      explainerLine: '61 of 99 staples owned',
      ownedSamples: [],
    };

    it('shows the count, the cost to finish, what a deck holds and the sample', () => {
      render(
        <CommanderResultCard
          name="Atraxa, Praetors' Voice"
          colors={['W', 'U', 'B', 'G']}
          readiness={score}
          coverageBar
          completion={{
            cost: '~$48 to finish',
            held: '3 you own are in your Atraxa deck',
            basis: 'Bracket 2 · 3,183 decks',
          }}
          onSelect={vi.fn()}
        />
      );
      expect(screen.getByText('You own 61 of its 99 staples')).toBeTruthy();
      expect(screen.getByText('~$48 to finish')).toBeTruthy();
      expect(screen.getByText('3 you own are in your Atraxa deck')).toBeTruthy();
      expect(screen.getByText('Bracket 2 · 3,183 decks')).toBeTruthy();
    });

    it('says Pricing while the prices load, and omits empty notes', () => {
      render(
        <CommanderResultCard
          name="Atraxa"
          colors={['W']}
          readiness={score}
          coverageBar
          completion={{ cost: null, held: null, basis: null }}
          onSelect={vi.fn()}
        />
      );
      expect(screen.getByText('Pricing…')).toBeTruthy();
      expect(screen.queryByText(/Bracket/)).toBeNull();
    });
  });
});
