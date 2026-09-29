/**
 * Resolve the player's owned cards to full card data (E509 salvage).
 *
 * Identity comes from the printing's Scryfall id wherever the collection
 * carries one (every imported copy does): an id can't resolve to a look-alike,
 * and it survives reprints, foreign-language copies and double-faced names.
 * The id gives the oracle card; the playable card object is then fetched by
 * its canonical name, so price and printing follow the same cheapest-printing
 * convention as every other candidate, and the two must be the same oracle
 * card. A row with no id falls back to its name, and the result must be that
 * name or have it as its FRONT face: a name lookup for "Brainstorm" can answer
 * with Harmonized Trio // Brainstorm (#2157), a different card that would ship
 * as "owned".
 */
import { frontFaceName } from '@/lib/cards/card-text';
import type { ScryfallCard } from '@/deck-builder/types';
import { getCardsByIds, getCardsByNames } from '@/deck-builder/services/scryfall/client';
import type { SubstituteCandidate } from './substituteFinder';

const lower = (s: string) => s.toLowerCase();

/** A resolved card is the requested one: same name, or the requested name is
 *  its FRONT face. A match on a back face is a different card. */
export function isSameCard(requested: string, card: ScryfallCard): boolean {
  const want = lower(requested);
  return lower(card.name) === want || lower(frontFaceName(card.name)) === want;
}

export interface OwnedResolution {
  /** Collection row name → the verified card. Rows that didn't resolve to
   *  their own card are absent. */
  byName: Map<string, ScryfallCard>;
  /** Canonical names of resolved cards the collection spells another way
   *  (a front-face-only or foreign-language row): ownership checks key by
   *  the card's own name, so these join the owned-name set. */
  aliases: string[];
}

export async function resolveOwnedCards(
  entries: readonly SubstituteCandidate[],
  opts: { preferredSet?: string; arenaOnly: boolean; ownedNames?: ReadonlySet<string> }
): Promise<OwnedResolution> {
  const withId = entries.filter((e) => e.scryfallId);
  const printings =
    withId.length > 0
      ? await getCardsByIds(withId.map((e) => e.scryfallId!)).catch(
          () => new Map<string, ScryfallCard>()
        )
      : new Map<string, ScryfallCard>();

  // Each row → the name to fetch the playable card by, and the oracle id it must match.
  const wanted = entries.map((entry) => {
    const printing = entry.scryfallId ? printings.get(entry.scryfallId) : undefined;
    return printing
      ? { entry, fetchName: printing.name, oracleId: printing.oracle_id }
      : { entry, fetchName: entry.name, oracleId: entry.oracleId };
  });

  const fetched = await getCardsByNames(
    [...new Set(wanted.map((w) => w.fetchName))],
    undefined,
    opts.preferredSet,
    { arenaOnly: opts.arenaOnly }
  );

  const byName = new Map<string, ScryfallCard>();
  const aliases = new Set<string>();
  for (const { entry, fetchName, oracleId } of wanted) {
    const card = fetched.get(fetchName);
    if (!card || !isSameCard(fetchName, card)) continue;
    if (oracleId && card.oracle_id && card.oracle_id !== oracleId) continue;
    byName.set(entry.name, card);
    if (!opts.ownedNames?.has(card.name)) aliases.add(card.name);
  }
  return { byName, aliases: [...aliases] };
}
