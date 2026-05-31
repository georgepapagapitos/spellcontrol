// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DeckCurvePhases } from './DeckCurvePhases';
import type { ScryfallCard } from '@/deck-builder/types';

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

  it('makes bars and phases tappable when card lists are provided', () => {
    const cardsByCmc = {
      2: [{ name: 'Counterspell', count: 1 }],
      3: [{ name: 'Cultivate', count: 1 }],
    };
    render(<DeckCurvePhases manaCurve={manaCurve} averageCmc={3.1} cardsByCmc={cardsByCmc} />);

    // The CMC-2 bar has cards → tappable; the CMC-0 bar has none → static.
    expect(screen.getByRole('button', { name: /mana value 2$/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /mana value 0$/ })).toBeNull();

    // Early (0-2) and Mid (3-4) have cards → tappable; Late (5+) has none.
    expect(screen.getByRole('button', { name: /Early-game cards/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Mid-game cards/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Late-game cards/ })).toBeNull();
  });

  it('renders no buttons when no card lists are provided', () => {
    render(<DeckCurvePhases manaCurve={manaCurve} averageCmc={3.1} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('handles an empty curve without dividing by zero', () => {
    const { container } = render(<DeckCurvePhases manaCurve={{}} averageCmc={0} />);
    const counts = container.querySelectorAll('.deck-curve-phases-bar-count');
    expect(Array.from(counts).every((n) => n.textContent === '0')).toBe(true);
    // Late phase with zero everywhere is graded against its target band.
    const grades = container.querySelectorAll('.deck-curve-phases-grade');
    expect(grades.length).toBe(3);
  });

  // ── Color-stacked ("by color") mode ──────────────────────────────────────
  const emptyBucket = () => ({ W: 0, U: 0, B: 0, R: 0, G: 0, gold: 0, colorless: 0 });
  const curveByColor = {
    0: { ...emptyBucket(), colorless: 1 },
    1: { ...emptyBucket(), G: 6 },
    2: { ...emptyBucket(), U: 10, gold: 4 },
    3: { ...emptyBucket(), R: 12 },
    4: { ...emptyBucket(), W: 8 },
    5: { ...emptyBucket(), B: 5 },
    6: { ...emptyBucket(), gold: 3 },
    7: { ...emptyBucket(), colorless: 2 },
  };

  it('defaults to by-color mode: stacked color segments + a legend with text labels', () => {
    const { container } = render(
      <DeckCurvePhases manaCurve={manaCurve} averageCmc={3.1} curveByColor={curveByColor} />
    );
    // "By color" is the default and the toggle reflects it.
    expect(screen.getByRole('radio', { name: 'By color' }).getAttribute('aria-pressed')).toBe(
      'true'
    );

    // Stacked bars + segments are rendered (not solid count fills).
    expect(container.querySelectorAll('.deck-curve-phases-bar-stack').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.deck-curve-phases-seg').length).toBeGreaterThan(0);

    // The legend carries text labels, never color-only — a11y.
    expect(screen.getByText('Multicolor')).toBeTruthy();
    expect(screen.getByText('Colorless')).toBeTruthy();
  });

  it('switches to count mode (solid accent bars) when the Count toggle is clicked', () => {
    const { container } = render(
      <DeckCurvePhases manaCurve={manaCurve} averageCmc={3.1} curveByColor={curveByColor} />
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Count' }));
    expect(screen.getByRole('radio', { name: 'Count' }).getAttribute('aria-pressed')).toBe('true');
    // No stacked bars remain; the classic solid fills are shown instead.
    expect(container.querySelectorAll('.deck-curve-phases-bar-stack').length).toBe(0);
    expect(container.querySelectorAll('.deck-curve-phases-bar-fill').length).toBeGreaterThan(0);
  });

  it('makes each color segment a drill-down button with a descriptive aria label', () => {
    // CMC 2 has 10 blue + 4 gold in the bucket; per-segment cards are filtered
    // to that color category from cardsByCmc by the same 0/1/2+ rule.
    // Only color_identity matters for the segment categorization; cast the
    // partial Scryfall objects to the carousel's card shape for the fixture.
    const cardsByCmc = {
      2: [
        { name: 'Counterspell', count: 1, card: { color_identity: ['U'] } as ScryfallCard },
        {
          name: 'Growth Spiral',
          count: 1,
          card: { color_identity: ['U', 'G'] } as ScryfallCard,
        },
      ],
    };
    render(
      <DeckCurvePhases
        manaCurve={manaCurve}
        averageCmc={3.1}
        curveByColor={curveByColor}
        cardsByCmc={cardsByCmc}
      />
    );
    const blueSeg = screen.getByRole('button', {
      name: /Show the 10 blue cards at mana value 2/i,
    });
    fireEvent.click(blueSeg);
  });
});
