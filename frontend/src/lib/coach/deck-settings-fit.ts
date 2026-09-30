/**
 * Coach respects the deck's own settings.
 *
 * A generated deck saves every build setting (`generationContext.customization`):
 * a per-card price cap, a total budget, a rarity cap, a Game Changer limit, a
 * target bracket, and whether it was built from the collection and how
 * strictly. Coach used to read none of them, so it told a $75 deck to buy a
 * $40 card and an owned-only deck to acquire staples; T171 lane L counted 246
 * owned-share and 70 over-budget moves a user who kept their settings would
 * have had to skip. A move that breaks one of these settings is now not shown.
 *
 * The check reads the incoming card's price and rarity off the row (the
 * analysis stamps both: candidateCardData.ts). A missing rarity never hides a
 * move; a missing price does when the deck has a price cap or a budget, since
 * nothing shows the card fits it. An add to a full deck displaces a card
 * the user picks later, so the budget and owned-share checks assume the least
 * favorable one: nothing freed, an owned card out.
 */
import { useMemo } from 'react';
import {
  fromComboCompletion,
  fromGapCard,
  parsePrice,
  type Change,
  type ChangeOwnership,
} from './deck-change';
import type { ComboMatch } from '@/types/combos';
import type { SuggestionCardData } from '@/deck-builder/services/deckBuilder/candidateCardData';
import type {
  CollectionStrategy,
  Customization,
  GapAnalysisCard,
  MaxRarity,
  ScryfallCard,
  TargetBracket,
} from '@/deck-builder/types';
import type { Deck } from '@/store/decks';
import { getCardPrice, getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import { bracketCeilings } from '@/deck-builder/services/deckBuilder/bracketGuard';
import { isGameChangerName } from '@/deck-builder/services/deckBuilder/premiumCards';
import { isBasicLandName } from '@/lib/collection/allocations';

export interface CoachDeckSettings {
  maxCardPrice: number | null;
  deckBudget: number | null;
  maxRarity: MaxRarity;
  /** How the deck was built from the collection; null when it wasn't. */
  collectionStrategy: CollectionStrategy | null;
  /** Target share of owned nonland cards under the 'partial' strategy (25–100). */
  collectionOwnedPercent: number;
  ignoreOwnedBudget: boolean;
  ignoreOwnedRarity: boolean;
  /** Most Game Changers the deck may hold: its own limit, capped by its target bracket. */
  maxGameChangers: number;
}

export type SettingsBreak =
  | 'unowned'
  | 'owned-share'
  | 'over-card-price'
  | 'over-budget'
  | 'over-rarity'
  | 'over-game-changers'
  | 'unpriced';

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'mythic'];

/**
 * The settings Coach holds a deck to, or null when nothing constrains it. The
 * target bracket is the user's stated one when set (`bracketOverride`), else
 * the one the deck was built for.
 */
export function coachDeckSettings(
  deck: Pick<Deck, 'generationContext' | 'bracketOverride'> & {
    buildReport?: { collectionStrategy?: CollectionStrategy };
  }
): CoachDeckSettings | null {
  const gc = deck.generationContext;
  const c: Partial<Customization> = gc?.customization ?? {};
  const collectionMode = c.collectionMode ?? gc?.collectionMode ?? false;
  const builtFor = c.targetBracket ?? gc?.targetBracket;
  const target = (deck.bracketOverride ?? builtFor ?? 'all') as TargetBracket;
  const limit =
    c.gameChangerLimit === 'none'
      ? 0
      : typeof c.gameChangerLimit === 'number'
        ? c.gameChangerLimit
        : Infinity;
  const settings: CoachDeckSettings = {
    maxCardPrice: c.maxCardPrice ?? null,
    deckBudget: c.deckBudget ?? null,
    maxRarity: c.maxRarity ?? null,
    collectionStrategy: collectionMode
      ? (c.collectionStrategy ?? deck.buildReport?.collectionStrategy ?? 'full')
      : null,
    collectionOwnedPercent: c.collectionOwnedPercent ?? 75,
    ignoreOwnedBudget: !!c.ignoreOwnedBudget,
    ignoreOwnedRarity: !!c.ignoreOwnedRarity,
    maxGameChangers: Math.min(limit, bracketCeilings(target).gameChangers),
  };
  const constrained =
    settings.maxCardPrice != null ||
    settings.deckBudget != null ||
    settings.maxRarity != null ||
    (settings.collectionStrategy != null && settings.collectionStrategy !== 'prefer') ||
    Number.isFinite(settings.maxGameChangers);
  return constrained ? settings : null;
}

export interface SettingsFitDeck {
  /** The mainboard, one entry per copy. */
  cards: readonly ScryfallCard[];
  /** Whether the user owns a copy of `name` (allocated elsewhere or not). */
  isOwned(name: string): boolean;
  /** At its size limit: an add displaces a card the user picks when applying it. */
  full: boolean;
  /** The live Game Changers list, when fetched; the shared list is the floor. */
  gameChangerNames?: ReadonlySet<string>;
  /** Price and rarity for a card whose row carries neither (a combo's missing
   *  piece): the analysis' `suggestionCards`. */
  cardData?: (name: string) => SuggestionCardData | undefined;
}

function usd(card: ScryfallCard): number {
  return parsePrice(getCardPrice(card, 'USD')) ?? 0;
}

function isLand(card: ScryfallCard): boolean {
  return getFrontFaceTypeLine(card).toLowerCase().includes('land');
}

function incomingPrice(
  change: Change,
  out: ScryfallCard | undefined,
  data: SuggestionCardData | undefined
): number | undefined {
  if (change.card) return parsePrice(getCardPrice(change.card, 'USD')) ?? undefined;
  if (typeof change.deltaPrice !== 'number') return parsePrice(data?.price) ?? undefined;
  if (change.type === 'add') return change.deltaPrice;
  // A swap's delta is signed (the budget lane's is minus the savings).
  return out ? Math.max(0, usd(out) + change.deltaPrice) : undefined;
}

/** The first of the deck's settings `change` breaks, or null when it keeps them all. */
export function settingsBreak(
  change: Change,
  settings: CoachDeckSettings,
  deck: SettingsFitDeck
): SettingsBreak | null {
  if (change.type === 'cut') return null;
  const basic = isBasicLandName(change.name);
  const owned =
    basic ||
    (change.ownership !== undefined && change.ownership !== 'unowned') ||
    deck.isOwned(change.name);
  const out =
    change.type === 'swap' && change.inName
      ? deck.cards.find((c) => c.name === change.inName)
      : undefined;
  const incomingLand = /\bland\b/i.test(change.typeLine ?? change.card?.type_line ?? '');
  const data = deck.cardData?.(change.name);

  const strategy = settings.collectionStrategy;
  if (strategy === 'full' && !owned) return 'unowned';
  // 'available' fields only free copies: one committed to another deck won't do.
  if (strategy === 'available' && !basic && change.ownership !== 'owned') return 'unowned';
  if (strategy === 'partial' && !owned && !incomingLand) {
    const nonLand = deck.cards.filter((c) => !isLand(c));
    let ownedCount = nonLand.filter((c) => deck.isOwned(c.name)).length;
    let count = nonLand.length;
    const before = count === 0 ? 1 : ownedCount / count;
    if (out) {
      if (!isLand(out)) {
        count--;
        if (deck.isOwned(out.name)) ownedCount--;
      }
    } else if (deck.full && ownedCount === count && count > 0) {
      // Every card here is owned, so the cut is too. With an unowned card in
      // the deck, the replace prompt offers only cuts that keep the share
      // (cutKeepsSettings), so the add doesn't break it: an Arcane Signet at
      // 57% was hidden from a 50%-owned Lathril deck sitting on its floor
      // (T171 round 3).
      count--;
      ownedCount--;
    } else if (deck.full) {
      count--;
    }
    count++;
    const after = ownedCount / count;
    const target = settings.collectionOwnedPercent / 100;
    if (after < target && after < before) return 'owned-share';
  }

  const free = settings.ignoreOwnedBudget && owned;
  const price = incomingPrice(change, out, data);
  // Under a price cap or a budget, a card with no known price can't be shown
  // to fit: an unpriced printing read as free let three shocklands into a $75
  // deck (T171 re-gate). Basics are always affordable.
  const priced = settings.maxCardPrice != null || settings.deckBudget != null;
  if (priced && price === undefined && !free && !basic) return 'unpriced';
  if (price !== undefined && !free) {
    if (settings.maxCardPrice != null && price > settings.maxCardPrice) return 'over-card-price';
    if (settings.deckBudget != null) {
      const cost = (c: ScryfallCard) =>
        settings.ignoreOwnedBudget && deck.isOwned(c.name) ? 0 : usd(c);
      const total = deck.cards.reduce((s, c) => s + cost(c), 0);
      const after = total + price - (out ? cost(out) : 0);
      if (after > settings.deckBudget && after > total + 0.005) return 'over-budget';
    }
  }

  const rarity = change.rarity ?? change.card?.rarity ?? data?.rarity;
  if (settings.maxRarity && rarity && !basic && !(settings.ignoreOwnedRarity && owned)) {
    const cap = RARITY_ORDER.indexOf(settings.maxRarity);
    if (RARITY_ORDER.indexOf(rarity) > cap) return 'over-rarity';
  }

  if (Number.isFinite(settings.maxGameChangers)) {
    const gc = (name: string) => isGameChangerName(name, deck.gameChangerNames);
    if (change.isGameChanger || gc(change.name)) {
      const held = deck.cards.filter((c) => gc(c.name)).length - (out && gc(out.name) ? 1 : 0);
      if (held + 1 > settings.maxGameChangers) return 'over-game-changers';
    }
  }
  return null;
}

/** The setting a Coach row breaks, bound to one deck; undefined when nothing constrains it. */
export function settingsChecker(
  settings: CoachDeckSettings | null,
  deck: SettingsFitDeck
): ((change: Change) => SettingsBreak | null) | undefined {
  if (!settings) return undefined;
  return (change) => settingsBreak(change, settings, deck);
}

/**
 * The replace-when-full prompt's filter: false for a cut whose swap with the
 * incoming card would break one of the deck's settings (an owned card out of
 * a partial deck on its owned-share floor, say).
 */
export function cutKeepsSettings(
  fit: ((change: Change) => boolean) | undefined,
  add: ScryfallCard
): ((cut: ScryfallCard) => boolean) | undefined {
  if (!fit) return undefined;
  return (cut) =>
    fit({
      id: `swap:${cut.name}->${add.name}`,
      type: 'swap',
      lane: 'similar',
      name: add.name,
      card: add,
      inName: cut.name,
    });
}

/** A predicate over Coach rows: true when the move keeps the deck's settings. */
export function fitsSettings(
  check: ((change: Change) => SettingsBreak | null) | undefined
): ((change: Change) => boolean) | undefined {
  return check && ((change) => check(change) === null);
}

export interface CoachSettingsHooks {
  /** The setting a row breaks, or null; undefined when nothing constrains the deck. */
  check: ((change: Change) => SettingsBreak | null) | undefined;
  /** The same as a keep-or-drop predicate. */
  fit: ((change: Change) => boolean) | undefined;
  /** The replace prompt's cut filter for an incoming card (`cutKeepsSettings`). */
  cutFits: (add: ScryfallCard) => ((cut: ScryfallCard) => boolean) | undefined;
}

/** The deck page's check: the saved settings against the live deck and collection. */
export function useCoachSettings(
  deck: Deck | null | undefined,
  ownedNames: ReadonlySet<string>,
  mainboardLimit: number
): CoachSettingsHooks {
  const cards = deck?.cards;
  const suggestionCards = deck?.suggestionCards;
  // Only the settings' own inputs: a card edit doesn't change them.
  const generationContext = deck?.generationContext ?? null;
  const bracketOverride = deck?.bracketOverride;
  const collectionStrategy = deck?.buildReport?.collectionStrategy;
  const settings = useMemo(
    () =>
      coachDeckSettings({
        generationContext,
        bracketOverride,
        buildReport: { collectionStrategy },
      }),
    [generationContext, bracketOverride, collectionStrategy]
  );
  return useMemo(() => {
    const mainboard = (cards ?? []).map((c) => c.card);
    const check = settingsChecker(settings, {
      cards: mainboard,
      isOwned: (name) => ownedNames.has(name),
      full: mainboard.length >= mainboardLimit,
      cardData: (name) => suggestionCards?.[name],
    });
    const fit = fitsSettings(check);
    return { check, fit, cutFits: (add) => cutKeepsSettings(fit, add) };
  }, [settings, cards, ownedNames, mainboardLimit, suggestionCards]);
}

/** The gap staples the settings allow, for the Next-best-move hero's card picks. */
export function gapsThatFit<T extends GapAnalysisCard>(
  gaps: T[] | undefined,
  fit: ((change: Change) => boolean) | undefined,
  ownershipFor: (name: string) => ChangeOwnership
): T[] | undefined {
  if (!gaps || !fit) return gaps;
  return gaps.filter((g) => fit(fromGapCard(g, ownershipFor(g.name))));
}

/** The one-away combos whose missing piece the settings allow, for the hero. */
export function combosThatFit(
  combos: ComboMatch[] | undefined,
  fit: ((change: Change) => boolean) | undefined,
  ownershipFor: (name: string) => ChangeOwnership
): ComboMatch[] | undefined {
  if (!combos || !fit) return combos;
  return combos.filter((m) =>
    m.combo.cards
      .filter((c) => m.missingOracleIds.includes(c.oracleId))
      .every((c) => fit(fromComboCompletion(m, c.cardName, ownershipFor(c.cardName))))
  );
}
