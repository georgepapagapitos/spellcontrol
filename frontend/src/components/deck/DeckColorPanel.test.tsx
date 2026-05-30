// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DeckColorPanel } from './DeckColorPanel';

describe('DeckColorPanel', () => {
  it('renders all three sections with data', () => {
    render(
      <DeckColorPanel
        colorDist={{ counts: { W: 10, U: 6, B: 0, R: 0, G: 0, C: 4 }, total: 20 }}
        manaProduction={{ counts: { W: 8, U: 5, B: 0, R: 0, G: 0, C: 2 }, total: 15 }}
      />
    );

    // (a) Distribution donut renders its SVG.
    const dist = screen.getByLabelText('Color distribution');
    expect(dist.tagName.toLowerCase()).toBe('svg');

    // (b) Production bars: at least one source row shows up.
    const prod = screen.getByLabelText('Mana production');
    expect(within(prod).getByText(/8 sources/)).toBeTruthy();

    // (c) Balance section reuses DeckColorBalance (its own heading + demand bar).
    expect(screen.getByText('Color balance')).toBeTruthy();
    expect(screen.getAllByText('Demand').length).toBeGreaterThan(0);

    // Sub-headings present.
    expect(screen.getByText('Distribution')).toBeTruthy();
    expect(screen.getByText('Production')).toBeTruthy();
    expect(screen.getByText('Balance')).toBeTruthy();
  });

  it('renders empty states when totals are 0', () => {
    render(
      <DeckColorPanel
        colorDist={{ counts: {}, total: 0 }}
        manaProduction={{ counts: {}, total: 0 }}
      />
    );

    expect(screen.getByText('No data')).toBeTruthy();
    expect(screen.getByText('No lands')).toBeTruthy();
    // Balance section's own empty state.
    expect(screen.getByText('No colored mana to balance.')).toBeTruthy();
    // No donut SVG when there's no data.
    expect(screen.queryByLabelText('Color distribution')).toBeNull();
  });
});
