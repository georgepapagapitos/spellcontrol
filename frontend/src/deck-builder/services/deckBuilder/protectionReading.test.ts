// @vitest-environment node
//
// E555: one reading of "protects something" for the build report, the E532
// survival rule and the deck objective. Snakeskin Veil names its target in one
// sentence and the keyword in the next, so the tagger's single-sentence regex
// missed it and the report's protectionCount read 0 for a deck holding it.
// Oracle text is Scryfall's, verbatim.
import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { isProtectionPiece } from '@/deck-builder/services/tagger/client';
import { countProtectionPieces } from './commanderDeckAnalysis';
import { isSurvivalPiece as generatorSurvival } from './deckGeneration/protectionPicks';
import { isSurvivalPiece as objectiveSurvival } from './deckObjective/factsReading';
import { protectionValue } from './deckObjective/terms/interaction';
import {
  card as fixtureCard,
  MEREN,
  merenCtx,
} from './deckObjective/__fixtures__/objectiveFixture';

function real(name: string, type_line: string, oracle_text: string): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 1,
    type_line,
    oracle_text,
    color_identity: ['G'],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
  };
}

const SNAKESKIN = real(
  'Snakeskin Veil',
  'Instant',
  "Put a +1/+1 counter on target creature you control. It gains hexproof until end of turn. (It can't be the target of spells or abilities your opponents control.)"
);
const GAEAS_GIFT = real(
  "Gaea's Gift",
  'Instant',
  'Put a +1/+1 counter on target creature you control. It gains reach, trample, hexproof, and indestructible until end of turn. (It can\'t be the target of spells or abilities your opponents control. Damage and effects that say "destroy" don\'t destroy it.)'
);
const SMITE = real(
  'Smite the Deathless',
  'Instant',
  'Smite the Deathless deals 3 damage to target creature. That creature loses indestructible until end of turn. If that creature would die this turn, exile it instead.'
);
const ctx = merenCtx();

describe('a grant whose target is named in the sentence before', () => {
  it('is a protection piece, and the report counts it', () => {
    expect(isProtectionPiece(SNAKESKIN)).toBe(true);
    expect(isProtectionPiece(GAEAS_GIFT)).toBe(true);
    const deck = [SNAKESKIN, fixtureCard('Lightning Greaves'), fixtureCard('Sol Ring')];
    expect(countProtectionPieces(deck)).toBe(2);
  });

  it('is not read into text that removes a keyword', () => {
    expect(isProtectionPiece(SMITE)).toBe(false);
  });

  it('is a survival piece to the generator and to the objective alike', () => {
    for (const c of [SNAKESKIN, GAEAS_GIFT]) {
      expect(generatorSurvival(c), c.name).toBe(true);
      expect(objectiveSurvival(c, ctx.factsOf(c), [MEREN]), c.name).toBe(true);
    }
    expect(generatorSurvival(SMITE)).toBe(false);
  });

  it('is valued by the objective as protection', () => {
    expect(protectionValue(SNAKESKIN, ctx.factsOf(SNAKESKIN))).toBeGreaterThan(0);
  });
});

describe('the two survival rules agree on real cards', () => {
  it.each([
    ['Lightning Greaves', true],
    ["Teferi's Protection", true],
    ['Selfless Safewright', true],
    ['Fierce Guardianship', false],
    ['Deflecting Swat', false],
    ['Kaito Shizuki', false],
  ])('%s', (name, expected) => {
    const c = fixtureCard(name);
    expect(generatorSurvival(c), 'generator').toBe(expected);
    expect(objectiveSurvival(c, ctx.factsOf(c), []), 'objective').toBe(expected);
  });
});
