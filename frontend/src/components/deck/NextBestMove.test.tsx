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
    navigateTo: 'tune',
  },
];

describe('NextBestMove', () => {
  it('renders each move title and detail', () => {
    render(<NextBestMove moves={moves} />);
    expect(screen.getByText('Trim 2 cards')).toBeTruthy();
    expect(screen.getByText('Add ramp')).toBeTruthy();
    expect(screen.getByText(/Light on ramp/)).toBeTruthy();
  });

  it('fires onNavigate with the move destination and focus', () => {
    const onNavigate = vi.fn();
    render(<NextBestMove moves={moves} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to Coach' }));
    expect(onNavigate).toHaveBeenCalledWith('tune', undefined);
  });

  it('passes a panel focus hint through onNavigate (combo → Power)', () => {
    const onNavigate = vi.fn();
    const comboMove: Move[] = [
      {
        id: 'combo-x',
        tier: 3,
        title: 'Complete a combo',
        detail: "You're one card from Infinite mana.",
        navigateTo: 'power',
        focus: 'combos',
      },
    ];
    render(<NextBestMove moves={comboMove} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to Power' }));
    expect(onNavigate).toHaveBeenCalledWith('power', 'combos');
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

  it('holds a placeholder slot while combos are loading', () => {
    render(<NextBestMove moves={moves} combosLoading />);
    expect(screen.getByText(/Checking for combos/)).toBeTruthy();
  });

  it('shows the combo placeholder even with no other moves yet', () => {
    render(<NextBestMove moves={[]} combosLoading />);
    expect(screen.getByText(/Checking for combos/)).toBeTruthy();
    // Not the healthy state — the check is still in flight.
    expect(screen.queryByText(/Looks dialed in/)).toBeNull();
  });

  it('drops the placeholder once a combo move is present', () => {
    const withCombo: Move[] = [
      ...moves,
      {
        id: 'combo-x',
        tier: 3,
        title: 'Complete a combo',
        detail: "You're one card from Infinite mana.",
        navigateTo: 'power',
        focus: 'combos',
      },
    ];
    render(<NextBestMove moves={withCombo} combosLoading />);
    expect(screen.queryByText(/Checking for combos/)).toBeNull();
  });

  it('omits the placeholder when the list is already full (no room)', () => {
    const three: Move[] = [1, 2, 3].map((n) => ({
      id: `m${n}`,
      tier: 2,
      title: `Move ${n}`,
      detail: 'd',
    }));
    render(<NextBestMove moves={three} combosLoading />);
    expect(screen.queryByText(/Checking for combos/)).toBeNull();
  });

  it('suppresses the navigate button when navigateTo === currentView', () => {
    const onNavigate = vi.fn();
    render(<NextBestMove moves={moves} onNavigate={onNavigate} currentView="tune" />);
    // The tune move (id=roles-ramp) should NOT show a button; the deck move should.
    expect(screen.queryByRole('button', { name: 'Go to Coach' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Go to Deck' })).toBeTruthy();
  });

  it('shows the navigate button when navigateTo differs from currentView', () => {
    const onNavigate = vi.fn();
    render(<NextBestMove moves={moves} onNavigate={onNavigate} currentView="stats" />);
    // Both deck and tune buttons should show when currentView is stats.
    expect(screen.getByRole('button', { name: 'Go to Deck' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to Coach' })).toBeTruthy();
  });

  it('cardFit detail no longer contains "Coach tab"', () => {
    const cardFitMove: Move[] = [
      {
        id: 'cardfit',
        tier: 2,
        title: 'Tighten card fit',
        detail: 'Card Fit 72. Swap low-fit cards for stronger options.',
        navigateTo: 'tune',
        focus: 'upgrade',
      },
    ];
    render(<NextBestMove moves={cardFitMove} />);
    expect(screen.queryByText(/Coach tab/)).toBeNull();
    expect(screen.getByText(/Swap low-fit cards for stronger options\./)).toBeTruthy();
  });

  it('fires onApply with the card name for a card-naming move, and omits Add otherwise', () => {
    const onApply = vi.fn();
    render(<NextBestMove moves={moves} onApply={onApply} />);
    // 'size-over' names no card → no Add; 'roles-ramp' names Cultivate → Add.
    const addBtns = screen.getAllByRole('button', { name: /^Add / });
    expect(addBtns).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Add Cultivate' }));
    expect(onApply).toHaveBeenCalledWith('Cultivate');
  });

  it('renders no Add button without onApply (navigate-only stays the default)', () => {
    render(<NextBestMove moves={moves} />);
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull();
  });

  it('disables the Add button while its card is mid-add', () => {
    const onApply = vi.fn();
    render(<NextBestMove moves={moves} onApply={onApply} busyNames={new Set(['Cultivate'])} />);
    const btn = screen.getByRole('button', { name: 'Add Cultivate' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(onApply).not.toHaveBeenCalled();
  });
});
