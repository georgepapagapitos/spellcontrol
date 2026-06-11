// @vitest-environment happy-dom
// UX-310 — skeleton state for Tune and Power analysis tabs while async
// commander-deck analysis is still in-flight. Tests that:
//   (a) the skeleton appears while analysisState === 'pending' and no lane
//       content is available yet, and
//   (b) the skeleton disappears once analysisState === 'ready'.
// DeckDisplay is a large component; this file renders just enough to exercise
// the DeckAnalysisView branch under test.

import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';

// ── Minimal fixtures ────────────────────────────────────────────────────────

let seq = 0;
function mkCard(over: Partial<ScryfallCard> = {}): ScryfallCard {
  seq += 1;
  return {
    id: `sf-${seq}`,
    oracle_id: `o-${seq}`,
    name: `Card ${seq}`,
    mana_cost: '{1}',
    cmc: 1,
    type_line: 'Artifact',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test Set',
    prices: {},
    ...over,
  } as ScryfallCard;
}

function mkSlot(card: ScryfallCard): DeckDisplayCard {
  return { slotId: `slot-${card.id}`, card };
}

const COMMANDER = mkCard({ name: 'Atraxa', type_line: 'Legendary Creature' });
const cards: DeckDisplayCard[] = Array.from({ length: 4 }, () => mkSlot(mkCard()));

/** Render DeckDisplay mounted on a given view tab. */
function renderOnView(
  activeView: 'tune' | 'power',
  analysisState: 'pending' | 'ready' = 'pending',
  extraSlots?: {
    improveSlot?: React.ReactNode;
    powerHeroSlot?: React.ReactNode;
    engineSlot?: React.ReactNode;
    bracketFitSlot?: React.ReactNode;
    costSlot?: React.ReactNode;
  }
) {
  return render(
    <MemoryRouter>
      <DeckDisplay
        title="Test deck"
        commander={COMMANDER}
        cards={cards}
        deckId="deck-1"
        format="commander"
        activeView={activeView}
        analysisState={analysisState}
        {...extraSlots}
      />
    </MemoryRouter>
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('DeckAnalysisView skeleton (UX-310)', () => {
  describe('Tune tab', () => {
    it('shows the skeleton when analysisState is pending and no lane content exists', () => {
      renderOnView('tune', 'pending');
      expect(screen.getByRole('status', { name: /analyzing your deck/i })).toBeTruthy();
    });

    it('hides the skeleton when analysisState is ready (even with no lane content)', () => {
      renderOnView('tune', 'ready');
      expect(screen.queryByRole('status', { name: /analyzing your deck/i })).toBeNull();
    });

    it('hides the skeleton when a lane slot is already present', () => {
      // improveSlot arriving means partial analysis landed — skeleton should clear.
      renderOnView('tune', 'pending', {
        improveSlot: <div>Improve content</div>,
      });
      expect(screen.queryByRole('status', { name: /analyzing your deck/i })).toBeNull();
      // The real content should be present.
      expect(screen.getByText('Improve content')).toBeTruthy();
    });

    it('hides the skeleton when bracketFitSlot arrives (UX-313: third Tune lane)', () => {
      // bracketFitSlot is the third Tune lane — its arrival clears the skeleton
      // even when improveSlot and costSlot haven't arrived yet.
      renderOnView('tune', 'pending', {
        bracketFitSlot: <div>Bracket Fit content</div>,
      });
      expect(screen.queryByRole('status', { name: /analyzing your deck/i })).toBeNull();
      expect(screen.getByText('Bracket Fit content')).toBeTruthy();
    });
  });

  describe('Power tab', () => {
    it('shows the skeleton when analysisState is pending and no panel content exists', () => {
      renderOnView('power', 'pending');
      expect(screen.getByRole('status', { name: /analyzing your deck/i })).toBeTruthy();
    });

    it('hides the skeleton when analysisState is ready', () => {
      renderOnView('power', 'ready');
      expect(screen.queryByRole('status', { name: /analyzing your deck/i })).toBeNull();
    });

    it('hides the skeleton when the power hero slot has arrived', () => {
      renderOnView('power', 'pending', {
        powerHeroSlot: <div>Power hero</div>,
      });
      expect(screen.queryByRole('status', { name: /analyzing your deck/i })).toBeNull();
      expect(screen.getByText('Power hero')).toBeTruthy();
    });
  });
});
