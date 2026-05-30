// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NextBestMove } from './NextBestMove';
import type { NextBestMove as Move } from '@/deck-builder/services/deckBuilder/nextBestMove';

const moves: Move[] = [
  {
    id: 'size-over',
    tier: 1,
    title: 'Trim 2 cards',
    detail: 'Your deck has 101 cards, 2 over the 99-card target.',
    navigateTo: 'deck',
  },
  {
    id: 'roles-ramp',
    tier: 2,
    title: 'Add ramp',
    detail: 'Light on ramp (2 of 10). Add Cultivate.',
    cardName: 'Cultivate',
    navigateTo: 'improve',
  },
];

describe('NextBestMove', () => {
  it('renders each move title and detail', () => {
    render(<NextBestMove moves={moves} />);
    expect(screen.getByText('Trim 2 cards')).toBeTruthy();
    expect(screen.getByText('Add ramp')).toBeTruthy();
    expect(screen.getByText(/Light on ramp/)).toBeTruthy();
  });

  it('fires onNavigate with the move destination', () => {
    const onNavigate = vi.fn();
    render(<NextBestMove moves={moves} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to Improve' }));
    expect(onNavigate).toHaveBeenCalledWith('improve');
  });

  it('renders no navigate button when onNavigate is absent', () => {
    render(<NextBestMove moves={moves} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('caps the list at 3 rows', () => {
    const many: Move[] = [1, 2, 3, 4].map((n) => ({
      id: `m${n}`,
      tier: 2,
      title: `Move ${n}`,
      detail: 'd',
    }));
    render(<NextBestMove moves={many} />);
    expect(screen.queryByText('Move 4')).toBeNull();
    expect(screen.getByText('Move 3')).toBeTruthy();
  });

  it('renders the healthy state when there are no moves', () => {
    render(<NextBestMove moves={[]} />);
    expect(screen.getByText(/Looks dialed in/)).toBeTruthy();
  });
});
