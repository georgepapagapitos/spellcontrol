// Guard (T171 lane M): Coach respects the deck's own settings. Lane L's
// harness counted 246 owned-share, 70 over-budget and 28 over-rarity moves a
// user who kept their settings had to skip. Rows are built with the product's
// adapters from real cards (Scryfall 2026-09-29).
import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';
import { COACH_CARDS } from '@/deck-builder/services/deckBuilder/__fixtures__/coach-cards.fixtures';
import { fromComboCompletion, fromGapCard, fromLandUpgradeMove } from './deck-change';
import {
  coachDeckSettings,
  combosThatFit,
  cutKeepsSettings,
  fitsSettings,
  gapsThatFit,
  settingsBreak,
  settingsChecker,
  type CoachDeckSettings,
  type SettingsFitDeck,
} from './deck-settings-fit';

const real = (name: string): ScryfallCard => ({ ...COACH_CARDS[name] });
const gapRow = (name: string, owned = false) =>
  fromGapCard(
    {
      name,
      price: COACH_CARDS[name].prices?.usd ?? null,
      rarity: COACH_CARDS[name].rarity,
      inclusion: 40,
      synergy: 0,
      typeLine: COACH_CARDS[name].type_line,
    },
    owned ? 'owned' : 'unowned'
  );

const open: CoachDeckSettings = {
  maxCardPrice: null,
  deckBudget: null,
  maxRarity: null,
  collectionStrategy: null,
  collectionOwnedPercent: 75,
  ignoreOwnedBudget: false,
  ignoreOwnedRarity: false,
  maxGameChangers: Infinity,
};
const deckOf = (names: string[], owned: string[] = [], full = true): SettingsFitDeck => ({
  cards: names.map(real),
  isOwned: (n) => owned.includes(n),
  full,
});
// Harmonize $0.25, Murder $0.22, Doom Blade $0.27, Beast Within $0.62: a $1.36 deck.
const cheapDeck = ['Harmonize', 'Murder', 'Doom Blade', 'Beast Within'];

describe('coachDeckSettings', () => {
  it('reads nothing into a hand-built deck with no target', () => {
    expect(coachDeckSettings({ generationContext: null, bracketOverride: null })).toBeNull();
  });

  it("reads a generated deck's saved customization, and the stated bracket over the built one", () => {
    const settings = coachDeckSettings({
      generationContext: {
        selectedThemes: [],
        targetBracket: 4,
        landCount: 37,
        collectionMode: true,
        customization: {
          deckBudget: 75,
          maxRarity: 'uncommon',
          collectionMode: true,
          collectionStrategy: 'partial',
          collectionOwnedPercent: 50,
          gameChangerLimit: 'unlimited',
        },
      },
      bracketOverride: 2,
    });
    expect(settings).toMatchObject({
      deckBudget: 75,
      maxRarity: 'uncommon',
      collectionStrategy: 'partial',
      collectionOwnedPercent: 50,
      maxGameChangers: 0,
    });
  });
});

describe('settingsBreak', () => {
  it('hides an unowned card from a deck built only from the collection', () => {
    const s = { ...open, collectionStrategy: 'full' as const };
    expect(settingsBreak(gapRow('Swords to Plowshares'), s, deckOf(cheapDeck))).toBe('unowned');
    expect(settingsBreak(gapRow('Swords to Plowshares', true), s, deckOf(cheapDeck))).toBeNull();
  });

  it("keeps a partial deck's owned share: an all-owned deck must cut an owned card", () => {
    const s = { ...open, collectionStrategy: 'partial' as const, collectionOwnedPercent: 80 };
    // Four of four spells owned; a full deck cuts one to add an unowned card: 3 of 4.
    const deck = deckOf(cheapDeck, cheapDeck);
    expect(settingsBreak(gapRow('Swords to Plowshares'), s, deck)).toBe('owned-share');
    // Owned basics and lands don't count toward the share.
    expect(settingsBreak(gapRow('Overgrown Tomb'), s, deck)).toBeNull();
  });

  // T171 round 3: an Arcane Signet at 57% was hidden from a 50%-owned Lathril
  // deck on its floor, though cutting one of its unowned cards keeps the share.
  it('lets an unowned add in when the deck holds an unowned card to cut, and the prompt offers only that', () => {
    const s = { ...open, collectionStrategy: 'partial' as const, collectionOwnedPercent: 75 };
    // Three of four spells owned (75%): Beast Within is the unowned one.
    const deck = deckOf(cheapDeck, ['Harmonize', 'Murder', 'Doom Blade']);
    expect(settingsBreak(gapRow('Swords to Plowshares'), s, deck)).toBeNull();
    const cutFits = cutKeepsSettings(fitsSettings(settingsChecker(s, deck)), {
      name: 'Swords to Plowshares',
    })!;
    expect(cutFits(real('Beast Within'))).toBe(true);
    expect(cutFits(real('Harmonize'))).toBe(false);
  });

  it('holds the price cap and the budget, with the incoming price from the row', () => {
    const capped = { ...open, maxCardPrice: 5 };
    expect(settingsBreak(gapRow('The One Ring'), capped, deckOf(cheapDeck))).toBe(
      'over-card-price'
    );
    expect(settingsBreak(gapRow('Swords to Plowshares'), capped, deckOf(cheapDeck))).toBeNull();
    const budget = { ...open, deckBudget: 2 };
    expect(settingsBreak(gapRow('Swords to Plowshares'), budget, deckOf(cheapDeck))).toBe(
      'over-budget'
    );
  });

  it('hides a card with no price from a deck with a budget or a price cap (T171 re-gate)', () => {
    // Overgrown Tomb's oracle printing carries no USD price; read as free, it
    // took a $75 deck to about $92.
    const unpriced = fromGapCard(
      { name: 'Overgrown Tomb', price: null, inclusion: 40, synergy: 0, typeLine: 'Land' },
      'unowned'
    );
    expect(settingsBreak(unpriced, { ...open, deckBudget: 75 }, deckOf(cheapDeck))).toBe(
      'unpriced'
    );
    expect(settingsBreak(unpriced, { ...open, maxCardPrice: 10 }, deckOf(cheapDeck))).toBe(
      'unpriced'
    );
    expect(settingsBreak(unpriced, { ...open, maxRarity: 'rare' }, deckOf(cheapDeck))).toBeNull();
  });

  it('lets an owned card through the budget when owned cards are free', () => {
    const s = { ...open, deckBudget: 2, ignoreOwnedBudget: true };
    expect(settingsBreak(gapRow('The One Ring', true), s, deckOf(cheapDeck))).toBeNull();
  });

  it('holds the rarity cap, basics exempt', () => {
    const s = { ...open, maxRarity: 'uncommon' as const };
    expect(settingsBreak(gapRow('Fierce Guardianship'), s, deckOf(cheapDeck))).toBe('over-rarity');
    expect(settingsBreak(gapRow('Swords to Plowshares'), s, deckOf(cheapDeck))).toBeNull();
  });

  it('holds the Game Changer limit, by name, a swap trading one for one', () => {
    const s = { ...open, maxGameChangers: 1 };
    const deck = deckOf([...cheapDeck, 'Rhystic Study']);
    expect(settingsBreak(gapRow('The One Ring'), s, deck)).toBe('over-game-changers');
  });

  it('reads a swap price from the card it carries (a land upgrade)', () => {
    const tomb = fromLandUpgradeMove(
      {
        outName: 'Swamp',
        outCard: real('Swamp'),
        inName: 'Overgrown Tomb',
        // The oracle bulk carries no USD price for it; a shockland's usual one.
        inCard: { ...real('Overgrown Tomb'), prices: { usd: '17.50' } },
        owned: false,
        reason: '',
        outScore: 10,
        inScore: 58,
        fixesShortColors: [],
        addsColors: ['G'],
      },
      'unowned'
    );
    const s = { ...open, maxCardPrice: 5 };
    expect(settingsBreak(tomb, s, deckOf([...cheapDeck, 'Swamp']))).toBe('over-card-price');
  });

  it("reads a combo piece's price from the analysis when the row carries none", () => {
    const combo = {
      combo: {
        id: 'c',
        produces: ['Infinite mana'],
        popularity: 1,
        cards: [
          { oracleId: 'a', cardName: 'Mind Stone', quantity: 1 },
          { oracleId: 'b', cardName: 'The One Ring', quantity: 1 },
        ],
      },
      presentOracleIds: ['a'],
      missingOracleIds: ['b'],
    } as unknown as ComboMatch;
    const row = fromComboCompletion(combo, 'The One Ring', 'unowned');
    const s = { ...open, maxCardPrice: 5 };
    const deck = {
      ...deckOf(cheapDeck),
      cardData: (n: string) =>
        n === 'The One Ring'
          ? { price: COACH_CARDS['The One Ring'].prices?.usd ?? null }
          : undefined,
    };
    // Without the analysis' price, a price-capped deck can't show it fits.
    expect(settingsBreak(row, s, deckOf(cheapDeck))).toBe('unpriced');
    expect(settingsBreak(row, s, deck)).toBe('over-card-price');
    const fit = fitsSettings(settingsChecker(s, deck));
    expect(combosThatFit([combo], fit, () => 'unowned')).toEqual([]);
  });
});

describe('gapsThatFit', () => {
  it("drops the hero's staple picks the settings rule out, and keeps all without settings", () => {
    const gaps = [
      { name: 'The One Ring', price: '115.29', inclusion: 30, synergy: 0, typeLine: 'Artifact' },
      { name: 'Murder', price: '0.25', inclusion: 20, synergy: 0, typeLine: 'Instant' },
    ];
    const fit = fitsSettings(settingsChecker({ ...open, maxCardPrice: 5 }, deckOf(cheapDeck)));
    expect(gapsThatFit(gaps, fit, () => 'unowned')?.map((g) => g.name)).toEqual(['Murder']);
    expect(gapsThatFit(gaps, undefined, () => 'unowned')).toBe(gaps);
  });
});
