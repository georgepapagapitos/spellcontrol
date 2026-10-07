// @vitest-environment node
//
// Guard (E540 S7): Coach scores its moves with the whole-deck objective, and the
// objective's combos term used to pay every complete line, so a Coach add that
// completed a loop making only mana and blinks (Commander Spellbook
// 864-2596-4050: Living Death + Eternal Witness + Phyrexian Altar) read as a
// combo win, against the rule Coach's combo rows and Next best move follow
// (`comboEndsGame`, E437). Coach's context now credits only game-ending lines.
// Meren's real page and cards come from the objective fixture.
import { describe, expect, it } from 'vitest';
import { combosTerm } from '@/deck-builder/services/deckBuilder/deckObjective/terms/combos';
import {
  FIX,
  MEREN,
  cards,
} from '@/deck-builder/services/deckBuilder/deckObjective/__fixtures__/objectiveFixture';
import type { DetectedCombo, ScryfallCard } from '@/deck-builder/types';
import { buildCoachObjective } from './coach-objective';

const loop: DetectedCombo = {
  comboId: '864-2596-4050',
  cards: ['Living Death', 'Eternal Witness', 'Phyrexian Altar'],
  results: [
    'Infinite blinking',
    'Infinite colored mana',
    'Infinite death triggers',
    'Infinite creature ETB',
    'Infinite creature LTB',
    'Infinite creature sacrifice triggers',
  ],
  isComplete: true,
  missingCards: [],
  deckCount: 9794,
  bracket: null,
  bracketTag: null,
  cardCount: 3,
};

function objectiveFor(deckCards: readonly ScryfallCard[], combos: DetectedCombo[]) {
  const o = buildCoachObjective({
    deck: {
      format: 'commander',
      commander: MEREN,
      partnerCommander: null,
      cards: deckCards.map((c, i) => ({ slotId: String(i), card: c, allocatedCopyId: null })),
      generationContext: {
        selectedThemes: [],
        targetBracket: 'all',
        landCount: 37,
        collectionMode: false,
        customization: { deckFormat: 99, currency: 'USD' },
      },
      bracketOverride: null,
    },
    rows: new Map(Object.entries(FIX.merenPage)),
    roleTargets: FIX.meren.roleTargets,
    combos,
    pacing: FIX.meren.pacing,
  });
  if (!o.ok) throw new Error(o.reason);
  return o;
}

describe("Coach's objective credits only combos that end the game", () => {
  it('a loop that only makes mana and blinks earns no combo credit', () => {
    const deckCards = cards(...loop.cards, 'Swamp');
    const o = objectiveFor(deckCards, [loop]);
    expect(o.ctx.comboCredit).toBe('wins');
    expect(combosTerm(o.deck, o.ctx).value).toBe(0);
  });

  it('a line that wins still pays', () => {
    const druid = FIX.hermitDruidCombo;
    const deckCards = cards(...druid.cards, ...loop.cards);
    const o = objectiveFor(deckCards, [druid, loop]);
    const v = combosTerm(o.deck, o.ctx);
    expect(v.value).toBeGreaterThan(0);
    expect(v.cards.map((c) => c.name).sort()).toEqual(['Hermit Druid', "Thassa's Oracle"]);
  });
});
