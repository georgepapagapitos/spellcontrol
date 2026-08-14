import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { ScryfallCard, DeckCategory } from '@/deck-builder/types';

vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardRole: () => null,
  validateCardRole: () => null,
  isProtectionPiece: () => false,
  isFreeInteraction: () => false,
}));

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCachedCard: (name: string) => basic(name),
  getCardByName: async (name: string) => basic(name),
}));

import { runLandDeficitTopUp, runLastResortLandFill, type LandTopUpContext } from './landTopUp';
import { smartTrimPhase } from './phaseSmartTrim';
import { countAllCards } from './state';
import type { GenerationState } from './state';

function basic(name: string): ScryfallCard {
  return {
    id: `basic-${name}`,
    oracle_id: `basic-${name}`,
    name,
    cmc: 0,
    type_line: 'Basic Land',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
  } as ScryfallCard;
}

function card(name: string): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 1,
    type_line: 'Creature',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
  } as ScryfallCard;
}

function emptyCategories(): Record<DeckCategory, ScryfallCard[]> {
  return {
    lands: [],
    ramp: [],
    cardDraw: [],
    singleRemoval: [],
    boardWipes: [],
    creatures: [],
    synergy: [],
    utility: [],
  };
}

describe('runLandDeficitTopUp', () => {
  it('adds exactly the land deficit, split across the color identity', async () => {
    const ctx: LandTopUpContext = { colorIdentity: ['G', 'W', 'U'], categories: emptyCategories() };
    ctx.categories.lands = Array.from({ length: 33 }, (_, i) => card(`Land${i}`));
    await runLandDeficitTopUp(ctx, 35);
    expect(ctx.categories.lands).toHaveLength(35);
  });

  it('is a no-op at or above the land target', async () => {
    const ctx: LandTopUpContext = { colorIdentity: ['G'], categories: emptyCategories() };
    ctx.categories.lands = Array.from({ length: 35 }, (_, i) => card(`Land${i}`));
    await runLandDeficitTopUp(ctx, 35);
    expect(ctx.categories.lands).toHaveLength(35);
  });
});

describe('runLastResortLandFill', () => {
  it('never adds to a deck already at target size', async () => {
    const ctx: LandTopUpContext = { colorIdentity: ['G'], categories: emptyCategories() };
    expect(await runLastResortLandFill(ctx, 99, 99)).toBe(0);
    expect(ctx.categories.lands).toHaveLength(0);
  });
});

// Regression for the "2 cards over the Commander limit (99)" generation
// failure: generateLands under-delivered lands (e.g. the owned-basics cap in
// "Available only" collection mode) while the nonland passes overshot. The
// top-up used to run AFTER Smart Trim — the trim brought the deck to exactly
// targetDeckSize, then the land-count-gated top-up pushed basics on top with
// no total-count awareness, shipping an over-size deck the generation gate
// rejected. Topping up BEFORE the trim lets the trim reconcile the surplus
// while its land budget protects the freshly added basics.
describe('land top-up before Smart Trim (over-size regression)', () => {
  it('lands under target + nonland overshoot converges to exact deck size', async () => {
    const categories = emptyCategories();
    categories.lands = Array.from({ length: 33 }, (_, i) => card(`Land${i}`));
    categories.creatures = Array.from({ length: 70 }, (_, i) => card(`Creature${i}`));
    const state = {
      categories,
      comboCardNames: new Set<string>(),
      currentRoleCounts: { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 },
    } as unknown as GenerationState;
    const ctx: LandTopUpContext = { colorIdentity: ['G', 'W', 'U'], categories };

    // The orchestrator's order (deckGenerator.ts): top-up, then trim.
    await runLandDeficitTopUp(ctx, 35);
    smartTrimPhase(state, { targetDeckSize: 99, landTarget: 35, roleTargets: null });

    expect(countAllCards(state)).toBe(99);
    expect(categories.lands).toHaveLength(35);
  });

  it('deckGenerator orchestrates the top-up before the trim', () => {
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '..', 'deckGenerator.ts'),
      'utf8'
    );
    const topUp = src.indexOf('await runLandDeficitTopUp(landTopUpCtx');
    const trim = src.indexOf('smartTrimPhase(state');
    expect(topUp).toBeGreaterThan(-1);
    expect(trim).toBeGreaterThan(-1);
    expect(topUp).toBeLessThan(trim);
  });
});
