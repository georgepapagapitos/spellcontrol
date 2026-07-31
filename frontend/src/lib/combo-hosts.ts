import type { EnrichedCard } from '../types';
import { isCommanderEligible } from './commanders';

/**
 * Commanders in the user's own collection that could legally host a given
 * combo — the step that turns "you own these two cards" into "and here's the
 * deck you'd build around them".
 *
 * Pure set math over cards already in memory: eligibility comes from the
 * shared `isCommanderEligible` (legendary creature / "can be your commander",
 * legal in Commander), and hosting is the colour-identity superset rule.
 * No network, no Scryfall round-trip.
 */

/**
 * Commander-eligible cards from the collection, deduped by name so four copies
 * of one legend don't read as four options. Sorted by name for stable output.
 */
export function ownedCommanders(cards: EnrichedCard[]): EnrichedCard[] {
  const byName = new Map<string, EnrichedCard>();
  for (const c of cards) {
    if (!isCommanderEligible(c)) continue;
    const key = c.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, c);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * `identity` is Spellbook's format — lowercase WUBRG letters, or "c" for
 * colorless. Colorless fits under any commander, so 'c' is not a requirement.
 * A commander with no `colorIdentity` recorded is treated as colorless and so
 * only hosts colorless combos — never guessed into a match.
 */
function neededColours(identity: string): string[] {
  return [...identity.toLowerCase()].filter((ch) => ch !== 'c');
}

function covers(commander: EnrichedCard, needed: string[]): boolean {
  const have = new Set((commander.colorIdentity ?? []).map((ch) => ch.toLowerCase()));
  return needed.every((ch) => have.has(ch));
}

/** Filter `commanders` to those whose colour identity contains every colour the combo needs. */
export function commandersForIdentity(
  commanders: EnrichedCard[],
  identity: string
): EnrichedCard[] {
  const needed = neededColours(identity);
  return commanders.filter((c) => covers(c, needed));
}

/**
 * Same test as `commandersForIdentity`, but a short-circuiting boolean instead
 * of building a filtered array. Used by the collection page's per-row "can
 * host" filter predicate (`canHost`, called once per combo, hundreds of times
 * per page) — that path only needs yes/no, so it shouldn't pay for an array
 * allocation, let alone the ranking sort below.
 */
export function hasHostForIdentity(commanders: EnrichedCard[], identity: string): boolean {
  const needed = neededColours(identity);
  return commanders.some((c) => covers(c, needed));
}

/**
 * Rank already-filtered hosts so the ones a player would actually build float
 * to the top of the aside's display list. Only called on the small number of
 * combos actually rendered on screen (not the per-row `canHost` filter path),
 * so a sort here is cheap.
 *
 * Primary key is EDHREC popularity (`edhrecRank`, lower = more played) — pure,
 * local, already loaded on ~90% of a real collection, zero added cost. A
 * commander with no recorded rank sorts after every ranked one in its tier,
 * never guessed into first place. Colour-identity size is the tiebreak: among
 * commanders with the same (or no) rank, the tighter match wins over a
 * 5-colour goodstuff pile that merely contains the combo as a superset. Name
 * is the final tiebreak for deterministic output.
 */
export function rankHosts(hosts: EnrichedCard[]): EnrichedCard[] {
  return [...hosts].sort((a, b) => {
    const ra = a.edhrecRank ?? Infinity;
    const rb = b.edhrecRank ?? Infinity;
    if (ra !== rb) return ra - rb;
    const na = (a.colorIdentity ?? []).length;
    const nb = (b.colorIdentity ?? []).length;
    if (na !== nb) return na - nb;
    return a.name.localeCompare(b.name);
  });
}
