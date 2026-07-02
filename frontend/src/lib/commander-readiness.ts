import type { EnrichedCard } from '../types';
import { isCommanderEligible } from './commanders';
import { frontFaceName } from './card-text';

/**
 * Commander Spotlight readiness scoring — pure, network-free logic.
 *
 * "Readiness" answers an explainable question: of a commander's most-played
 * staples (EDHREC `allNonLand`, sorted by inclusion %), how many do you already
 * own? It is deliberately deterministic and countable (no opaque score) so the
 * UI can show the *why* — "You own 47 of Atraxa's top 100 staples".
 *
 * The EDHREC fetch + caching lives in the deck-builder service; this module only
 * consumes the resulting staple list, so it stays unit-testable with no I/O.
 */

/** How many of a commander's top staples we measure readiness against. */
export const READINESS_POOL_SIZE = 100;

/** How many commanders the spotlight fetches readiness for (carousel cap). */
export const SPOTLIGHT_TOP_N = 8;

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
}

export type CommanderSortKey = 'readiness' | 'name' | 'recentlyAdded';

/**
 * Import recency lookup: importId → import timestamp (ms). Dedupe and the
 * "recently added" sort key off this because prod importIds are random UUIDs
 * (`crypto.randomUUID`, store/collection.ts), NOT time-ordered — an importId
 * string compare picks an arbitrary copy/order. Build it from the collection's
 * `importHistory` (`{ id, addedAt }`). A card with no importId, or one absent
 * from the map, counts as the oldest.
 */
export type ImportRecency = Map<string, number>;

function recencyOf(card: EnrichedCard, recency?: ImportRecency): number {
  const id = card.importId;
  if (!id) return -Infinity;
  return recency?.get(id) ?? -Infinity;
}

/** Short display name: drop the title and any back-face. "Atraxa, Praetors' Voice" → "Atraxa". */
function shortCommanderName(name: string): string {
  return frontFaceName(name).split(',')[0].trim() || name;
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
  recency?: ImportRecency
): EnrichedCard[] {
  const byName = new Map<string, EnrichedCard>();
  for (const card of cards) {
    if (!isCommanderEligible(card)) continue;
    const existing = byName.get(card.name);
    if (!existing || recencyOf(card, recency) > recencyOf(existing, recency)) {
      byName.set(card.name, card);
    }
  }
  return [...byName.values()];
}

/**
 * Compute a readiness score from a commander's staple list and the set of card
 * names the user owns. Pure: no network, no side effects.
 *
 * @param staples - EDHREC `allNonLand`, sorted by inclusion desc. Empty → unavailable.
 * @param ownedNames - Set of the user's owned card names, lowercased.
 * @param commanderName - Used only for the explainer line.
 */
export function computeReadiness(
  staples: ReadinessStaple[],
  ownedNames: Set<string>,
  commanderName: string
): ReadinessScore {
  if (staples.length === 0) {
    return {
      available: false,
      ownedCount: 0,
      totalCount: 0,
      percent: 0,
      explainerLine: 'Staple data unavailable — connect to rate readiness',
      ownedSamples: [],
    };
  }

  const pool = staples.slice(0, READINESS_POOL_SIZE);
  const totalCount = pool.length;
  const ownedSamples: string[] = [];
  let ownedCount = 0;

  for (const staple of pool) {
    if (ownedNames.has(staple.name.toLowerCase())) {
      ownedCount += 1;
      if (ownedSamples.length < MAX_OWNED_SAMPLES) ownedSamples.push(staple.name);
    }
  }

  const percent = totalCount > 0 ? Math.round((ownedCount / totalCount) * 100) : 0;
  const explainerLine = `You own ${ownedCount} of ${shortCommanderName(commanderName)}'s top ${totalCount} staples`;

  return { available: true, ownedCount, totalCount, percent, explainerLine, ownedSamples };
}

/**
 * Sort commander candidates for the carousel/grid. Returns a new array.
 *
 * - `readiness`: highest percent first; unscored/unavailable sink to the end.
 * - `name`: A→Z.
 * - `recentlyAdded`: newest import first (by `recency`); cards with no recency
 *   sink to the end.
 *
 * All keys break ties by name so ordering is stable while scores stream in.
 */
export function sortCommanderCandidates(
  candidates: EnrichedCard[],
  scores: Map<string, ReadinessScore>,
  key: CommanderSortKey,
  recency?: ImportRecency
): EnrichedCard[] {
  const out = [...candidates];
  if (key === 'name') {
    out.sort((a, b) => a.name.localeCompare(b.name));
  } else if (key === 'recentlyAdded') {
    out.sort((a, b) => {
      const ra = recencyOf(a, recency);
      const rb = recencyOf(b, recency);
      if (ra !== rb) return rb - ra;
      return a.name.localeCompare(b.name);
    });
  } else {
    out.sort((a, b) => {
      const sa = scores.get(a.name);
      const sb = scores.get(b.name);
      const ra = sa?.available ? sa.percent : -1;
      const rb = sb?.available ? sb.percent : -1;
      if (rb !== ra) return rb - ra;
      return a.name.localeCompare(b.name);
    });
  }
  return out;
}
