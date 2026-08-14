// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ArrivalRow } from '@/lib/new-arrivals';
import type { ChangeOwnership } from '@/lib/deck-change';
import { NewArrivalsSheet } from './NewArrivalsSheet';

vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => null }));

const rows: ArrivalRow[] = [
  { name: 'Free Copy', card: { name: 'Free Copy' }, qty: 1, score: 1 },
  { name: 'Claimed Elsewhere', card: { name: 'Claimed Elsewhere' }, qty: 1, score: 0.9 },
  { name: 'In A Cube', card: { name: 'In A Cube' }, qty: 1, score: 0.8 },
];

function renderSheet(ownershipFor?: (name: string) => ChangeOwnership) {
  return render(
    <NewArrivalsSheet
      bucket="Creature"
      rows={rows}
      onClose={() => {}}
      onMarkReviewed={() => {}}
      ownershipFor={ownershipFor}
    />
  );
}

describe('NewArrivalsSheet ownership badges', () => {
  it('badges each row with the Suggestions-tab tri-state', () => {
    const ownership: Record<string, ChangeOwnership> = {
      'Free Copy': 'owned',
      'Claimed Elsewhere': 'in-other-deck',
      'In A Cube': 'in-cube',
    };
    renderSheet((name) => ownership[name]);

    expect(screen.getByText('Available')).toBeTruthy();
    expect(screen.getByText('In a deck')).toBeTruthy();
    expect(screen.getByText('In a cube')).toBeTruthy();
  });

  it('renders no badge at all when ownership is not supplied', () => {
    renderSheet(undefined);

    expect(screen.queryByText('Available')).toBeNull();
    expect(screen.queryByText('In a deck')).toBeNull();
  });

  // Every arrival is a card you own, so an 'unowned' verdict means the ownership
  // map disagrees with the arrivals input — show no claim rather than a false one.
  it('suppresses the unowned badge', () => {
    renderSheet(() => 'unowned');

    expect(screen.queryByText('Unowned')).toBeNull();
  });
});
