import { authedFetch, handleResponse } from './fetch-utils';
import { readNdjson } from './ndjson';
import type { AiAnalysisPayload } from './ai-review';
import type { GapAnalysisCard, HiddenGemRow } from '@/deck-builder/types';
import type { SynergySuggestion } from '@/deck-builder/services/synergy/suggest';
import type { SubstituteRow } from '@/deck-builder/services/deckBuilder/substituteFinder';
import type { LandUpgradeMove } from '@/deck-builder/services/deckBuilder/landUpgrades';

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
  /** See `DeckReviewResult.fetched` — cards looked up, so prose can chip them. */
  fetched?: string[];
}

export interface DeckRefinePayload {
  deckId: string;
  commander: string;
  cards: RefineCard[];
  pool: RefineCard[];
  ownedOnly: boolean;
  analysis: AiAnalysisPayload;
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
  /** Underrated evidence-backed picks (E146) — the Suggestions tab's third
   *  lane, and more of what stops the deck being pure EDHREC. */
  hiddenGems?: HiddenGemRow[];
  /** Merit-scored land upgrades. ⚠️ `LandUpgradeMove.inName` is the card being
   *  ADDED — the opposite polarity to `Change.inName`, which is the card cut. */
  landUpgrades?: LandUpgradeMove[];
  /** Names already in the deck — never proposable. */
  deckNames: ReadonlySet<string>;
  /**
   * When set, only cards from this set survive (owned-only generation).
   *
   * No longer the enforcement point: the server restricts the model's card
   * search to the player's collection and re-checks ownership on every proposal,
   * because a client-side filter over a list the model can now search past would
   * guarantee nothing. Kept so the engine's own suggestions stay owned too —
   * the prompt tells the model everything it can see is a card they have.
   */
  ownedNames?: ReadonlySet<string>;
}

/**
 * Assemble the engine's suggestions from what the coach has ALREADY computed.
 *
 * ⚠️ **This stopped being the boundary on what the model may propose.** Through
 * prompt v3 it was: the server verified every returned name against this list
 * and dropped anything else. It no longer is — the model searches our own card
 * database with `lookup_cards`, and the server verifies a proposal's PROPERTIES
 * instead (real card, Commander-legal, in identity, not already in the deck,
 * owned when the build is owned-only). What this list still does is carry
 * evidence a text search cannot: these rows came from EDHREC data and merit
 * scoring for this exact commander, so the prompt tells the model to prefer them
 * where they fit.
 *
 * ⚠️ **The lanes are NOT usually empty — that was measured and is false.** The
 * reason for the change is narrowness, not emptiness. Six live generations
 * against real EDHREC + Scryfall (2026-08-16) produced a populated pool every
 * time: gaps 30/30, hidden gems 10/10, synergy 4–17. So roughly 50 candidates,
 * every one of them derived from EDHREC's aggregate view of this commander plus
 * lift scoring over the same data. That is precisely the consensus the deck
 * builder is trying to get out from under, and it is a keyhole next to the
 * ~107k cards `lookup_cards` can reach by effect.
 *
 * What IS true is that these lanes can soft-fail: `synergy` needs live Scryfall
 * oracle searches and `hiddenGems` a card-similar snapshot fetch, both
 * best-effort, both degrading to an empty lane rather than an error. And they
 * are PERSISTED on the deck, so a deck whose analysis last ran before a lane
 * existed (or failed at the time) carries an empty one until it is re-analysed —
 * which is what #1579 saw in the dev account, and why `landUpgrades`, computed
 * fresh in the editor, still matters as the lane that cannot go missing.
 *
 * Deliberately still no new engine calls: these are the same lanes CoachFeed
 * renders, so the deterministic generator stays untouched. Note that "Off-meta"
 * in the coach is a cross-lane FILTER over these same rows, not a source of its
 * own — there is nothing extra to read from it.
 *
 * Ordering is gaps → off-meta → owned substitutes → gems → lands, so if the
 * cap bites it trims the most situational end rather than the staples.
 */
export function buildRefinePool({
  gaps = [],
  synergy = [],
  substitutes = [],
  hiddenGems = [],
  landUpgrades = [],
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
  for (const g of hiddenGems) push(g.name);
  for (const m of landUpgrades) push(m.inName);

  return out.slice(0, MAX_POOL);
}
