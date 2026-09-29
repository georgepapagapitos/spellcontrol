import { describe, it, expect } from 'vitest';
import type { BracketEstimation } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { bracketPodLine } from './bracket-pod-line';

const scepter = ["Magistrate's Scepter", 'Ichormoon Gauntlet'];

function est(
  over: Partial<BracketEstimation['breakdown']>,
  floors = [] as BracketEstimation['hardFloors'],
  bracket: BracketEstimation['bracket'] = 3
): BracketEstimation {
  return {
    bracket,
    label: '',
    hardFloors: floors,
    softScore: 20,
    breakdown: {
      gameChangerCount: 0,
      gameChangerNames: [],
      massLandDenialCount: 0,
      massLandDenialNames: [],
      extraTurnCount: 0,
      extraTurnNames: [],
      twoCardComboCount: 0,
      multiCardComboCount: 0,
      fastManaCount: 0,
      fastManaNames: [],
      tutorCount: 0,
      tutorNames: [],
      staxPieceCount: 0,
      staxPieceNames: [],
      averageCmc: 3,
      interactionCount: 0,
      ...over,
    },
  };
}

const atraxa = est(
  {
    gameChangerCount: 2,
    gameChangerNames: ['Farewell', 'Narset, Parter of Veils'],
    twoCardComboCount: 4,
    multiCardComboCount: 2,
    extraTurnCount: 3,
  },
  [
    {
      bracket: 4,
      reason: 'rated',
      ruthlessCombos: [scepter, ["Magistrate's Scepter", 'Viral Drake']],
    },
    { bracket: 3, reason: '2 Game Changer cards' },
  ],
  4
);

describe('bracketPodLine', () => {
  it('names the borderline, the Game Changers and the deciding combo', () => {
    expect(bracketPodLine(atraxa, null, 3)).toBe(
      "Bracket 4 (Optimized), borderline 3. 2 Game Changers: Farewell, Narset, Parter of Veils. Infinite combos: Magistrate's Scepter + Ichormoon Gauntlet and 5 more. 3 extra turn cards. No mass land denial."
    );
  });

  it("speaks in the owner's voice when their bracket differs from the estimate", () => {
    expect(bracketPodLine(atraxa, 3, 3)).toMatch(
      /^I play this at Bracket 3; the app estimates 4\. /
    );
  });

  it('reads the stated bracket plainly when it matches the estimate', () => {
    expect(bracketPodLine(atraxa, 4, null)).toMatch(/^Bracket 4 \(Optimized\)\. /);
  });

  it('says what a clean deck does not run', () => {
    const clean = est({ gameChangerCount: 1, gameChangerNames: ['Rhystic Study'] }, [
      { bracket: 3, reason: '1 Game Changer card' },
    ]);
    expect(bracketPodLine(clean, null, null)).toBe(
      'Bracket 3 (Upgraded). 1 Game Changer: Rhystic Study. No infinite combos, no mass land denial, no extra turns.'
    );
  });

  it('counts combos without naming one when no single rating decides it', () => {
    const line = bracketPodLine(est({ twoCardComboCount: 1 }), null, null);
    expect(line).toContain('1 infinite combo.');
    expect(line).toContain('No Game Changers, no mass land denial, no extra turns.');
  });

  it('mentions stax only when stax sets a floor', () => {
    const stax = est({ staxPieceCount: 3 }, [{ bracket: 3, reason: '3 stax / lock pieces' }]);
    expect(bracketPodLine(stax, null, null)).toContain('3 stax pieces.');
    expect(bracketPodLine(est({ staxPieceCount: 1 }), null, null)).not.toContain('stax');
  });
});
