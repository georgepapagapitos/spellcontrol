// @vitest-environment happy-dom
// UX-310 — skeleton state for Tune and Power analysis tabs while async
// commander-deck analysis is still in-flight. Tests that:
//   (a) the skeleton appears while analysisState === 'pending' and no lane
//       content is available yet, and
//   (b) the skeleton disappears once analysisState === 'ready'.
// E162 — a first analysis that fails or stalls (rather than merely being
// slow) surfaces analysisState === 'error' instead of leaving these tabs
// skeletoning forever: a failure message + retry affordance replaces the
// shimmer, on both Tune and Power.
// DeckDisplay is a large component; this file renders just enough to exercise
// the DeckAnalysisView branch under test.

import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  analysisState: 'pending' | 'ready' | 'error' = 'pending',
  extraSlots?: {
    coachFeedSlot?: React.ReactNode;
    powerHeroSlot?: React.ReactNode;
    engineSlot?: React.ReactNode;
    onRetryAnalysis?: () => void;
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
      // coachFeedSlot arriving means analysis landed — skeleton should clear.
      renderOnView('tune', 'pending', {
        coachFeedSlot: <div>Coach content</div>,
      });
      expect(screen.queryByRole('status', { name: /analyzing your deck/i })).toBeNull();
      // The real content should be present.
      expect(screen.getByText('Coach content')).toBeTruthy();
    });

    it('hides the skeleton when bracketFitSlot arrives (UX-313: third Tune lane)', () => {
      // coachFeedSlot unifies all tune lanes (including bracket-fit) — its
      // arrival clears the skeleton regardless of which sub-lane triggered it.
      renderOnView('tune', 'pending', {
        coachFeedSlot: <div>Bracket Fit content</div>,
      });
      expect(screen.queryByRole('status', { name: /analyzing your deck/i })).toBeNull();
      expect(screen.getByText('Bracket Fit content')).toBeTruthy();
    });

    // ── E162 ──
    it('shows a failure message + retry instead of the shimmer when analysis errors', () => {
      const onRetryAnalysis = vi.fn();
      renderOnView('tune', 'error', { onRetryAnalysis });
      expect(screen.queryByRole('status', { name: /analyzing your deck/i })).toBeNull();
      expect(screen.getByText(/Couldn.t analyze this deck/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(onRetryAnalysis).toHaveBeenCalledTimes(1);
    });

    it('hides the error placeholder once real lane content has landed', () => {
      renderOnView('tune', 'error', { coachFeedSlot: <div>Coach content</div> });
      expect(screen.queryByText(/Couldn.t analyze this deck/)).toBeNull();
      expect(screen.getByText('Coach content')).toBeTruthy();
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

    // ── E162 ──
    it('shows a failure message + retry instead of the shimmer when analysis errors', () => {
      const onRetryAnalysis = vi.fn();
      renderOnView('power', 'error', { onRetryAnalysis });
      expect(screen.queryByRole('status', { name: /analyzing your deck/i })).toBeNull();
      expect(screen.getByText(/Couldn.t analyze this deck/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(onRetryAnalysis).toHaveBeenCalledTimes(1);
    });

    it('hides the error placeholder once the power hero slot has landed', () => {
      renderOnView('power', 'error', { powerHeroSlot: <div>Power hero</div> });
      expect(screen.queryByText(/Couldn.t analyze this deck/)).toBeNull();
      expect(screen.getByText('Power hero')).toBeTruthy();
    });
  });
});
