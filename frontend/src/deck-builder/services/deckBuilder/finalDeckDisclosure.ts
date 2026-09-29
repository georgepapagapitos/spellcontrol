/**
 * Disclosures checked against the FINAL deck (E509 salvage). Gap analysis and
 * the owned-substitute rows are written mid-generation; later phases (combo
 * audit, coherence repair, role-surplus rebalance, fixups) still seat and cut
 * cards. The live collection panel caught both going stale: a gap naming a
 * card the deck has (Sythis partial50 listed Wild Growth and Utopia Sprawl as
 * gaps while running both), and "Wanted Elvish Archdruid, used your Rishkar"
 * in a Lathril deck that ended up running both.
 */
import { frontFaceName } from '@/lib/card-text';

/** Whether a name is in the final deck, by full name or front face (a
 *  collection row or an EDHREC name can name a double-faced card by its
 *  front face alone). */
export function finalDeckMembership(finalNames: Iterable<string>): (name: string) => boolean {
  const full = new Set(finalNames);
  const fronts = new Set([...full].map((n) => frontFaceName(n)));
  return (name) => full.has(name) || fronts.has(name) || fronts.has(frontFaceName(name));
}

/** The gap list without the cards the deck has. */
export function gapsOutsideDeck<T extends { name: string }>(
  gaps: T[] | undefined,
  inDeck: (name: string) => boolean
): T[] | undefined {
  return gaps?.filter((g) => !inDeck(g.name));
}

/** "Wanted X, used your Y" rows that still hold: Y shipped and X didn't. */
export function survivingSubstitutionRows<T extends { wantedName: string; usedName: string }>(
  rows: readonly T[],
  inDeck: (name: string) => boolean
): T[] {
  return rows.filter((r) => inDeck(r.usedName) && !inDeck(r.wantedName));
}
