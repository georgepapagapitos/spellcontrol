import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import {
  getWipeScope,
  isColoredOnlyWipe,
  isOneSidedWipe,
} from '@/deck-builder/services/tagger/client';
import {
  isOptionalSweep,
  wipeKeepPenalty,
  wipeQualityPenalty,
  type WipeKeepContext,
} from './wipeTieBreaks';
import { STAPLE_INCLUSION_BAR } from './roleCapAllowance';

// Real Scryfall type lines and oracle text (E1002). Ugin, the Spirit Dragon is 50.6% of
// Emrakul's Eldrazi decks, Toxic Deluge 42.9% of Obeka's Wheels decks.
const card = (name: string, type_line: string, oracle_text: string) =>
  ({ name, type_line, oracle_text }) as ScryfallCard;

const UGIN = card(
  'Ugin, the Spirit Dragon',
  'Legendary Planeswalker — Ugin',
  "+2: Ugin deals 3 damage to any target.\n−X: Exile each permanent with mana value X or less that's one or more colors.\n−10: You gain 7 life, draw seven cards, then put up to seven permanent cards from your hand onto the battlefield."
);
const ELSPETH = card(
  "Elspeth, Sun's Champion",
  'Legendary Planeswalker — Elspeth',
  '+1: Create three 1/1 white Soldier creature tokens.\n−3: Destroy all creatures with power 4 or greater.\n−7: You get an emblem with "Creatures you control get +2/+2 and have flying."'
);
const DELUGE = card(
  'Toxic Deluge',
  'Sorcery',
  'As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn.'
);
const ALL_IS_DUST = card(
  'All Is Dust',
  'Kindred Sorcery — Eldrazi',
  'Each player sacrifices all permanents they control that are one or more colors.'
);
const MASSACRE_WURM = card(
  'Massacre Wurm',
  'Creature — Phyrexian Wurm',
  'When this creature enters, creatures your opponents control get -2/-2 until end of turn.\nWhenever a creature an opponent controls dies, that player loses 2 life.'
);

const targets = { artifact: 10, enchantment: 5 };
const keep = (colorlessDeck: boolean): WipeKeepContext => ({
  stapleBar: STAPLE_INCLUSION_BAR,
  colorlessDeck,
  isOneSidedWipe,
  isColoredOnlyWipe,
  getWipeScope,
  deckTypeTargets: targets,
});
const penalty = (c: ScryfallCard, inclusion: number | undefined, colorlessDeck = false) =>
  wipeKeepPenalty(c, inclusion, keep(colorlessDeck));

describe('isOptionalSweep', () => {
  it('reads a planeswalker, not a sorcery or a creature with a sweeping trigger', () => {
    expect(isOptionalSweep(UGIN)).toBe(true);
    expect(isOptionalSweep(ELSPETH)).toBe(true);
    expect(isOptionalSweep(DELUGE)).toBe(false);
    expect(isOptionalSweep(ALL_IS_DUST)).toBe(false);
    // The sweep is mandatory when the creature enters, so the cap prices it like a spell.
    expect(isOptionalSweep(MASSACRE_WURM)).toBe(false);
  });

  it('reads a transforming card by its front face', () => {
    const dfc = {
      name: 'Test // Test',
      type_line: 'Creature // Legendary Planeswalker',
      card_faces: [{ type_line: 'Creature — Human' }, { type_line: 'Legendary Planeswalker' }],
    } as unknown as ScryfallCard;
    expect(isOptionalSweep(dfc)).toBe(false);
  });
});

describe('wipeKeepPenalty', () => {
  it('prices the real Ugin text as a symmetric wipe without the plain penalty waiver', () => {
    expect(isOneSidedWipe(UGIN)).toBe(false);
    expect(wipeQualityPenalty(UGIN, isOneSidedWipe, getWipeScope, targets)).toBeGreaterThanOrEqual(
      1000
    );
  });

  it('waives the penalty for a planeswalker at the staple bar', () => {
    expect(penalty(UGIN, 50.6)).toBe(0);
    expect(penalty(ELSPETH, STAPLE_INCLUSION_BAR)).toBe(0);
  });

  it('keeps the penalty for a planeswalker the page does not play, or with no page entry', () => {
    expect(penalty(UGIN, STAPLE_INCLUSION_BAR - 0.1)).toBeGreaterThanOrEqual(1000);
    expect(penalty(ELSPETH, undefined)).toBeGreaterThanOrEqual(1000);
  });

  it('never waives it for a spell or a creature, whatever the page says', () => {
    expect(penalty(DELUGE, 42.9)).toBeGreaterThanOrEqual(1000);
    expect(penalty(ALL_IS_DUST, 94)).toBeGreaterThanOrEqual(1000);
    expect(penalty(MASSACRE_WURM, 60)).toBe(
      wipeQualityPenalty(MASSACRE_WURM, isOneSidedWipe, getWipeScope, targets)
    );
  });

  it('reads a colored-only sweep as clean in a colorless deck and only there', () => {
    expect(isColoredOnlyWipe(ALL_IS_DUST)).toBe(true);
    expect(isColoredOnlyWipe(UGIN)).toBe(true);
    expect(isColoredOnlyWipe(DELUGE)).toBe(false);
    expect(penalty(ALL_IS_DUST, 94, true)).toBe(0);
    expect(penalty(ALL_IS_DUST, 94, false)).toBeGreaterThanOrEqual(1000);
    // Toxic Deluge shrinks colorless creatures too.
    expect(penalty(DELUGE, 42.9, true)).toBeGreaterThanOrEqual(1000);
  });

  it('bills a colored-only sweep no artifact collateral, but still its enchantments', () => {
    expect(getWipeScope(ALL_IS_DUST)).toMatchObject({
      artifacts: false,
      enchantments: true,
      all: false,
    });
  });
});
