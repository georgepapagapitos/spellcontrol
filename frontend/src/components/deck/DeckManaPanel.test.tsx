// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DeckManaPanel, type DeckManaData } from './DeckManaPanel';

const DATA: DeckManaData = {
  manaCurve: { 1: 4, 2: 8, 3: 6, 4: 3 },
  averageCmc: 2.6,
  colorDist: { counts: { W: 3, U: 5, B: 0, R: 0, G: 0, C: 2 }, total: 10 },
  manaProduction: { counts: { W: 4, U: 6, B: 0, R: 0, G: 0, C: 1 }, total: 11 },
  typeBreakdown: { Creature: 20, Instant: 6, Land: 36 },
};

describe('DeckManaPanel', () => {
  it('renders the three mana sections (curve / color / types)', () => {
    const { container } = render(<DeckManaPanel {...DATA} />);
    const titles = Array.from(container.querySelectorAll('.deck-stats-panel-title')).map(
      (el) => el.textContent
    );
    expect(titles).toEqual(['Mana curve', 'Color', 'Types']);
  });

  it('renders the unified color view sub-sections', () => {
    render(<DeckManaPanel {...DATA} />);
    // DeckColorPanel's three sub-headings prove the merged color view wired up.
    expect(screen.getByText('Distribution')).toBeTruthy();
    expect(screen.getByText('Production')).toBeTruthy();
    expect(screen.getByText('Balance')).toBeTruthy();
  });
});
