// @vitest-environment happy-dom
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { PriceRefreshIndicator } from './PriceRefreshIndicator';
import { useCollectionStore } from '../store/collection';

beforeEach(() => {
  useCollectionStore.setState({ priceRefreshProgress: null });
});

describe('PriceRefreshIndicator', () => {
  it('renders nothing when no refresh is running', () => {
    const { container } = render(<PriceRefreshIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a counted pill with a spinner during a multi-chunk refresh', () => {
    useCollectionStore.setState({ priceRefreshProgress: { done: 3, total: 12 } });
    const { container } = render(<PriceRefreshIndicator />);
    expect(screen.getByText(/Refreshing prices \(3\/12\)/)).toBeTruthy();
    expect(container.querySelector('.sync-indicator-spinner')).toBeTruthy();
    // Announced to assistive tech without stealing focus.
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('omits the count for a single-chunk refresh', () => {
    useCollectionStore.setState({ priceRefreshProgress: { done: 1, total: 1 } });
    render(<PriceRefreshIndicator />);
    const el = screen.getByText(/Refreshing prices/);
    expect(el.textContent).not.toMatch(/\(/); // total === 1 → no "(1/1)"
  });

  it('reacts to store updates (appears, advances, then disappears)', () => {
    const { container } = render(<PriceRefreshIndicator />);
    expect(container.firstChild).toBeNull();

    act(() => useCollectionStore.setState({ priceRefreshProgress: { done: 1, total: 4 } }));
    expect(screen.getByText(/Refreshing prices \(1\/4\)/)).toBeTruthy();

    act(() => useCollectionStore.setState({ priceRefreshProgress: { done: 4, total: 4 } }));
    expect(screen.getByText(/Refreshing prices \(4\/4\)/)).toBeTruthy();

    act(() => useCollectionStore.setState({ priceRefreshProgress: null }));
    expect(container.firstChild).toBeNull();
  });
});
