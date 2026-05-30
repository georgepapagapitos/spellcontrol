// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
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
  it('renders a thumbnail, name, role, inclusion, and price', () => {
    render(<GapAnalysisPanel cards={[makeCard()]} />);

    expect(screen.getByText('Sol Ring')).toBeTruthy();
    expect(screen.getByText('Ramp')).toBeTruthy();
    expect(screen.getByText(/In 62% of decks/)).toBeTruthy();
    expect(screen.getByText(/\$1\.50/)).toBeTruthy();
    // Image button + thumbnail
    expect(screen.getByAltText('Sol Ring')).toBeTruthy();
  });

  it('uses card.imageUrl for the thumbnail when present', () => {
    render(<GapAnalysisPanel cards={[makeCard({ imageUrl: 'https://example.com/sol.png' })]} />);
    const img = screen.getByAltText('Sol Ring') as HTMLImageElement;
    expect(img.src).toBe('https://example.com/sol.png');
  });

  it('falls back to a Scryfall named-image URL when imageUrl is absent', () => {
    render(<GapAnalysisPanel cards={[makeCard({ name: 'Cultivate', imageUrl: undefined })]} />);
    const img = screen.getByAltText('Cultivate') as HTMLImageElement;
    expect(img.src).toContain('api.scryfall.com/cards/named');
    expect(img.src).toContain('exact=Cultivate');
  });

  it('rounds the inclusion rate', () => {
    render(<GapAnalysisPanel cards={[makeCard({ inclusion: 47.8 })]} />);
    expect(screen.getByText(/In 48% of decks/)).toBeTruthy();
  });

  it('rewords the inclusion line with the commander name when provided', () => {
    render(<GapAnalysisPanel cards={[makeCard()]} commanderName="Atraxa" />);
    expect(screen.getByText(/In 62% of Atraxa decks/)).toBeTruthy();
  });

  it('omits the commander name from the inclusion line when not provided', () => {
    render(<GapAnalysisPanel cards={[makeCard()]} />);
    expect(screen.getByText(/In 62% of decks/)).toBeTruthy();
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
    expect(container.querySelector('.deck-gap-price')).toBeNull();
  });

  it('caps the list and shows an overflow note', () => {
    const cards = Array.from({ length: 25 }, (_, i) => makeCard({ name: `Card ${i}` }));
    const { container } = render(<GapAnalysisPanel cards={cards} />);
    expect(container.querySelectorAll('.deck-analysis-suggest-row').length).toBe(18);
    expect(screen.getByText('+7 more')).toBeTruthy();
  });

  it('renders nothing for an empty list', () => {
    const { container } = render(<GapAnalysisPanel cards={[]} />);
    expect(container.querySelector('.deck-analysis-suggest-list')).toBeNull();
  });

  it('toggles the inclusion disclosure', () => {
    render(<GapAnalysisPanel cards={[makeCard()]} commanderName="Atraxa" />);
    const trigger = screen.getByRole('button', { name: /What.+s this/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(/popularity proxy/)).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const body = screen.getByText(/popularity proxy/);
    expect(body).toBeTruthy();
    expect(body.textContent).toContain('Atraxa decks');
  });
});
