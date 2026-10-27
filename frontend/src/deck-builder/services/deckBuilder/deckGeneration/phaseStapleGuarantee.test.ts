import { describe, it, expect, vi } from 'vitest';
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';

function card(name: string, price: string, typeLine = 'Artifact'): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 1,
    type_line: typeLine,
    color_identity: [],
    keywords: [],
    rarity: 'uncommon',
    set: 'tst',
    set_name: 'Test',
    prices: { usd: price },
    legalities: { commander: 'legal' },
  } as ScryfallCard;
}

// Real prices from the E1043 panel.
vi.mock('@/deck-builder/services/scryfall/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/deck-builder/services/scryfall/client')>();
  return {
    ...actual,
    getCardByName: vi.fn(async (name: string) =>
      name === 'Sol Ring' ? card('Sol Ring', '1.71') : card('Arcane Signet', '0.58')
    ),
  };
});

const ROLES: Record<string, string> = {
  'Sol Ring': 'ramp',
  'Fellwar Stone': 'ramp',
  'Mind Stone': 'ramp',
};
vi.mock('@/deck-builder/services/tagger/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/deck-builder/services/tagger/client')>()),
  getCardRole: (name: string) => ROLES[name] ?? null,
}));

// The keeper has its own tests; here it keeps exactly the card named 'Kept'.
vi.mock('./evictionKeeper', () => ({
  evictionKeeper: () => (c: ScryfallCard) => c.name === 'Kept',
}));

import { stapleGuaranteePhase } from './phaseStapleGuarantee';
import { BudgetTracker } from '../budgetTracker';
import type { GenerationState } from './state';

function edhrec(name: string, inclusion: number): EDHRECCard {
  return { name, id: name, inclusion } as unknown as EDHRECCard;
}

/** A finished one-color $25 deck that the build left without Sol Ring (Arcane Signet in). */
function finishedDeck(nonland: [string, number][]): GenerationState {
  const deck = nonland.map(([n]) => card(n, '0.50', 'Creature'));
  return {
    context: {
      commander: card('Commander', '1.00'),
      partnerCommander: null,
      colorIdentity: ['G'],
      customization: { mustIncludeCards: [], tempMustIncludeCards: [] },
    },
    cfg: {
      format: 99,
      maxCardPrice: null,
      maxRarity: null,
      maxCmc: null,
      arenaOnly: false,
      deckBudget: 25,
      currency: 'USD',
      ignoreOwnedBudget: false,
      ignoreOwnedRarity: false,
      collectionStrategy: 'full',
    },
    usedNames: new Set(['Arcane Signet', ...deck.map((c) => c.name)]),
    bannedCards: new Set<string>(),
    categories: {
      lands: [card('Forest', '0.00', 'Basic Land — Forest')],
      ramp: [card('Arcane Signet', '0.58')],
      cardDraw: [],
      singleRemoval: [],
      boardWipes: [],
      creatures: deck,
      synergy: [],
      utility: [],
    },
    currentCurveCounts: {},
    currentRoleCounts: { ramp: 1, removal: 0, boardwipe: 0, cardDraw: 0 },
    mustIncludeNames: [],
    mustIncludeSources: new Map(),
    edhrecData: { cardlists: { allNonLand: nonland.map(([n, i]) => edhrec(n, i)) } },
  } as unknown as GenerationState;
}

const names = (s: GenerationState) =>
  Object.values(s.categories)
    .flat()
    .map((c) => c.name);

describe('stapleGuaranteePhase (E1043)', () => {
  // At $25 the pacing cap fell under Sol Ring's $1.71 before the rock phase:
  // 6 of 10 commanders shipped without it and no note said so.
  it('swaps Sol Ring in for the weakest ramp card, disclosed, and books its price', async () => {
    const state = finishedDeck([
      ['Fellwar Stone', 34],
      ['Mind Stone', 12],
      ['Filler Creature', 2],
    ]);
    const tracker = new BudgetTracker(25, 99);
    tracker.remainingBudget = -1;

    const repairs = await stapleGuaranteePhase(state, tracker);

    // A ramp card leaves even though the filler creature is lower: the rock takes a ramp slot.
    expect(repairs).toEqual([expect.objectContaining({ cut: 'Mind Stone', added: 'Sol Ring' })]);
    expect(names(state)).toContain('Sol Ring');
    expect(names(state)).not.toContain('Mind Stone');
    expect(state.bannedCards.has('Mind Stone')).toBe(true);
    expect(state.currentRoleCounts.ramp).toBe(1);
    expect(tracker.remainingBudget).toBeCloseTo(-1 - 1.71);
  });

  it('changes nothing when the deck already has the staples', async () => {
    const state = finishedDeck([['Fellwar Stone', 34]]);
    state.usedNames.add('Sol Ring');
    const before = names(state);
    expect(await stapleGuaranteePhase(state, null)).toEqual([]);
    expect(names(state)).toEqual(before);
  });

  it("keeps out a rock the user's own limits rule out: max card price, or a fifth of a tiny budget", async () => {
    const capped = finishedDeck([['Mind Stone', 12]]);
    capped.cfg.maxCardPrice = 1;
    expect(await stapleGuaranteePhase(capped, null)).toEqual([]);

    const tiny = finishedDeck([['Mind Stone', 12]]);
    tiny.cfg.deckBudget = 5; // a fifth is $1.00
    expect(await stapleGuaranteePhase(tiny, null)).toEqual([]);
  });

  it('never cuts a kept card or a must-include; with nothing else to cut it leaves the deck alone', async () => {
    const state = finishedDeck([
      ['Kept', 1],
      ['Locked', 1],
    ]);
    state.context.customization.mustIncludeCards = ['Locked'];
    expect(await stapleGuaranteePhase(state, null)).toEqual([]);
    expect(names(state)).not.toContain('Sol Ring');
  });
});
