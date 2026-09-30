/**
 * Following Coach's advice the way a user does it (E538).
 *
 * The order a user meets the advice in: the Next-best-move hero first (its
 * card-naming rows carry a direct Add), then the feed's "All" list top to
 * bottom. An add to a full deck opens the replace-when-full prompt, and the
 * user takes its first suggested cut (`rankReplacementCuts`, the page's
 * `replaceOptions.suggested[0]`); a swap row replaces its outgoing card.
 *
 * A user who built the deck under a budget, a target bracket or a
 * collection strategy does not follow advice that breaks it, so a move that
 * would is skipped and recorded with the rule it breaks. The skips are the
 * error buckets; the applied moves are the advised deck.
 */
import type { CollectionStrategy, MaxRarity, ScryfallCard } from '@/deck-builder/types';
import type { WhyFactor } from '@/lib/coach/why-factors';
import type { ChangeOwnership } from '@/lib/coach/deck-change';
import { frontFaceName } from '@/lib/cards/card-text';
import { isBasicLandName } from '@/lib/collection/allocations';
import { getCardPrice, getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import type { CoachView } from './coachView';

export type MoveType = 'add' | 'swap' | 'cut';

/** One suggestion in the order the user meets it. */
export interface CoachMove {
  /** 1-based position in that order. */
  rank: number;
  source: 'nbm' | 'feed';
  /** The engine behind the row: a feed lane, or `nbm:<kind>` for a hero row. */
  surface: string;
  type: MoveType;
  /** The card coming in (add, swap) or going out (cut). */
  name: string;
  /** swap only: the in-deck card it replaces. */
  outName?: string;
  tier?: 1 | 2 | 3;
  reason?: string;
  whyFactors?: WhyFactor[];
  inclusion?: number;
  ownership?: ChangeOwnership;
}

/** The hero's card-naming rows, then the "All" feed, one row per idea. */
export function orderedCoachMoves(view: Pick<CoachView, 'nbm' | 'feed'>): CoachMove[] {
  const out: CoachMove[] = [];
  const seen = new Set<string>();
  const push = (m: Omit<CoachMove, 'rank'>) => {
    const key = `${m.type}|${m.name.toLowerCase()}|${(m.outName ?? '').toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...m, rank: out.length + 1 });
  };
  for (const m of view.nbm) {
    if (!m.cardName) continue;
    push({
      source: 'nbm',
      surface: `nbm:${m.id.split('-')[0]}`,
      type: 'add',
      name: m.cardName,
      tier: m.tier,
      reason: m.detail,
    });
  }
  for (const r of view.feed) {
    const c = r.change;
    push({
      source: 'feed',
      surface: c.lane,
      type: c.type,
      name: c.name,
      outName: c.type === 'swap' ? c.inName : undefined,
      tier: r.tier,
      reason: c.reason,
      whyFactors: c.whyFactors,
      inclusion: c.inclusion,
      ownership: c.ownership,
    });
  }
  return out;
}

export interface EvalDeckState {
  commander: ScryfallCard;
  partner: ScryfallCard | null;
  /** Mainboard, one entry per copy, commanders excluded. */
  cards: ScryfallCard[];
}

/** The deck's own build settings, from the dump's customization. */
export interface DeckSettings {
  colorIdentity: string[];
  deckBudget: number | null;
  maxCardPrice: number | null;
  /** Numeric target bracket, null for 'all'. */
  targetBracket: number | null;
  gameChangerLimit: 'none' | 'unlimited' | number;
  maxRarity: MaxRarity;
  collectionMode: boolean;
  collectionStrategy: CollectionStrategy;
  collectionOwnedPercent: number;
  ignoreOwnedBudget: boolean;
  ignoreOwnedRarity: boolean;
  ownedNames: ReadonlySet<string>;
}

export type Violation =
  | 'unresolved'
  | 'in-deck'
  | 'stale-swap'
  | 'off-identity'
  | 'not-legal'
  | 'unowned'
  | 'owned-share'
  | 'over-card-price'
  | 'over-budget'
  | 'over-rarity'
  | 'game-changer-limit'
  | 'over-bracket'
  | 'no-cut-offered';

export interface ApplyEnv {
  /** Name → full card (the app resolves by name on apply). */
  resolve(name: string): ScryfallCard | undefined;
  /** The replace-when-full prompt's suggested cuts for `addCard`, best first. */
  rankCuts(
    addCard: ScryfallCard,
    cards: readonly ScryfallCard[]
  ): { name: string; reason: string }[];
  /** The deck's estimated bracket (the real estimator), or null when unknown. */
  bracketOf(cards: readonly ScryfallCard[]): number | null;
  isGameChanger(name: string): boolean;
}

export interface AppliedMove {
  order: number;
  move: CoachMove;
  added?: string;
  cut?: string;
  /** Where the cut came from: the swap row itself, or the replace-when-full prompt. */
  cutSource?: 'swap' | 'replace-when-full' | 'cut-row';
  cutReason?: string;
}

export interface SkippedMove {
  move: CoachMove;
  violations: Violation[];
}

export interface ApplyResult {
  deck: EvalDeckState;
  applied: AppliedMove[];
  skipped: SkippedMove[];
}

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'mythic'];

function nameKey(name: string): string {
  return frontFaceName(name).toLowerCase();
}

function isOwned(settings: DeckSettings, name: string): boolean {
  if (settings.ownedNames.has(name)) return true;
  return name.includes(' // ') && settings.ownedNames.has(frontFaceName(name));
}

function priceUsd(card: ScryfallCard): number {
  const p = getCardPrice(card, 'USD');
  return p ? Number(p) || 0 : 0;
}

function isLand(card: ScryfallCard): boolean {
  return getFrontFaceTypeLine(card).toLowerCase().includes('land');
}

/** Budget cost of a card under the deck's settings (owned may be free). */
function budgetCost(settings: DeckSettings, card: ScryfallCard): number {
  if (settings.ignoreOwnedBudget && isOwned(settings, card.name)) return 0;
  return priceUsd(card);
}

function ownedShare(settings: DeckSettings, cards: readonly ScryfallCard[]): number {
  const nonLand = cards.filter((c) => !isLand(c));
  if (nonLand.length === 0) return 1;
  return nonLand.filter((c) => isOwned(settings, c.name)).length / nonLand.length;
}

function gameChangerCap(limit: DeckSettings['gameChangerLimit']): number {
  if (limit === 'none') return 0;
  if (limit === 'unlimited') return Infinity;
  return limit;
}

/**
 * Every setting the move would break. `before` and `after` are the deck's
 * mainboard around the move; a rule the deck already broke before the move
 * only counts when the move makes it worse.
 */
export function moveViolations(
  settings: DeckSettings,
  env: ApplyEnv,
  before: readonly ScryfallCard[],
  after: readonly ScryfallCard[],
  incoming: ScryfallCard | undefined
): Violation[] {
  const v: Violation[] = [];
  if (!incoming) return v;
  const identity = new Set(settings.colorIdentity);
  if ((incoming.color_identity ?? []).some((c) => !identity.has(c))) v.push('off-identity');
  if (incoming.legalities && incoming.legalities.commander !== 'legal') v.push('not-legal');

  const basic = isBasicLandName(incoming.name);
  const owned = basic || isOwned(settings, incoming.name);
  if (settings.collectionMode && !owned) {
    if (settings.collectionStrategy === 'full' || settings.collectionStrategy === 'available') {
      v.push('unowned');
    } else if (settings.collectionStrategy === 'partial') {
      const target = settings.collectionOwnedPercent / 100;
      const shareAfter = ownedShare(settings, after);
      if (shareAfter < target && shareAfter < ownedShare(settings, before)) v.push('owned-share');
    }
  }

  if (settings.maxCardPrice != null && !(settings.ignoreOwnedBudget && owned)) {
    if (priceUsd(incoming) > settings.maxCardPrice) v.push('over-card-price');
  }
  if (settings.deckBudget != null) {
    const total = (cards: readonly ScryfallCard[]) =>
      cards.reduce((s, c) => s + budgetCost(settings, c), 0);
    const t0 = total(before);
    const t1 = total(after);
    if (t1 > settings.deckBudget && t1 > t0 + 0.005) v.push('over-budget');
  }
  if (settings.maxRarity && !(settings.ignoreOwnedRarity && owned) && !basic) {
    const cap = RARITY_ORDER.indexOf(settings.maxRarity);
    const r = RARITY_ORDER.indexOf(incoming.rarity ?? '');
    if (cap >= 0 && r > cap) v.push('over-rarity');
  }
  const cap = gameChangerCap(settings.gameChangerLimit);
  if (Number.isFinite(cap) && env.isGameChanger(incoming.name)) {
    const count = (cards: readonly ScryfallCard[]) =>
      cards.filter((c) => env.isGameChanger(c.name)).length;
    if (count(after) > cap && count(after) > count(before)) v.push('game-changer-limit');
  }
  if (settings.targetBracket != null) {
    const b0 = env.bracketOf(before);
    const b1 = env.bracketOf(after);
    if (b1 != null && b1 > settings.targetBracket && (b0 == null || b1 > b0)) {
      v.push('over-bracket');
    }
  }
  return v;
}

/** Remove one copy of `name` (exact, else by front face). */
function without(cards: readonly ScryfallCard[], name: string): ScryfallCard[] | null {
  let i = cards.findIndex((c) => c.name === name);
  if (i < 0) i = cards.findIndex((c) => nameKey(c.name) === nameKey(name));
  if (i < 0) return null;
  return [...cards.slice(0, i), ...cards.slice(i + 1)];
}

function inDeck(cards: readonly ScryfallCard[], name: string): boolean {
  const key = nameKey(name);
  return cards.some((c) => nameKey(c.name) === key);
}

export interface MoveAudit {
  move: CoachMove;
  /** The card that would leave: the swap's own, or the prompt's first cut. */
  cut?: string;
  cutReason?: string;
  violations: Violation[];
}

/**
 * Each of the first `k` moves on its own, against the unedited deck: what it
 * would cut and which of the deck's settings it would break. This is the
 * advice as shown, before any user judgment filters it.
 */
export function auditMoves(
  deck: EvalDeckState,
  moves: readonly CoachMove[],
  settings: DeckSettings,
  env: ApplyEnv,
  k: number
): MoveAudit[] {
  return moves.slice(0, k).map((move) => {
    const one = applyCoachMoves(deck, [move], settings, env, 1, 1);
    if (one.applied.length > 0) {
      const a = one.applied[0];
      return { move, cut: a.cut, cutReason: a.cutReason, violations: [] };
    }
    const violations = one.skipped[0]?.violations ?? [];
    let cut: string | undefined;
    let cutReason: string | undefined;
    if (move.type === 'swap') cut = move.outName;
    else if (move.type === 'add' && !violations.includes('unresolved')) {
      const incoming = env.resolve(move.name);
      const offered = incoming ? env.rankCuts(incoming, deck.cards) : [];
      cut = offered[0]?.name;
      cutReason = offered[0]?.reason;
    }
    return { move, cut, cutReason, violations };
  });
}

/**
 * Walk the moves in order and apply the first `n` a settings-respecting user
 * would take. `mainboardLimit` is 99 less a partner (DeckEditorPage).
 * `scanLimit` bounds how far down the list a user reads for `n` good moves.
 */
export function applyCoachMoves(
  deck: EvalDeckState,
  moves: readonly CoachMove[],
  settings: DeckSettings,
  env: ApplyEnv,
  n: number,
  scanLimit = 40
): ApplyResult {
  let cards = [...deck.cards];
  const applied: AppliedMove[] = [];
  const skipped: SkippedMove[] = [];
  const mainboardLimit = 99 - (deck.partner ? 1 : 0);

  for (const move of moves.slice(0, scanLimit)) {
    if (applied.length >= n) break;
    const skip = (violations: Violation[]) => skipped.push({ move, violations });

    if (move.type === 'cut') {
      const next = without(cards, move.name);
      if (!next) {
        skip(['stale-swap']);
        continue;
      }
      cards = next;
      applied.push({ order: applied.length + 1, move, cut: move.name, cutSource: 'cut-row' });
      continue;
    }

    const incoming = env.resolve(move.name);
    if (!incoming) {
      skip(['unresolved']);
      continue;
    }
    if (inDeck(cards, incoming.name) && !isBasicLandName(incoming.name)) {
      skip(['in-deck']);
      continue;
    }

    let cutName: string | undefined;
    let cutSource: AppliedMove['cutSource'];
    let cutReason: string | undefined;
    if (move.type === 'swap') {
      if (!move.outName || !inDeck(cards, move.outName)) {
        skip(['stale-swap']);
        continue;
      }
      cutName = move.outName;
      cutSource = 'swap';
    } else if (cards.length >= mainboardLimit) {
      const offered = env.rankCuts(incoming, cards);
      if (offered.length === 0) {
        skip(['no-cut-offered']);
        continue;
      }
      cutName = offered[0].name;
      cutReason = offered[0].reason;
      cutSource = 'replace-when-full';
    }

    const base = cutName ? without(cards, cutName) : [...cards];
    if (!base) {
      skip(['stale-swap']);
      continue;
    }
    const after = [...base, incoming];
    const violations = moveViolations(settings, env, cards, after, incoming);
    if (violations.length > 0) {
      skip(violations);
      continue;
    }
    cards = after;
    applied.push({
      order: applied.length + 1,
      move,
      added: incoming.name,
      cut: cutName,
      cutSource,
      cutReason,
    });
  }
  return { deck: { ...deck, cards }, applied, skipped };
}
