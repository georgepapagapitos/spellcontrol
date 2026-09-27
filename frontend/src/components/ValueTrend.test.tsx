// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearMovers,
  clearValueHistory,
  recordDailyMovers,
  recordValueSnapshot,
} from '../lib/value-history';
import { ValueTrend } from './ValueTrend';

const daysAgo = (n: number) => Date.now() - n * 86400000;

afterEach(async () => {
  await clearValueHistory();
  await clearMovers();
});

describe('ValueTrend', () => {
  it('renders nothing with fewer than two logged days', async () => {
    await recordValueSnapshot(120, daysAgo(0));
    const { container } = render(<ValueTrend />);
    // Give the async history read a beat, then assert it stayed empty.
    await new Promise((r) => setTimeout(r, 20));
    expect(container.firstChild).toBeNull();
  });

  it('shows a signed weekly delta and the line chart once history exists', async () => {
    await recordValueSnapshot(100, daysAgo(7));
    await recordValueSnapshot(118.4, daysAgo(0), 18.4);
    const { container } = render(<ValueTrend />);
    await waitFor(() => expect(screen.getByText('+$18 this week')).toBeTruthy());
    expect(container.querySelector('.value-trend-delta-text--up')).toBeTruthy();
    // The chart svg mounts one effect later (width measurement).
    await waitFor(() => expect(container.querySelector('.value-trend-line')).toBeTruthy());
  });

  it('colors a falling delta down and keeps the minus sign in the text', async () => {
    await recordValueSnapshot(150, daysAgo(6));
    await recordValueSnapshot(130, daysAgo(0), -20);
    render(<ValueTrend />);
    await waitFor(() => expect(screen.getByText('−$20 this week')).toBeTruthy());
    expect(document.querySelector('.value-trend-delta-text--down')).toBeTruthy();
  });

  it('reads "Steady" when the delta rounds to zero', async () => {
    await recordValueSnapshot(100, daysAgo(3));
    await recordValueSnapshot(100.2, daysAgo(0), 0.2);
    render(<ValueTrend />);
    await waitFor(() => expect(screen.getByText('Steady this week')).toBeTruthy());
  });

  it('names the baseline date instead of "this week" across a long gap', async () => {
    await recordValueSnapshot(100, daysAgo(30));
    await recordValueSnapshot(160, daysAgo(0), 60);
    render(<ValueTrend />);
    await waitFor(() => expect(screen.getByText(/^\+\$60 since /)).toBeTruthy());
  });

  it('steps a keyboard readout through the points and clears on Escape', async () => {
    await recordValueSnapshot(100, daysAgo(2));
    await recordValueSnapshot(140, daysAgo(1));
    await recordValueSnapshot(160, daysAgo(0));
    const { container } = render(<ValueTrend />);
    await waitFor(() => expect(container.querySelector('.value-trend-chart')).toBeTruthy());
    const chart = container.querySelector('.value-trend-chart')!;
    fireEvent.keyDown(chart, { key: 'ArrowLeft' }); // from the latest point → middle
    expect(screen.getByRole('status').textContent).toContain('$140');
    fireEvent.keyDown(chart, { key: 'Home' });
    expect(screen.getByRole('status').textContent).toContain('$100');
    fireEvent.keyDown(chart, { key: 'Escape' });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('splits an import out of the price move, and leaves the cards part uncolored', async () => {
    await recordValueSnapshot(10_000, daysAgo(6));
    await recordValueSnapshot(10_020, daysAgo(3), 20);
    await recordValueSnapshot(11_020, daysAgo(1)); // an import, no refresh
    await recordValueSnapshot(11_045, daysAgo(0), 25);
    const { container } = render(<ValueTrend />);
    await waitFor(() => expect(screen.getByText('+$45 from prices this week')).toBeTruthy());
    const changes = container.querySelector('.value-trend-delta-changes');
    expect(changes?.textContent).toBe('+$1,000 from cards added');
    expect(changes?.className).not.toMatch(/--(up|down)/);
  });

  it("shows each mover's total impact across copies, with the per-copy move as detail", async () => {
    await recordValueSnapshot(100, daysAgo(7));
    await recordValueSnapshot(90, daysAgo(0), -10);
    await recordDailyMovers([
      {
        scryfallId: 'ent',
        finish: 'nonfoil',
        name: 'Generous Ent',
        setCode: 'ltr',
        before: 2.23,
        after: 1.92,
        copies: 8,
      },
    ]);
    const { container } = render(<ValueTrend />);
    await waitFor(() => expect(screen.getByText('Generous Ent')).toBeTruthy());
    expect(container.querySelector('.value-movers-meta')?.textContent).toBe(
      'LTR · ×8 at −$0.31 each'
    );
    expect(container.querySelector('.value-movers-delta')?.textContent).toContain('−$2.48');
  });
});
