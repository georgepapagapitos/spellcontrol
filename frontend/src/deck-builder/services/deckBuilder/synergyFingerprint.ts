// Deck synergy fingerprint — the functional "shape" of the deck built so far,
// as a tag → frequency map over the tagger's functional tags.
//
// Used to re-rank the Scryfall fallback fill in owned-only mode: when the
// owned∩EDHREC pool can't fill a slot, the leftover owned cards are otherwise
// ordered only by Scryfall's *global* edhrec_rank ("good in general"), not by
// fit with *this* commander/deck. Scoring candidates against the fingerprint
// fills slots with the most on-theme owned card instead of just any legal one.
//
// Tags-only by design: the fill query already fixes the type (t:creature, …),
// so type overlap is uninformative here — the tagger fingerprint is the signal.
import { getCardTags } from '@/deck-builder/services/tagger/client';

/**
 * Aggregate the deck's tagger tags into tag → fraction-of-cards-carrying-it.
 * `tagsOf` is injectable for testing without loading tagger data.
 */
export function buildSynergyFingerprint(
  deckNames: Iterable<string>,
  tagsOf: (name: string) => string[] = getCardTags
): Map<string, number> {
  const counts = new Map<string, number>();
  let total = 0;
  for (const name of deckNames) {
    total++;
    for (const tag of tagsOf(name)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  for (const [tag, n] of counts) counts.set(tag, n / total); // total > 0 whenever counts is non-empty
  return counts;
}

/**
 * How well a candidate matches the deck's shape: the sum of its tags' deck
 * frequencies. Cards sharing the deck's dominant tags score highest; cards with
 * no shared tags score 0 (kept in Scryfall order as the tiebreak by the caller).
 */
export function synergyScore(
  cardName: string,
  fingerprint: Map<string, number>,
  tagsOf: (name: string) => string[] = getCardTags
): number {
  let s = 0;
  for (const tag of tagsOf(cardName)) s += fingerprint.get(tag) ?? 0;
  return s;
}

/**
 * The card's own tags that also appear in the deck fingerprint, most-represented
 * first — the "why this fits" evidence behind a synergy pick. Capped to `limit`.
 * Empty when the card shares no tags with the deck (i.e. a pure slot-filler).
 */
export function topMatchedTags(
  cardName: string,
  fingerprint: Map<string, number>,
  limit = 3,
  tagsOf: (name: string) => string[] = getCardTags
): string[] {
  return tagsOf(cardName)
    .filter((tag) => fingerprint.has(tag))
    .sort((a, b) => (fingerprint.get(b) ?? 0) - (fingerprint.get(a) ?? 0))
    .slice(0, limit);
}
