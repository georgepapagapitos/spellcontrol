// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';
import { DeckCardInspector } from './DeckCardInspector';
import type { Row } from './deck-display-rows';

function row(): Row {
  return {
    name: 'Viscera Seer',
    qty: 1,
    price: 0,
    slotIds: [],
    allocatedQty: 1,
    unownedQty: 0,
    orphanQty: 0,
    claimedElsewhereQty: 0,
    card: {
      id: 'sf-seer',
      oracle_id: 'o-seer',
      name: 'Viscera Seer',
      type_line: 'Creature — Vampire Wizard',
      oracle_text: 'Sacrifice a creature: Scry 1.',
    } as unknown as ScryfallCard,
  } as unknown as Row;
}

const combo = (id: string) => ({ combo: { id, cards: [] } }) as unknown as ComboMatch;

function renderInspector(extra: { combos?: ComboMatch[]; inclusionPct?: number }) {
  render(
    <MemoryRouter>
      <DeckCardInspector
        card={{ row: row(), binders: [], ...extra }}
        currency="USD"
        pinned={false}
        onTogglePin={() => {}}
      />
    </MemoryRouter>
  );
}

// The row's combo badge and EDHREC % drop out of a narrow deck column
// (deck-row-chip-tiers.test.ts), so the inspector is where they stay readable.
describe('DeckCardInspector — facts a narrow row drops', () => {
  it('shows the combo count and the EDHREC share', () => {
    renderInspector({ combos: [combo('a'), combo('b')], inclusionPct: 71 });
    expect(screen.getByText('In 2 combos')).toBeTruthy();
    expect(screen.getByText('In 71% of decks')).toBeTruthy();
  });

  it('reads one combo in the singular and a 0% card as off-meta', () => {
    renderInspector({ combos: [combo('a')], inclusionPct: 0 });
    expect(screen.getByText('In 1 combo')).toBeTruthy();
    expect(screen.getByText('Off-meta')).toBeTruthy();
  });

  it('shows neither when the deck has no combo or EDHREC data', () => {
    renderInspector({});
    expect(screen.queryByText(/combo/)).toBeNull();
    expect(screen.queryByText(/of decks|Off-meta/)).toBeNull();
  });
});
