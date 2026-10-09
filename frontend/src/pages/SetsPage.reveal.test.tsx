// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SetsPage } from './SetsPage';
import { useCollectionStore } from '../store/collection';
import { useAuth } from '../store/auth';
import type { EnrichedCard } from '../types';

function bolt(n: number): EnrichedCard {
  return {
    copyId: `c${n}`,
    scryfallId: `s${n}`,
    oracleId: `o${n}`,
    name: `Bolt ${String(n).padStart(2, '0')}`,
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: String(n),
    rarity: 'uncommon',
    purchasePrice: 1,
    finish: 'nonfoil',
  } as unknown as EnrichedCard;
}

beforeEach(() => {
  useAuth.setState({ status: 'guest' });
  useCollectionStore.setState({
    hydrating: false,
    cards: Array.from({ length: 14 }, (_, i) => bolt(i + 1)),
  });
});
afterEach(cleanup);

function renderSets() {
  render(
    <MemoryRouter>
      <SetsPage />
    </MemoryRouter>
  );
  fireEvent.change(screen.getByLabelText(/Filter sets by name or code/), {
    target: { value: 'bolt' },
  });
}

const groups = () => document.querySelectorAll('.sets-card-group').length;

describe('SetsPage card matches reveal', () => {
  it('reveals six at a time with a count line, then hands focus to it', () => {
    renderSets();
    expect(groups()).toBe(6);
    expect(screen.getByText('Showing 6 of 14 cards.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show 6 more' }));
    expect(groups()).toBe(12);
    expect(screen.getByText('Showing 12 of 14 cards.')).toBeTruthy();

    const last = screen.getByRole('button', { name: 'Show 2 more' });
    act(() => last.focus());
    expect(document.activeElement).toBe(last);
    fireEvent.click(last);

    expect(groups()).toBe(14);
    expect(screen.queryByRole('button', { name: /Show .* more/ })).toBeNull();
    const line = screen.getByText('Showing all 14 cards.');
    expect(line.getAttribute('tabindex')).toBe('-1');
    expect(line.getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(line);
  });
});
