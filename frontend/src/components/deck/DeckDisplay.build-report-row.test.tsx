// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Archetype, type BuildReport, type ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay } from './DeckDisplay';

// The build report was a wall of eight equal-weight sentences in the deck
// stats (the bracket among them, a fifth time). It is a record of how the
// generator built the deck, not a stat, so it rests as one row naming the
// archetype and opens in place.

vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

const card = {
  id: 'sf-1',
  oracle_id: 'o-1',
  name: 'Test Creature',
  cmc: 3,
  type_line: 'Creature — Beast',
  color_identity: ['G'],
  keywords: [],
  rarity: 'common',
  set: 'tst',
  set_name: 'Test Set',
  prices: {},
} as unknown as ScryfallCard;

const report: BuildReport = {
  targetBracket: 'all',
  estimatedBracket: 2,
  dataSource: 'base',
  builtFromCollection: false,
  archetype: Archetype.VOLTRON,
};

function renderDeck(buildReport?: BuildReport) {
  return render(
    <MemoryRouter>
      <DeckDisplay
        title="Test deck"
        commander={null}
        cards={[{ slotId: 'slot-1', card }]}
        buildReport={buildReport}
      />
    </MemoryRouter>
  );
}

describe('Deck stats: the build report rests as one row', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-decks-view-mode', 'list');
  });

  it('is a closed disclosure whose summary names the generated archetype', () => {
    const { container } = renderDeck(report);
    const row = container.querySelector<HTMLDetailsElement>('details.deck-stats-report');
    expect(row).not.toBeNull();
    expect(row!.open).toBe(false);
    expect(row!.querySelector('summary')?.textContent).toContain('Generated with Voltron targets');
    // The full report is still there, one tap away.
    expect(row!.querySelector('.build-report')).not.toBeNull();
  });

  it('renders nothing for a deck that was never generated', () => {
    const { container } = renderDeck(undefined);
    expect(container.querySelector('.deck-stats-report')).toBeNull();
  });
});
