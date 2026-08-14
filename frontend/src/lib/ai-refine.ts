import { authedFetch, handleResponse } from './fetch-utils';
import { readNdjson } from './ndjson';
import type { DeckAnalysisResult } from './deck-analysis';
import type { GapAnalysisCard } from '@/deck-builder/types';
import type { SynergySuggestion } from '@/deck-builder/services/synergy/suggest';
import type { SubstituteRow } from '@/deck-builder/services/deckBuilder/substituteFinder';

/**
 * Client for the post-generation refine pass (T102 slice 4). The server is the
 * authority on what the model may propose: it verifies every returned name
 * against the pool this request submitted, so anything that arrives here is
 * already known-good.
 */

export interface RefineCard {
  name: string;
  oracleId: string;
  qty: number;
}

export interface RefineTweak {
  /** A pool member, in the pool's spelling. */
  add: string;
  /** An in-deck card, or null for a pure add. */
  cut: string | null;
  why: string;
}

export interface DeckRefineResult {
  /** The strategy read. The tweaks tail is parsed off server-side. */
  content: string;
  tweaks: RefineTweak[];
  cached: boolean;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface DeckRefinePayload {
  deckId: string;
  commander: string;
  cards: RefineCard[];
  pool: RefineCard[];
  ownedOnly: boolean;
  analysis: DeckAnalysisResult;
}

/**
 * Ask for the refine pass and read the strategy prose as it is written.
 *
 * Same NDJSON contract as the review: `{delta}` lines carry prose only (the
 * server withholds the machine-readable tail), `{done}` terminates with the
 * strategy plus the verified tweaks, `{error}` reports a post-200 failure. A
 * stream that ends without `{done}` was truncated.
 */
export async function requestDeckRefine(
  payload: DeckRefinePayload,
  onText?: (textSoFar: string) => void
): Promise<DeckRefineResult> {
  const res = await authedFetch('/api/ai/deck-refine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) await handleResponse<never>(res);

  let text = '';
  let done: DeckRefineResult | undefined;
  let failure: string | undefined;

  await readNdjson(res, (msg) => {
    if (typeof msg.delta === 'string') {
      text += msg.delta;
      onText?.(text);
    } else if (typeof msg.error === 'string') {
      failure = msg.error;
    } else if (msg.done && typeof msg.done === 'object') {
      done = msg.done as DeckRefineResult;
    }
  });

  if (failure) throw new Error(failure);
  if (!done) throw new Error('The refine pass ended early. Try again.');
  return done;
}

/** Cap the pool so a huge coach feed can't blow the route's MAX_POOL (300). */
export const MAX_POOL = 300;

export interface RefinePoolSources {
  /** EDHREC staples the deck is missing. */
  gaps?: GapAnalysisCard[];
  /** Off-meta oracle-search candidates — what stops the deck being pure EDHREC. */
  synergy?: SynergySuggestion[];
  /** Owned-collection stand-ins the substitute finder already matched. */
  substitutes?: SubstituteRow[];
  /** Names already in the deck — never proposable. */
  deckNames: ReadonlySet<string>;
  /** When set, only cards from this set survive (owned-only generation). */
  ownedNames?: ReadonlySet<string>;
}

/**
 * Assemble the candidate pool from what the coach has ALREADY computed.
 *
 * Deliberately no new engine calls: `gapAnalysis`, the synergy suggestions and
 * the substitution plan are the same three lanes CoachFeed renders, so the
 * model curates exactly the cards the app was already willing to recommend.
 * That keeps the deterministic generator untouched and means the pool inherits
 * the colour-identity and format filtering those lanes already applied.
 *
 * Ordering is gaps → off-meta → owned substitutes, so if the cap bites it
 * trims the most speculative end rather than the staples.
 */
export function buildRefinePool({
  gaps = [],
  synergy = [],
  substitutes = [],
  deckNames,
  ownedNames,
}: RefinePoolSources): RefineCard[] {
  const seen = new Set<string>();
  const out: RefineCard[] = [];

  const push = (name: string) => {
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return;
    if (deckNames.has(name)) return;
    // Owned-only generation means the player is building from cards they have;
    // a suggestion they'd need to buy is not a suggestion.
    if (ownedNames && !ownedNames.has(name)) return;
    seen.add(key);
    out.push({ name, oracleId: '', qty: 1 });
  };

  for (const g of gaps) push(g.name);
  for (const s of synergy) push(s.cardName);
  for (const s of substitutes) push(s.usedName);

  return out.slice(0, MAX_POOL);
}
