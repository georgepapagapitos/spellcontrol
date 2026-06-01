// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SubScoreTile } from './SubScoreTile';
import type { SubScore } from '@/deck-builder/services/deckBuilder/planScore';

const score: SubScore = {
  value: 78,
  surface: 'Wraths and spot removal keep the board honest.',
  bandLabel: 'Healthy',
};

describe('SubScoreTile', () => {
  it('maps the key to a human label and shows value, band, and surface', () => {
    render(<SubScoreTile scoreKey="cardFit" score={score} />);
    expect(screen.getByText('Card fit')).toBeTruthy();
    expect(screen.getByText('78')).toBeTruthy();
    expect(screen.getByText('Healthy')).toBeTruthy();
    expect(screen.getByText(/Wraths and spot removal/)).toBeTruthy();
  });

  it('renders an em-dash and muted class for a partial subscore', () => {
    const { container } = render(
      <SubScoreTile scoreKey="curve" score={{ ...score, partial: true }} />
    );
    expect(screen.getByText('—')).toBeTruthy();
    expect(container.querySelector('.sub-score-tile.is-partial')).toBeTruthy();
  });

  it('renders a static div when no onClick is given', () => {
    render(<SubScoreTile scoreKey="roles" score={score} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('group')).toBeTruthy();
  });

  it('renders a button and fires onClick when interactive', () => {
    const onClick = vi.fn();
    render(<SubScoreTile scoreKey="strategy" score={score} onClick={onClick} />);
    const btn = screen.getByRole('button', { name: /Strategy: 78 out of 100, Healthy/ });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('colors by band tier', () => {
    const { container, rerender } = render(
      <SubScoreTile scoreKey="strategy" score={{ ...score, value: 82 }} />
    );
    expect(container.querySelector('.sub-score-tile.is-emerald')).toBeTruthy();
    rerender(<SubScoreTile scoreKey="strategy" score={{ ...score, value: 30 }} />);
    expect(container.querySelector('.sub-score-tile.is-rose')).toBeTruthy();
  });
});
