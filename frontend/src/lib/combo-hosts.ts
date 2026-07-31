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
 * Filter `commanders` to those whose colour identity contains every colour the
 * combo needs.
 *
 * `identity` is Spellbook's format — lowercase WUBRG letters, or "c" for
 * colorless. Colorless fits under any commander, so 'c' is not a requirement.
 * A commander with no `colorIdentity` recorded is treated as colorless and so
 * only hosts colorless combos — never guessed into a match.
 */
export function commandersForIdentity(
  commanders: EnrichedCard[],
  identity: string
): EnrichedCard[] {
  const needed = [...identity.toLowerCase()].filter((ch) => ch !== 'c');
  if (needed.length === 0) return commanders;
  return commanders.filter((c) => {
    const have = new Set((c.colorIdentity ?? []).map((ch) => ch.toLowerCase()));
    return needed.every((ch) => have.has(ch));
  });
}
