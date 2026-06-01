// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HeroScore } from './HeroScore';
import type { PlanScore } from '@/deck-builder/services/deckBuilder/planScore';

const base: PlanScore = {
  overall: 82,
  bandLabel: 'Healthy',
  headline: 'A focused, resilient plan',
  byline: 'Your curve and interaction back up the game plan.',
  subscores: {
    strategy: { value: 80, surface: '', bandLabel: 'Healthy' },
    roles: { value: 70, surface: '', bandLabel: 'Solid' },
    curve: { value: 60, surface: '', bandLabel: 'Solid' },
    cardFit: { value: 50, surface: '', bandLabel: 'Mixed' },
  },
  limitedData: false,
};

describe('HeroScore', () => {
  it('renders the rounded score, band, headline, and byline', () => {
    render(<HeroScore plan={{ ...base, overall: 81.6 }} />);
    expect(screen.getByText('82')).toBeTruthy();
    expect(screen.getByText('Healthy')).toBeTruthy();
    expect(screen.getByText('A focused, resilient plan')).toBeTruthy();
    expect(screen.getByText(/curve and interaction/)).toBeTruthy();
  });

  it('exposes the numeric score via an accessible group label', () => {
    render(<HeroScore plan={base} />);
    expect(screen.getByRole('group', { name: /82 out of 100, Healthy/ })).toBeTruthy();
  });

  it('applies the band class matching the score tier', () => {
    const { container, rerender } = render(<HeroScore plan={{ ...base, overall: 82 }} />);
    expect(container.querySelector('.hero-score.is-emerald')).toBeTruthy();
    rerender(<HeroScore plan={{ ...base, overall: 65 }} />);
    expect(container.querySelector('.hero-score.is-accent')).toBeTruthy();
    rerender(<HeroScore plan={{ ...base, overall: 45 }} />);
    expect(container.querySelector('.hero-score.is-amber')).toBeTruthy();
    rerender(<HeroScore plan={{ ...base, overall: 20 }} />);
    expect(container.querySelector('.hero-score.is-rose')).toBeTruthy();
  });

  it('shows a limited-data hint only when flagged', () => {
    const { rerender } = render(<HeroScore plan={base} />);
    expect(screen.queryByText(/Limited data/)).toBeNull();
    rerender(<HeroScore plan={{ ...base, limitedData: true }} />);
    expect(screen.getByText(/Limited data/)).toBeTruthy();
  });

  it('clamps out-of-range scores into 0-100', () => {
    render(<HeroScore plan={{ ...base, overall: 140 }} />);
    expect(screen.getByText('100')).toBeTruthy();
  });
});
