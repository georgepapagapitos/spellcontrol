// Guard (E437): Coach's "Next best move" ranked "Add Hullbreaker Horror,
// completes Sol Ring -> infinite colorless mana" #3 on an Atraxa infect deck.
// Spellbook tags that loop E (it never ends the game) and Hullbreaker is an
// off-plan seven-drop there. A combo completion earns combo rank only when the
// loop wins; otherwise the card competes on its ordinary fit. The records below
// are real Commander Spellbook variants (backend.commanderspellbook.com,
// fetched 2026-10-06), not author-written.
import { describe, it, expect } from 'vitest';
import type { ComboMatch } from '@/types/combos';
import { buildNextBestMoves } from '@/deck-builder/services/deckBuilder/nextBestMove';
import { comboEndsGame } from '@/deck-builder/services/winConditions/detect';
import { buildCoachChanges } from './coach-changes';
import { rankCoachMoves, type CoachContext } from './coach-rank';

const HULLBREAKER = 'd4a84e78-d9b9-4c67-8a4b-4329e65f0f15';
const SOL_RING = '6ad8011d-3471-4369-9d68-b264cc027487';
const ORACLE = '1de1b591-a73f-4974-b507-8c63e07a0868';
const CONSULTATION = '9a1412db-45ad-46ea-8f12-a85d203113d8';

/** Spellbook variant 513-5034--46, tag E: loops, never ends the game. */
const hullbreakerSolRing: ComboMatch = {
  combo: {
    id: '513-5034--46',
    identity: 'U',
    produces: ['Infinite colorless mana', 'Infinite storm count'],
    prerequisites: null,
    description: null,
    manaNeeded: '',
    popularity: 356633,
    cardCount: 2,
    bracket: null,
    bracketTag: 'E',
    cards: [
      { oracleId: HULLBREAKER, cardName: 'Hullbreaker Horror', quantity: 1 },
      { oracleId: SOL_RING, cardName: 'Sol Ring', quantity: 1 },
    ],
  },
  presentOracleIds: [SOL_RING],
  missingOracleIds: [HULLBREAKER],
};

/** Spellbook variant 742-1295, tag R: wins the game. */
const oracleConsultation: ComboMatch = {
  combo: {
    id: '742-1295',
    identity: 'UB',
    produces: ['Exile your library', 'Win the game'],
    prerequisites: null,
    description: null,
    manaNeeded: '{U}{U}{B}',
    popularity: 149032,
    cardCount: 2,
    bracket: null,
    bracketTag: 'R',
    cards: [
      { oracleId: CONSULTATION, cardName: 'Demonic Consultation', quantity: 1 },
      { oracleId: ORACLE, cardName: "Thassa's Oracle", quantity: 1 },
    ],
  },
  presentOracleIds: [ORACLE],
  missingOracleIds: [CONSULTATION],
};

const ctx: CoachContext = {
  roleCounts: {},
  roleTargets: {},
  deckSize: 99,
  deckTarget: 99,
  bracketOverridePresent: false,
  ownedNames: new Set(['Hullbreaker Horror', 'Demonic Consultation']),
};

const rank = (oneAwayCombos: ComboMatch[]) =>
  rankCoachMoves(
    buildCoachChanges(
      { gaps: [], synergy: [], substitutes: [], oneAwayCombos },
      () => 'owned',
      new Set()
    ),
    ctx
  );

describe('combo completions rank only when the loop wins (E437)', () => {
  it('reads the real records the way Spellbook does', () => {
    expect(comboEndsGame(hullbreakerSolRing.combo.produces)).toBe(false);
    expect(comboEndsGame(oracleConsultation.combo.produces)).toBe(true);
  });

  it('Next best move skips Hullbreaker Horror + Sol Ring', () => {
    const moves = buildNextBestMoves({
      roleCounts: {},
      roleTargets: {},
      cardCount: 99,
      deckTarget: 99,
      oneAwayCombos: [hullbreakerSolRing],
    });
    expect(moves.map((m) => m.cardName)).not.toContain('Hullbreaker Horror');
  });

  it('Next best move keeps a game-winning two-card combo', () => {
    const moves = buildNextBestMoves({
      roleCounts: {},
      roleTargets: {},
      cardCount: 99,
      deckTarget: 99,
      oneAwayCombos: [hullbreakerSolRing, oracleConsultation],
    });
    expect(moves.map((m) => m.cardName)).toEqual(['Demonic Consultation']);
  });

  it('the feed never gives an owned non-winning loop combo tier 2', () => {
    const ranked = rank([hullbreakerSolRing]);
    expect(ranked.find((r) => r.change.name === 'Hullbreaker Horror')).toBeUndefined();
  });

  it('the feed keeps an owned game-winning completion at combo tier 2', () => {
    const ranked = rank([hullbreakerSolRing, oracleConsultation]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].change.name).toBe('Demonic Consultation');
    expect(ranked[0].tier).toBe(2);
  });
});
