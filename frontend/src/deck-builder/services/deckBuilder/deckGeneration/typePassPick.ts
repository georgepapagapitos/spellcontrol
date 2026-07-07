// E68 phase 2 (mechanical split): the shared machinery behind generateDeckInner's
// six EDHREC-pool type passes (creature/instant/sorcery/artifact/enchantment/
// planeswalker). Extracted verbatim — see deckGenerator.ts's six call sites for
// everything that DIDN'T move here because it genuinely differs per pass:
//   - the unconditional "need X, pool has Y" debug log (planeswalker logs this
//     even when its own guard below skips the pick entirely)
//   - the planeswalker-only `pool.length > 0 && target > 0` guard
//   - the "got X from EDHREC" debug log — same text shape everywhere, but its
//     position relative to the categorization sink and the role/subtype bump
//     differs: creature logs it AFTER sink+bump, the other five log it BEFORE
//     (an existing quirk, not introduced by this split — preserved as-is)
//   - the categorization sink (creature pushes into categories.creatures
//     directly; instant/sorcery/artifact/enchantment go through
//     categorizeCards; planeswalker pushes into categories.utility directly)
//   - the creature-only immediate Scryfall top-up when the EDHREC pool falls
//     short of the ORIGINAL (pre-must-include-subtraction) target
import type { ScryfallCard, EDHRECCard, MaxRarity, CollectionStrategy } from '@/deck-builder/types';
import type { RoleKey, WipeScope } from '@/deck-builder/services/tagger/client';
import { pickFromPrefetchedWithCurve } from '../cardPicking';
import { computeRoleBoosts, stampRoleSubtypes } from '../categorize';
import { fillWithScryfall, type FillHardGates } from '../scryfallFill';
import type { BudgetTracker } from '../budgetTracker';
import type { BracketGuard } from '../bracketGuard';

/**
 * Everything the six EDHREC-pool type passes read (and, for the counters,
 * mutate) in common. Built ONCE in generateDeckInner right before the first
 * pass; the mutable counters/maps are shared BY REFERENCE across passes so
 * bookkeeping (currentRoleCounts, currentSubtypeCounts, currentCurveCounts,
 * gameChangerCount, roleCapOverflowCounts, priceSanityDecided,
 * wipeAsymmetryDecided) keeps accumulating exactly as the inline version did.
 */
export interface TypePassContext {
  cardMap: Map<string, ScryfallCard>;
  usedNames: Set<string>;
  colorIdentity: string[];
  curveTargets: Record<number, number>;
  currentCurveCounts: Record<number, number>;
  bannedCards: Set<string>;
  maxCardPrice: number | null;
  maxGameChangers: number;
  gameChangerCount: { value: number };
  maxRarity: MaxRarity;
  maxCmc: number | null;
  budgetTracker: BudgetTracker | null;
  collectionNames: Set<string> | undefined;
  currency: 'USD' | 'EUR';
  gameChangerNames: Set<string>;
  arenaOnly: boolean;
  strictCurve: boolean;
  collectionStrategy: CollectionStrategy;
  collectionOwnedPercent: number;
  ignoreOwnedBudget: boolean;
  ignoreOwnedRarity: boolean;
  bracketGuard?: BracketGuard;
  isCardAllowedBySynergyDependencies: (card: ScryfallCard) => boolean;
  liftTieBreak: Map<string, number>;
  priceSanity: boolean;
  priceSanityDecided: Set<string>;
  brewLevel: number;
  roleTargets: Record<RoleKey, number> | null;
  strictRoles: boolean;
  cardRoleMap: Map<string, RoleKey>;
  cardCmcMap: Map<string, number>;
  cardSubtypeMap: Map<string, string>;
  currentRoleCounts: Record<RoleKey, number>;
  currentSubtypeCounts: Record<string, number>;
  roleCapOverflowCounts: Partial<Record<RoleKey, number>>;
  preferAsymmetricWipes: boolean;
  wipeAsymmetryDecided: Set<string>;
  isOneSidedWipe: (card: ScryfallCard) => boolean;
  getWipeScope: (card: ScryfallCard) => WipeScope;
  typeTargets: Record<string, number>;
  getComboBoosts: () => Map<string, number>;
  withPackageBoosts: (boosts: Map<string, number>, pool: EDHRECCard[]) => Map<string, number>;
  onProgress?: (message: string, pct: number) => void;
}

/**
 * Runs the shared part of ONE EDHREC-pool type pass: onProgress → role-boost
 * computation → the prefetched-curve pick itself. Does NOT log "got X from
 * EDHREC", categorize the result, or bump role/subtype counts — those three
 * steps are sequenced differently per call site (see the file header) and
 * stay inline in deckGenerator.ts.
 */
export function pickEdhrecTypePass(
  ctx: TypePassContext,
  expectedType: string,
  pool: EDHRECCard[],
  target: number,
  progressMessage: string,
  progressPct: number
): ScryfallCard[] {
  ctx.onProgress?.(progressMessage, progressPct);
  const boosts = ctx.roleTargets
    ? computeRoleBoosts(
        ctx.cardRoleMap,
        ctx.roleTargets,
        ctx.currentRoleCounts,
        ctx.getComboBoosts(),
        ctx.cardCmcMap,
        ctx.cardSubtypeMap,
        ctx.currentSubtypeCounts,
        ctx.strictRoles
      )
    : ctx.getComboBoosts();
  return pickFromPrefetchedWithCurve(
    pool,
    ctx.cardMap,
    target,
    ctx.usedNames,
    ctx.colorIdentity,
    ctx.curveTargets,
    ctx.currentCurveCounts,
    ctx.bannedCards,
    expectedType,
    ctx.maxCardPrice,
    ctx.maxGameChangers,
    ctx.gameChangerCount,
    ctx.maxRarity,
    ctx.maxCmc,
    ctx.budgetTracker,
    ctx.collectionNames,
    ctx.withPackageBoosts(boosts, pool),
    ctx.currency,
    ctx.gameChangerNames,
    ctx.arenaOnly,
    ctx.strictCurve,
    ctx.collectionStrategy,
    ctx.collectionOwnedPercent,
    ctx.ignoreOwnedBudget,
    ctx.ignoreOwnedRarity,
    ctx.bracketGuard,
    ctx.isCardAllowedBySynergyDependencies,
    ctx.liftTieBreak,
    ctx.roleTargets
      ? {
          cardRoleMap: ctx.cardRoleMap,
          roleTargets: ctx.roleTargets,
          currentRoleCounts: ctx.currentRoleCounts,
          overflowCounts: ctx.roleCapOverflowCounts,
          isOneSidedWipe: ctx.preferAsymmetricWipes ? ctx.isOneSidedWipe : undefined,
          wipeAsymmetryDecided: ctx.wipeAsymmetryDecided,
          getWipeScope: ctx.getWipeScope,
          deckTypeTargets: ctx.typeTargets,
        }
      : undefined,
    ctx.priceSanity,
    ctx.getComboBoosts(),
    ctx.priceSanityDecided,
    ctx.brewLevel
  );
}

/**
 * The role/subtype bookkeeping loop repeated identically after every pass's
 * categorization sink. Caller decides WHEN to call this relative to its own
 * sink + "got X" log (see the file header — creature sequences this
 * differently from the other five).
 */
export function bumpRoleAndSubtypeCounts(ctx: TypePassContext, picked: ScryfallCard[]): void {
  for (const card of picked) {
    const role = ctx.cardRoleMap.get(card.name);
    if (role) {
      ctx.currentRoleCounts[role]++;
      card.deckRole = role;
      stampRoleSubtypes(card);
      const st = ctx.cardSubtypeMap.get(card.name);
      if (st) ctx.currentSubtypeCounts[st] = (ctx.currentSubtypeCounts[st] ?? 0) + 1;
    }
  }
}

/**
 * Everything the no-EDHREC-data Scryfall-only type-pass twins (creature/
 * artifact/enchantment/instant/sorcery — the "else" of the same branch the
 * six passes above belong to the "if" of) read in common. A `Pick` of
 * `TypePassContext`'s already-typed fields plus the three extra ones
 * `fillWithScryfall` needs that the EDHREC-pool passes don't — deliberately
 * NOT the full `TypePassContext`, since this branch runs when `cardRoleMap` /
 * `cardCmcMap` / `cardSubtypeMap` / `roleTargets` etc. were never built (no
 * EDHREC data means no role-boost machinery at all here).
 */
export type ScryfallFallbackContext = Pick<
  TypePassContext,
  | 'colorIdentity'
  | 'usedNames'
  | 'bannedCards'
  | 'maxCardPrice'
  | 'maxRarity'
  | 'maxCmc'
  | 'budgetTracker'
  | 'collectionNames'
  | 'currency'
  | 'arenaOnly'
  | 'collectionStrategy'
  | 'ignoreOwnedBudget'
  | 'ignoreOwnedRarity'
  | 'isCardAllowedBySynergyDependencies'
  | 'onProgress'
> & {
  /** The user's additional Scryfall filter (`state.cfg.scryfallQuery`,
   *  possibly relaxed by an alternative-pool generator) — passed to
   *  `fillWithScryfall` as its own `scryfallQuery` parameter, distinct from
   *  this function's `query` argument (the type-defining search). */
  scryfallQueryFilter: string;
  liftScoreOf: (name: string) => number;
  fillGates: FillHardGates;
};

/**
 * Runs ONE Scryfall-only fallback type pass: onProgress → `fillWithScryfall`.
 * Does NOT categorize the result or apply the (per-type, sometimes absent)
 * `target > 0` guard — both differ per call site; see each of the five call
 * sites in deckGenerator.ts's no-EDHREC-data branch.
 */
export async function scryfallFallbackTypePass(
  ctx: ScryfallFallbackContext,
  query: string,
  target: number,
  progressMessage: string,
  progressPct: number
): Promise<ScryfallCard[]> {
  ctx.onProgress?.(progressMessage, progressPct);
  return fillWithScryfall(
    query,
    ctx.colorIdentity,
    target,
    ctx.usedNames,
    ctx.bannedCards,
    ctx.maxCardPrice,
    ctx.maxRarity,
    ctx.maxCmc,
    ctx.budgetTracker,
    ctx.collectionNames,
    ctx.currency,
    ctx.arenaOnly,
    ctx.scryfallQueryFilter,
    ctx.collectionStrategy,
    ctx.ignoreOwnedBudget,
    ctx.ignoreOwnedRarity,
    ctx.isCardAllowedBySynergyDependencies,
    ctx.liftScoreOf,
    ctx.fillGates
  );
}
