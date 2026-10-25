import type { EnrichedCard } from '@/types/index';
import { bracketLabel } from '@spellcontrol/deck-metrics';
import { isCommanderEligible } from './commanders';

/**
 * Commander readiness scoring — pure, network-free logic.
 *
 * "Readiness" answers an explainable question: of a commander's most-played
 * staples (EDHREC `allNonLand`, sorted by inclusion %), how many do you already
 * own? It is deliberately deterministic and countable (no opaque score) so the
 * UI can show the *why*: "47 of 100 staples owned".
 *
 * The EDHREC fetch + caching lives in the deck-builder service; this module only
 * consumes the resulting staple list, so it stays unit-testable with no I/O.
 */

/** How many of a commander's top staples we measure readiness against. */
export const READINESS_POOL_SIZE = 100;

/** Below this collection size a readiness or coverage % is too noisy to be a
 *  useful "what to build" signal. Shared by the commander picker and the
 *  binder ranking. */
export const MIN_COLLECTION_SIZE = 20;

/** Max owned-staple names carried for the explainer tooltip. */
export const MAX_OWNED_SAMPLES = 3;

/** Minimal staple shape — `EDHRECCard` (with its extra fields) is assignable. */
export interface ReadinessStaple {
  name: string;
  /** Inclusion percentage (0-100). The staple list is pre-sorted by this desc. */
  inclusion: number;
}

export interface ReadinessScore {
  /**
   * False when no staple data was available (EDHREC offline/unreachable) — the
   * UI shows an "unavailable" affordance rather than a misleading 0%.
   */
  available: boolean;
  ownedCount: number;
  totalCount: number;
  /** 0-100 integer. */
  percent: number;
  /** Human-readable explainer for the hero / tooltip. */
  explainerLine: string;
  /** Up to MAX_OWNED_SAMPLES owned staple names, highest-inclusion first. */
  ownedSamples: string[];
  /**
   * Percent of the pool's total inclusion you own (0-100): owning a card 85% of
   * decks run counts for more than a 4% card. The finder ranks by this; the
   * count above is what the tile shows. Absent on a score built elsewhere.
   */
  weightedPercent?: number;
  /** Pool staples you don't own, highest-inclusion first (what "to finish" prices). */
  missingNames?: string[];
  /** Owned staples whose every copy sits in one of your decks, with those decks. */
  heldElsewhere?: HeldStaple[];
  /** Game Changers dropped from the pool because the target bracket bars them. */
  excludedGameChangers?: number;
  /** Decks behind the inclusion numbers (EDHREC's sample for this page). */
  sampleDecks?: number;
  /** The target bracket the pool was cut for; null when none was chosen. */
  bracket?: number | null;
  /** The bracket page had too few decks, so the all-brackets page was used. */
  broadFallback?: boolean;
}

export interface HeldStaple {
  name: string;
  decks: string[];
}

/** Options that shape one score. All optional: no options is the plain count. */
export interface ReadinessOptions {
  /** Target Commander bracket (1 to 5); null or absent leaves the pool uncut. */
  bracket?: number | null;
  /** Game Changer names, as {@link filterStaplesForBracket} reads them. */
  gameChangers?: ReadonlySet<string>;
  /** Lowercased owned name to the decks holding every copy of it. */
  heldBy?: ReadonlyMap<string, string[]>;
  sampleDecks?: number;
  broadFallback?: boolean;
}

/** Brackets 1 and 2 bar Game Changers; bracket 3 allows up to three. */
export const BRACKET_3_GAME_CHANGER_LIMIT = 3;

/**
 * Cut a commander's staple list for a target bracket. The Commander Brackets
 * rules bar Game Changers in brackets 1 and 2 and allow at most three in
 * bracket 3; 4 and 5 have no limit. The staples arrive sorted by inclusion, so
 * the three bracket-3 keepers are the most-played ones.
 */
export function filterStaplesForBracket<T extends ReadinessStaple>(
  staples: readonly T[],
  bracket: number | null | undefined,
  gameChangers: ReadonlySet<string>
): { staples: T[]; excluded: number } {
  if (!bracket || bracket >= 4) return { staples: [...staples], excluded: 0 };
  const limit = bracket === 3 ? BRACKET_3_GAME_CHANGER_LIMIT : 0;
  let kept = 0;
  let excluded = 0;
  const out: T[] = [];
  for (const staple of staples) {
    if (gameChangers.has(staple.name)) {
      if (kept >= limit) {
        excluded += 1;
        continue;
      }
      kept += 1;
    }
    out.push(staple);
  }
  return { staples: out, excluded };
}

/**
 * Import recency lookup: importId → import timestamp (ms). Dedupe keys off
 * this because prod importIds are random UUIDs (`crypto.randomUUID`,
 * store/collection.ts), NOT time-ordered — an importId string compare picks
 * an arbitrary copy/order. Build it from the collection's
 * `importHistory` (`{ id, addedAt }`). A card with no importId, or one absent
 * from the map, counts as the oldest.
 */
export type ImportRecency = Map<string, number>;

function recencyOf(card: EnrichedCard, recency?: ImportRecency): number {
  const id = card.importId;
  if (!id) return -Infinity;
  return recency?.get(id) ?? -Infinity;
}

/**
 * Extract the user's commander-eligible cards from their collection, one entry
 * per distinct commander name (keeping the most recently imported copy). Uses
 * the shared `isCommanderEligible` so detection can't drift from binder routing.
 *
 * Pass `recency` (importId → addedAt) to make "most recent" real; without it,
 * copies tie and the first-seen one wins.
 */
export function extractCommanderCandidates(
  cards: EnrichedCard[],
  recency?: ImportRecency,
  eligible: (card: EnrichedCard) => boolean = isCommanderEligible
): EnrichedCard[] {
  const byName = new Map<string, EnrichedCard>();
  for (const card of cards) {
    if (!eligible(card)) continue;
    const existing = byName.get(card.name);
    if (!existing || recencyOf(card, recency) > recencyOf(existing, recency)) {
      byName.set(card.name, card);
    }
  }
  return [...byName.values()];
}

/**
 * PDH commander eligibility over an owned copy: an uncommon creature.
 * `rarity` is the copy's own printing — a rare-only-owned copy of a card that
 * has an uncommon printing elsewhere won't surface; acceptable ceiling
 * (mirrors lib/deck/commanders.ts:isPdhCommanderEligible).
 */
export function isPdhCommanderCandidate(card: EnrichedCard): boolean {
  return card.rarity === 'uncommon' && (card.typeLine ?? '').includes('Creature');
}

/**
 * Compute a readiness score from a commander's staple list and the set of card
 * names the user owns. Pure: no network, no side effects.
 *
 * @param staples - EDHREC `allNonLand`, sorted by inclusion desc. Empty → unavailable.
 * @param ownedNames - Set of the user's owned card names, lowercased.
 */
export function computeReadiness(
  staples: ReadinessStaple[],
  ownedNames: Set<string>,
  options: ReadinessOptions = {}
): ReadinessScore {
  if (staples.length === 0) {
    return {
      available: false,
      ownedCount: 0,
      totalCount: 0,
      percent: 0,
      explainerLine: 'Staple data unavailable. Connect to rate readiness.',
      ownedSamples: [],
    };
  }

  const bracket = options.bracket ?? null;
  const cut = filterStaplesForBracket(staples, bracket, options.gameChangers ?? new Set());
  const pool = cut.staples.slice(0, READINESS_POOL_SIZE);
  const totalCount = pool.length;
  const ownedSamples: string[] = [];
  const missingNames: string[] = [];
  const heldElsewhere: HeldStaple[] = [];
  let ownedCount = 0;
  let ownedWeight = 0;
  let totalWeight = 0;

  for (const staple of pool) {
    const key = staple.name.toLowerCase();
    totalWeight += staple.inclusion;
    if (ownedNames.has(key)) {
      ownedCount += 1;
      ownedWeight += staple.inclusion;
      if (ownedSamples.length < MAX_OWNED_SAMPLES) ownedSamples.push(staple.name);
      const decks = options.heldBy?.get(key);
      if (decks && decks.length > 0) heldElsewhere.push({ name: staple.name, decks });
    } else {
      missingNames.push(staple.name);
    }
  }

  const percent = totalCount > 0 ? Math.round((ownedCount / totalCount) * 100) : 0;
  const weightedPercent = totalWeight > 0 ? Math.round((ownedWeight / totalWeight) * 100) : percent;
  const explainerLine = `${ownedCount} of ${totalCount} staples owned`;

  return {
    available: true,
    ownedCount,
    totalCount,
    percent,
    explainerLine,
    ownedSamples,
    weightedPercent,
    missingNames,
    heldElsewhere,
    excludedGameChangers: cut.excluded,
    sampleDecks: options.sampleDecks,
    bracket,
    broadFallback: options.broadFallback,
  };
}

/** What finishing the deck costs: the missing staples priced, and how many had no price. */
export interface CompletionCost {
  total: number;
  priced: number;
  unpriced: number;
}

/** Sum the missing staples' prices (lowercased-name keyed); an unpriced card is counted, not guessed. */
export function completionCost(
  score: ReadinessScore,
  prices: ReadonlyMap<string, number>
): CompletionCost {
  let total = 0;
  let priced = 0;
  let unpriced = 0;
  for (const name of score.missingNames ?? []) {
    const price = prices.get(name.toLowerCase());
    if (price === undefined) unpriced += 1;
    else {
      total += price;
      priced += 1;
    }
  }
  return { total, priced, unpriced };
}

/** "3 of them are in your Atraxa deck", or null when none are held. */
export function heldLine(score: ReadinessScore): string | null {
  const held = score.heldElsewhere ?? [];
  if (held.length === 0) return null;
  const decks = [...new Set(held.flatMap((h) => h.decks))];
  const where = decks.length === 1 ? `your ${decks[0]} deck` : `${decks.length} of your decks`;
  return `${held.length} you own ${held.length === 1 ? 'is' : 'are'} in ${where}`;
}

/**
 * Where the numbers come from, so a tile can show its sample: "Bracket 2 · 3,183
 * decks · 3 Game Changers left out", or the fallback when the bracket's page was
 * too thin to trust. Null when the score carries no deck count.
 */
export function basisLine(score: ReadinessScore): string | null {
  const parts: string[] = [];
  const decks = score.sampleDecks;
  const deckText =
    decks === undefined || decks <= 0
      ? null
      : `${decks.toLocaleString()} ${decks === 1 ? 'deck' : 'decks'}`;
  if (score.bracket && score.broadFallback) {
    parts.push(`Too few ${bracketLabel(score.bracket)} decks, so all brackets`);
  } else if (score.bracket) {
    parts.push(`Bracket ${score.bracket}`);
  }
  if (deckText) parts.push(deckText);
  const gc = score.excludedGameChangers ?? 0;
  if (gc > 0) parts.push(`${gc} Game ${gc === 1 ? 'Changer' : 'Changers'} left out`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * The hint under the toolbar for the coverage sort: what the ranking weighs, the
 * bracket's Game Changer rule, and how far the pass looked (it scores a capped,
 * most-played shortlist, never every commander).
 */
export function coverageHintFor(
  count: number,
  cap: number,
  bracket: number | null,
  nouns: string,
  /** The list is EDHREC's popular list with no color chosen. */
  popularBrowse: boolean
): string | null {
  const o = { count, cap, nouns, popularBrowse };
  if (o.count === 0) return null;
  const gc =
    bracket === null || bracket >= 4
      ? ''
      : bracket < 3
        ? ' Game Changers are left out.'
        : ' Up to three Game Changers are kept.';
  const how = bracket
    ? `Ranked by how often Bracket ${bracket} decks play the cards you own.${gc}`
    : 'Ranked by how often decks play the cards you own.';
  const reach =
    o.count > o.cap
      ? ` Checked the ${o.cap} most-played of ${o.count.toLocaleString()} ${o.nouns} here. Pick colors to rank others.`
      : o.popularBrowse
        ? ` Checked EDHREC's ${o.count} most-played ${o.nouns}, not every one. Pick colors to see more.`
        : '';
  return how + reach;
}

/** The commanders a coverage pass scores: the `cap` most-played of the list. */
export function scoreShortlist<T extends { popularity?: number }>(
  entries: readonly T[],
  cap: number
): T[] {
  if (entries.length <= cap) return [...entries];
  return [...entries]
    .sort((a, b) => (a.popularity ?? Infinity) - (b.popularity ?? Infinity))
    .slice(0, cap);
}
