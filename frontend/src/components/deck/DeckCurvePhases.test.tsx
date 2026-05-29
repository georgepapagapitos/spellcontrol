// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DeckCurvePhases } from './DeckCurvePhases';

describe('DeckCurvePhases', () => {
  const manaCurve = { 0: 1, 1: 6, 2: 14, 3: 12, 4: 8, 5: 5, 6: 3, 7: 2 };

  it('renders a histogram bar with a count for every CMC slot 0..7+', () => {
    const { container } = render(<DeckCurvePhases manaCurve={manaCurve} averageCmc={3.1} />);
    const cols = container.querySelectorAll('.deck-curve-phases-bar-col');
    expect(cols.length).toBe(8);

    // The "7+" slot label renders.
    expect(screen.getByText('7+')).toBeTruthy();

    // Each slot count is shown.
    const counts = container.querySelectorAll('.deck-curve-phases-bar-count');
    expect(Array.from(counts).map((n) => n.textContent)).toEqual([
      '1',
      '6',
      '14',
      '12',
      '8',
      '5',
      '3',
      '2',
    ]);
  });

  it('sums each phase total correctly (Early 0-2, Mid 3-4, Late 5+)', () => {
    const { container } = render(<DeckCurvePhases manaCurve={manaCurve} averageCmc={3.1} />);
    const phases = container.querySelectorAll('.deck-curve-phases-phase');
    expect(phases.length).toBe(3);

    const countFor = (label: string) => {
      const phase = Array.from(phases).find(
        (p) => p.querySelector('.deck-curve-phases-phase-label')?.textContent === label
      );
      return phase?.querySelector('.deck-curve-phases-phase-count')?.textContent;
    };

    expect(countFor('Early')).toBe('21'); // 1 + 6 + 14
    expect(countFor('Mid')).toBe('20'); // 12 + 8
    expect(countFor('Late')).toBe('10'); // 5 + 3 + 2
  });

  it('renders a grade letter for each phase', () => {
    const { container } = render(<DeckCurvePhases manaCurve={manaCurve} averageCmc={3.1} />);
    const grades = container.querySelectorAll('.deck-curve-phases-grade');
    expect(grades.length).toBe(3);
    for (const g of grades) {
      expect(g.textContent).toMatch(/^[A-F]$/);
    }
  });

  it('shows the average CMC', () => {
    render(<DeckCurvePhases manaCurve={manaCurve} averageCmc={3.14} />);
    expect(screen.getByText(/Avg CMC 3\.14/)).toBeTruthy();
  });

  it('handles an empty curve without dividing by zero', () => {
    const { container } = render(<DeckCurvePhases manaCurve={{}} averageCmc={0} />);
    const counts = container.querySelectorAll('.deck-curve-phases-bar-count');
    expect(Array.from(counts).every((n) => n.textContent === '0')).toBe(true);
    // Late phase with zero everywhere is graded against its target band.
    const grades = container.querySelectorAll('.deck-curve-phases-grade');
    expect(grades.length).toBe(3);
  });
});
