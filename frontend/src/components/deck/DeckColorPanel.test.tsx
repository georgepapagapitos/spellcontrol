// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DeckColorPanel } from './DeckColorPanel';

describe('DeckColorPanel', () => {
  it('renders the distribution donut and the merged mana-base readout', () => {
    render(
      <DeckColorPanel
        colorDist={{ counts: { W: 10, U: 6, B: 0, R: 0, G: 0, C: 4 }, total: 20 }}
        manaProduction={{ counts: { W: 8, U: 5, B: 0, R: 0, G: 0, C: 2 }, total: 15 }}
      />
    );

    // Distribution donut renders its SVG under its sub-heading.
    expect(screen.getByText('Distribution')).toBeTruthy();
    expect(screen.getByLabelText('Color distribution').tagName.toLowerCase()).toBe('svg');

    // Mana base (merged Production + Balance): demand meters + a colorless row.
    expect(screen.getByText('Mana base')).toBeTruthy();
    expect(screen.getAllByText('Demand').length).toBeGreaterThan(0);
    expect(screen.getByText('Colorless')).toBeTruthy();

    // The old standalone Production / Balance sub-headings are gone.
    expect(screen.queryByText('Production')).toBeNull();
    expect(screen.queryByText('Balance')).toBeNull();
  });

  it('makes a mana-base row tappable when its sources are known', () => {
    render(
      <DeckColorPanel
        colorDist={{ counts: { W: 10, U: 6, B: 0, R: 0, G: 0, C: 4 }, total: 20 }}
        manaProduction={{
          counts: { W: 8, U: 5, B: 0, R: 0, G: 0, C: 2 },
          total: 15,
          sourcesByColor: {
            W: [
              { name: 'Plains', count: 6 },
              { name: 'Hallowed Fountain', count: 1 },
            ],
            U: [{ name: 'Island', count: 5 }],
            C: [{ name: 'Wastes', count: 2 }],
          },
        }}
      />
    );

    // White has 2 unique sources → its row is a button labeled with that count.
    expect(screen.getByRole('button', { name: /Show the 2 White mana sources/ })).toBeTruthy();
    // The colorless row is tappable too.
    expect(screen.getByRole('button', { name: /Show the 1 colorless mana sources/ })).toBeTruthy();
  });

  it('makes a distribution color tappable when its cards are known', () => {
    render(
      <DeckColorPanel
        colorDist={{ counts: { W: 10, U: 6, B: 0, R: 0, G: 0, C: 4 }, total: 20 }}
        manaProduction={{ counts: {}, total: 0 }}
        cardsByColor={{ W: [{ name: 'Wrath of God', count: 1 }] }}
      />
    );
    // Only White has a card list → its donut legend entry is tappable.
    expect(screen.getByRole('button', { name: /Show the 10 White cards/ })).toBeTruthy();
  });

  it('keeps the panel static when no card lists are provided', () => {
    render(
      <DeckColorPanel
        colorDist={{ counts: { W: 10, U: 6, B: 0, R: 0, G: 0, C: 4 }, total: 20 }}
        manaProduction={{ counts: { W: 8, U: 5, B: 0, R: 0, G: 0, C: 2 }, total: 15 }}
      />
    );

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders empty states when totals are 0', () => {
    render(
      <DeckColorPanel
        colorDist={{ counts: {}, total: 0 }}
        manaProduction={{ counts: {}, total: 0 }}
      />
    );

    expect(screen.getByText('No data')).toBeTruthy();
    // Merged mana-base empty state.
    expect(screen.getByText('No colored mana to balance.')).toBeTruthy();
    // No donut SVG when there's no data.
    expect(screen.queryByLabelText('Color distribution')).toBeNull();
  });

  it('donut center shows total card count', () => {
    render(
      <DeckColorPanel
        colorDist={{ counts: { W: 10, U: 6, C: 4 }, total: 20 }}
        manaProduction={{ counts: {}, total: 0 }}
      />
    );
    // The center label aria-label includes the total count.
    expect(screen.getByLabelText(/20 cards total/)).toBeTruthy();
    // The visible count text is also present.
    expect(screen.getByText('20')).toBeTruthy();
  });

  it('donut center aria-label includes color identity (excluding colorless)', () => {
    render(
      <DeckColorPanel
        colorDist={{ counts: { W: 10, U: 6, C: 4 }, total: 20 }}
        manaProduction={{ counts: {}, total: 0 }}
      />
    );
    // W and U are identity colors; C (colorless) is excluded from identity.
    const centerEl = screen.getByLabelText(/20 cards total, White, Blue/);
    expect(centerEl).toBeTruthy();
  });

  it('donut center aria-label omits color identity when only colorless is present', () => {
    render(
      <DeckColorPanel
        colorDist={{ counts: { C: 10 }, total: 10 }}
        manaProduction={{ counts: {}, total: 0 }}
      />
    );
    // Only colorless — no identity label.
    const centerEl = screen.getByLabelText('10 cards total');
    expect(centerEl).toBeTruthy();
  });
});
