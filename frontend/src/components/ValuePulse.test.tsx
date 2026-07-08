// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { clearValueHistory, recordValueSnapshot } from '../lib/value-history';
import { ValuePulse } from './ValuePulse';

const daysAgo = (n: number) => Date.now() - n * 86400000;

afterEach(async () => {
  await clearValueHistory();
});

describe('ValuePulse', () => {
  it('renders nothing with fewer than two logged days', async () => {
    await recordValueSnapshot(120, daysAgo(0));
    const { container } = render(<ValuePulse refreshing={false} />);
    // Give the async history read a beat, then assert it stayed empty.
    await new Promise((r) => setTimeout(r, 20));
    expect(container.firstChild).toBeNull();
  });

  it('shows a signed weekly delta and the sparkline once history exists', async () => {
    await recordValueSnapshot(100, daysAgo(7));
    await recordValueSnapshot(118.4, daysAgo(0));
    const { container } = render(<ValuePulse refreshing={false} />);
    await waitFor(() => expect(screen.getByText('+$18 this week')).toBeTruthy());
    expect(container.querySelector('.value-pulse-delta--up')).toBeTruthy();
    expect(container.querySelector('.value-pulse-spark polyline')).toBeTruthy();
  });

  it('colors a falling delta down and keeps the minus sign in the text', async () => {
    await recordValueSnapshot(150, daysAgo(6));
    await recordValueSnapshot(130, daysAgo(0));
    render(<ValuePulse refreshing={false} />);
    await waitFor(() => expect(screen.getByText('−$20 this week')).toBeTruthy());
    expect(document.querySelector('.value-pulse-delta--down')).toBeTruthy();
  });

  it('reads "Steady" when the delta rounds to zero', async () => {
    await recordValueSnapshot(100, daysAgo(3));
    await recordValueSnapshot(100.2, daysAgo(0));
    render(<ValuePulse refreshing={false} />);
    await waitFor(() => expect(screen.getByText('Steady this week')).toBeTruthy());
  });

  it('names the baseline date instead of "this week" across a long gap', async () => {
    await recordValueSnapshot(100, daysAgo(30));
    await recordValueSnapshot(160, daysAgo(0));
    render(<ValuePulse refreshing={false} />);
    await waitFor(() => expect(screen.getByText(/^\+\$60 since /)).toBeTruthy());
  });
});
