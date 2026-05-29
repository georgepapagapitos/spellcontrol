// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BracketEstimation } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { BracketBreakdown } from './BracketBreakdown';

function makeEstimation(overrides: Partial<BracketEstimation> = {}): BracketEstimation {
  return {
    bracket: 4,
    label: 'Optimized',
    softScore: 78,
    hardFloors: [
      {
        bracket: 3,
        reason: '2 Game Changer cards',
        detail: 'These cards can take over a game on their own.',
      },
      {
        bracket: 4,
        reason: 'Mass land denial (Armageddon)',
        detail: 'Destroying all lands prevents opponents from playing.',
      },
      {
        bracket: 3,
        reason: '1 late-game combo',
      },
    ],
    breakdown: {
      gameChangerCount: 2,
      gameChangerNames: ['Cyclonic Rift', 'Smothering Tithe'],
      massLandDenialCount: 1,
      massLandDenialNames: ['Armageddon'],
      extraTurnCount: 0,
      extraTurnNames: [],
      earlyComboCount: 0,
      lateComboCount: 1,
      fastManaCount: 3,
      fastManaNames: ['Mana Crypt', 'Mana Vault', 'Chrome Mox'],
      tutorCount: 2,
      tutorNames: ['Demonic Tutor', 'Vampiric Tutor'],
      staxPieceCount: 0,
      staxPieceNames: [],
      averageCmc: 2.8,
      interactionCount: 11,
    },
    ...overrides,
  };
}

describe('BracketBreakdown', () => {
  it('renders hard floor reasons and contributing card chips', () => {
    render(<BracketBreakdown estimation={makeEstimation()} />);

    // Floor reasons
    expect(screen.getByText('2 Game Changer cards')).toBeTruthy();
    expect(screen.getByText('Mass land denial (Armageddon)')).toBeTruthy();
    expect(screen.getByText('1 late-game combo')).toBeTruthy();

    // Floor tags
    expect(screen.getAllByText(/Floor: Bracket 3/).length).toBeGreaterThan(0);
    expect(screen.getByText('Floor: Bracket 4')).toBeTruthy();

    // Contributing card chips for game-changer + land-denial floors
    expect(screen.getByText('Cyclonic Rift')).toBeTruthy();
    expect(screen.getByText('Smothering Tithe')).toBeTruthy();
    expect(screen.getByText('Armageddon')).toBeTruthy();

    // Combo floor surfaces a count note
    expect(screen.getByText(/1 late-game combo detected/)).toBeTruthy();
  });

  it('renders soft-score components with contributing names', () => {
    render(<BracketBreakdown estimation={makeEstimation()} />);

    // '78/100' appears in both the soft-score total and the summary line.
    expect(screen.getAllByText('78/100').length).toBeGreaterThan(0);
    expect(screen.getByText('Fast mana')).toBeTruthy();
    expect(screen.getByText('Tutors')).toBeTruthy();
    expect(screen.getByText('Low curve')).toBeTruthy();
    expect(screen.getByText('Interaction')).toBeTruthy();

    // Fast mana + tutor chips
    expect(screen.getByText('Mana Crypt')).toBeTruthy();
    expect(screen.getByText('Demonic Tutor')).toBeTruthy();

    // Fast mana points: 3 × 8 = 24 / 40
    expect(screen.getByText('24/40')).toBeTruthy();
    // Tutor points: 2 × 5 = 10 / 25
    expect(screen.getByText('10/25')).toBeTruthy();

    // Avg CMC detail
    expect(screen.getByText(/Avg CMC 2\.80/)).toBeTruthy();
  });

  it('renders the calculation summary line', () => {
    const { container } = render(<BracketBreakdown estimation={makeEstimation()} />);

    // The summary is split across <strong> nodes, so assert on the
    // normalized textContent of the line element.
    const line = container.querySelector('.bracket-breakdown-summary-line');
    expect(line?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Floor Bracket 4 + soft score 78/100 → Bracket 4 (Optimized)'
    );
  });

  it('notes when a high soft score elevated the bracket above its floor', () => {
    const est = makeEstimation({
      bracket: 4,
      label: 'Optimized',
      softScore: 70,
      hardFloors: [{ bracket: 3, reason: '2 Game Changer cards' }],
    });
    render(<BracketBreakdown estimation={est} />);

    expect(screen.getByText(/bumped the floor from Bracket 3 up to Bracket 4/)).toBeTruthy();
  });

  it('shows the no-floor message when there are no hard floors', () => {
    const est = makeEstimation({
      bracket: 1,
      label: 'Exhibition',
      softScore: 5,
      hardFloors: [],
    });
    const { container } = render(<BracketBreakdown estimation={est} />);

    expect(screen.getByText('No hard-floor signals — floor is Bracket 1.')).toBeTruthy();
    const line = container.querySelector('.bracket-breakdown-summary-line');
    expect(line?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Floor Bracket 1 + soft score 5/100 → Bracket 1 (Exhibition)'
    );
  });
});
