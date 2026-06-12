// @vitest-environment happy-dom
// UX-312/313/315 — deck analysis structure and vocabulary changes:
//   UX-312: Validation + Build-health panels dropped from Stats (hero covers them);
//           deckGrade letter grade dropped from stat-strip.
//   UX-313: Bracket Fit renders on Tune tab (not Power); NBM bracket-fit focus routes there;
//           PowerHero Target control appears when onSetBracketOverride is provided.
//   UX-315: "Soft score" renamed to "Power signal" in BracketBreakdown.

import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckDisplay, type DeckDisplayCard } from './DeckDisplay';
import { BracketBreakdown } from './BracketBreakdown';
import { PowerHero } from './PowerHero';
import type { BracketEstimation } from '@/deck-builder/services/deckBuilder/bracketEstimator';

// ── Fixtures ────────────────────────────────────────────────────────────────

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

function makeEstimation(overrides: Partial<BracketEstimation> = {}): BracketEstimation {
  return {
    bracket: 3,
    label: 'Upgraded',
    softScore: 45,
    hardFloors: [{ bracket: 3, reason: '2 Game Changer cards' }],
    breakdown: {
      gameChangerCount: 2,
      gameChangerNames: ['Cyclonic Rift', 'Smothering Tithe'],
      massLandDenialCount: 0,
      massLandDenialNames: [],
      extraTurnCount: 0,
      extraTurnNames: [],
      earlyComboCount: 0,
      lateComboCount: 0,
      fastManaCount: 1,
      fastManaNames: ['Sol Ring'],
      tutorCount: 1,
      tutorNames: ['Demonic Tutor'],
      staxPieceCount: 0,
      staxPieceNames: [],
      averageCmc: 3.2,
      interactionCount: 5,
    },
    ...overrides,
  };
}

// ── UX-315: "Power signal" vocabulary ─────────────────────────────────────

describe('UX-315 — Power signal vocabulary in BracketBreakdown', () => {
  it('shows "Power signal" heading, not "Soft score"', () => {
    render(<BracketBreakdown estimation={makeEstimation()} />);
    expect(screen.getByText('Power signal')).toBeTruthy();
    expect(screen.queryByText('Soft score')).toBeNull();
  });

  it('labels the power-signal table with "Power signal" aria-label', () => {
    render(<BracketBreakdown estimation={makeEstimation()} />);
    expect(screen.getByRole('table', { name: 'Power signal' })).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Soft score' })).toBeNull();
  });

  it('uses "power signal" in the summary line', () => {
    const { container } = render(<BracketBreakdown estimation={makeEstimation()} />);
    const line = container.querySelector('.bracket-breakdown-summary-line');
    expect(line?.textContent).toContain('power signal');
    expect(line?.textContent).not.toContain('soft score');
  });
});

// ── UX-312: deckGrade stat-strip dropped ────────────────────────────────────

describe('UX-312 — deckGrade letter grade absent from stat-strip', () => {
  it('does not render a "grade" stat in the deck-view stat strip', () => {
    render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={COMMANDER}
          cards={cards}
          deckId="deck-1"
          format="commander"
          activeView="deck"
          deckGrade={{ letter: 'A', headline: 'Excellent' }}
        />
      </MemoryRouter>
    );
    // The grade label should not appear in the stat strip
    expect(screen.queryByText('grade')).toBeNull();
    // The letter should not appear as a stat value
    const statStrip = document.querySelector('.deck-stat-strip');
    expect(statStrip?.textContent).not.toContain('grade');
  });
});

// ── UX-312: Validation + Build-health panels absent from Stats ───────────────

describe('UX-312 — Standalone Validation and Build-health panels absent from Stats', () => {
  it('does not render a standalone "Validation" panel heading on the Stats tab', () => {
    render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={COMMANDER}
          cards={cards}
          deckId="deck-1"
          format="commander"
          activeView="stats"
        />
      </MemoryRouter>
    );
    // StatsHero covers the functional/validation summary — a standalone "Validation"
    // panel heading should not appear below it.
    const panels = screen.queryAllByText('Validation');
    // There should be no "Validation" panel title
    expect(panels.length).toBe(0);
  });

  it('does not render a standalone "Build health" panel heading on the Stats tab', () => {
    render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={COMMANDER}
          cards={cards}
          deckId="deck-1"
          format="commander"
          activeView="stats"
        />
      </MemoryRouter>
    );
    // StatsHero covers build health — a standalone "Build health" panel should not appear.
    expect(screen.queryByText('Build health')).toBeNull();
  });
});

// ── UX-313: Bracket Fit on Tune, not Power ─────────────────────────────────

describe('UX-313 — Bracket Fit lane renders on Tune tab', () => {
  const bracketFitContent = <div data-testid="bracket-fit-content">Bracket Fit lane content</div>;

  it('renders coachFeedSlot on the Tune tab', () => {
    render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={COMMANDER}
          cards={cards}
          deckId="deck-1"
          format="commander"
          activeView="tune"
          coachFeedSlot={bracketFitContent}
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId('bracket-fit-content')).toBeTruthy();
  });

  it('does NOT render coachFeedSlot on the Power tab', () => {
    render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={COMMANDER}
          cards={cards}
          deckId="deck-1"
          format="commander"
          activeView="power"
          coachFeedSlot={bracketFitContent}
        />
      </MemoryRouter>
    );
    // coachFeedSlot should not appear on Power (Coach tab only)
    expect(screen.queryByTestId('bracket-fit-content')).toBeNull();
  });

  it('renders coachFeedSlot content on the Tune tab', () => {
    render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={COMMANDER}
          cards={cards}
          deckId="deck-1"
          format="commander"
          activeView="tune"
          coachFeedSlot={bracketFitContent}
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId('bracket-fit-content')).toBeTruthy();
  });
});

// ── UX-313: PowerHero Target control ────────────────────────────────────────

describe('UX-313 — PowerHero Target bracket control', () => {
  it('renders a "Target" SelectMenu when onSetBracketOverride is provided', () => {
    const onSetBracketOverride = vi.fn();
    render(
      <PowerHero
        bracket={3}
        bracketOverridden={false}
        bracketReasons={[]}
        comboInDeck={0}
        comboOwnedMissing={0}
        combosLoading={false}
        bracketOverride={null}
        onSetBracketOverride={onSetBracketOverride}
      />
    );
    // The "Target" label should appear in the control
    expect(screen.getByText('Target')).toBeTruthy();
  });

  it('does not render the Target control when onSetBracketOverride is omitted', () => {
    render(
      <PowerHero
        bracket={3}
        bracketOverridden={false}
        bracketReasons={[]}
        comboInDeck={0}
        comboOwnedMissing={0}
        combosLoading={false}
      />
    );
    expect(screen.queryByText('Target')).toBeNull();
  });

  it('calls onSetBracketOverride with the selected bracket when a Target option is chosen', () => {
    const onSetBracketOverride = vi.fn();
    render(
      <PowerHero
        bracket={3}
        bracketOverridden={false}
        bracketReasons={[]}
        comboInDeck={0}
        comboOwnedMissing={0}
        combosLoading={false}
        bracketOverride={null}
        onSetBracketOverride={onSetBracketOverride}
      />
    );
    // The SelectMenu trigger is the toolbar-pill button whose label text includes "Target".
    // When a label prop is provided, the SelectMenu does NOT set aria-label on the button;
    // the accessible name comes from the child text. Find by its container class.
    const targetContainer = document.querySelector('.power-hero-target');
    expect(targetContainer).toBeTruthy();
    const trigger = targetContainer!.querySelector('button');
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger!);
    // Click the "4 — Optimized" option (appears in the portal)
    const opt4 = screen.getByRole('option', { name: /4 — Optimized/i });
    fireEvent.click(opt4);
    expect(onSetBracketOverride).toHaveBeenCalledWith(4);
  });

  it('calls onSetBracketOverride(null) when "Auto" is chosen', () => {
    const onSetBracketOverride = vi.fn();
    render(
      <PowerHero
        bracket={4}
        bracketOverridden={true}
        bracketReasons={[]}
        comboInDeck={0}
        comboOwnedMissing={0}
        combosLoading={false}
        bracketOverride={4}
        onSetBracketOverride={onSetBracketOverride}
      />
    );
    const targetContainer = document.querySelector('.power-hero-target');
    const trigger = targetContainer!.querySelector('button');
    fireEvent.click(trigger!);
    const autoOpt = screen.getByRole('option', { name: /auto/i });
    fireEvent.click(autoOpt);
    expect(onSetBracketOverride).toHaveBeenCalledWith(null);
  });
});
