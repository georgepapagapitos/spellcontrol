// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GapAnalysisCard } from '@/deck-builder/types';
import { GapAnalysisPanel } from './GapAnalysisPanel';

function makeCard(overrides: Partial<GapAnalysisCard> = {}): GapAnalysisCard {
  return {
    name: 'Sol Ring',
    price: '1.50',
    inclusion: 62,
    synergy: 0.3,
    typeLine: 'Artifact',
    roleLabel: 'Ramp',
    ...overrides,
  };
}

describe('GapAnalysisPanel', () => {
  it('renders card name, role, inclusion %, and price', () => {
    render(<GapAnalysisPanel cards={[makeCard()]} />);

    expect(screen.getByText('Sol Ring')).toBeTruthy();
    expect(screen.getByText('Ramp')).toBeTruthy();
    expect(screen.getByText('62%')).toBeTruthy();
    expect(screen.getByText('$1.50')).toBeTruthy();
  });

  it('rounds the inclusion rate', () => {
    render(<GapAnalysisPanel cards={[makeCard({ inclusion: 47.8 })]} />);
    expect(screen.getByText('48%')).toBeTruthy();
  });

  it('marks owned cards via the ownedNames set', () => {
    render(
      <GapAnalysisPanel
        cards={[makeCard({ name: 'Cultivate' })]}
        ownedNames={new Set(['Cultivate'])}
      />
    );
    expect(screen.getByText('Owned')).toBeTruthy();
  });

  it('marks owned cards via the isOwned flag', () => {
    render(<GapAnalysisPanel cards={[makeCard({ isOwned: true })]} />);
    expect(screen.getByText('Owned')).toBeTruthy();
  });

  it('does not show an owned marker for unowned cards', () => {
    render(<GapAnalysisPanel cards={[makeCard()]} />);
    expect(screen.queryByText('Owned')).toBeNull();
  });

  it('omits the price when none is present', () => {
    const { container } = render(<GapAnalysisPanel cards={[makeCard({ price: null })]} />);
    expect(container.querySelector('.gap-analysis-price')).toBeNull();
  });

  it('caps the list and shows an overflow note', () => {
    const cards = Array.from({ length: 25 }, (_, i) => makeCard({ name: `Card ${i}` }));
    const { container } = render(<GapAnalysisPanel cards={cards} />);
    expect(container.querySelectorAll('.gap-analysis-row').length).toBe(18);
    expect(screen.getByText('+7 more')).toBeTruthy();
  });

  it('renders nothing for an empty list', () => {
    const { container } = render(<GapAnalysisPanel cards={[]} />);
    expect(container.querySelector('.gap-analysis-list')).toBeNull();
  });
});
