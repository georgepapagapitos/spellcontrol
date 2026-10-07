/**
 * Disclosures checked against the FINAL deck (E509 salvage). Gap analysis and
 * the owned-substitute rows are written mid-generation; later phases (combo
 * audit, coherence repair, role-surplus rebalance, fixups) still seat and cut
 * cards. The live collection panel caught both going stale: a gap naming a
 * card the deck has (Sythis partial50 listed Wild Growth and Utopia Sprawl as
 * gaps while running both), and "Wanted Elvish Archdruid, used your Rishkar"
 * in a Lathril deck that ended up running both.
 */
import { frontFaceName } from '@/lib/cards/card-text';

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

/** A left-out card is named only when it is a staple (40%+ of decks). */
const LEFT_OUT_MIN_INCLUSION = 40;
const LEFT_OUT_NAMED = 5;

/**
 * E576: an owned-only build says plainly which of the most-played cards it
 * left out because the user doesn't own them ('available': has no free copy).
 * Pass the gap list after `gapsOutsideDeck`, so a card the deck runs is never
 * named. The Rin and Seri Cats+Dogs report said nothing about Jetmir (80%) or
 * Spirited Companion (71%).
 */
export function buildUnownedLeftOutNote(
  gaps: readonly { name: string; inclusion: number; isOwned?: boolean }[] | undefined,
  strategy: 'full' | 'available'
): string | undefined {
  const staples = (gaps ?? [])
    .filter((g) => !g.isOwned && g.inclusion >= LEFT_OUT_MIN_INCLUSION)
    .sort((a, b) => b.inclusion - a.inclusion);
  if (staples.length === 0) return undefined;
  const named = staples
    .slice(0, LEFT_OUT_NAMED)
    .map((g) => `${g.name} (${Math.round(g.inclusion)}%)`)
    .join(', ');
  const more = staples.length - LEFT_OUT_NAMED;
  const why =
    strategy === 'available'
      ? 'you have no free copy'
      : `you don't own ${staples.length === 1 ? 'it' : 'them'}`;
  const tail = more > 0 ? `, and ${more} more played in ${LEFT_OUT_MIN_INCLUSION}%+ of decks` : '';
  return `Left out because ${why}: ${named}${tail}.`;
}
