// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommanderResultCard } from './CommanderResultCard';

// No test file existed for this component before the social W4 platform-
// deck-count badge — this covers the new prop plus a small baseline, not a
// full backfill.

vi.mock('../../lib/card-thumbs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/card-thumbs')>()),
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

  it('calls onSelect when the card is clicked', () => {
    const onSelect = vi.fn();
    render(<CommanderResultCard name="Sol Ring" colors={['C']} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
