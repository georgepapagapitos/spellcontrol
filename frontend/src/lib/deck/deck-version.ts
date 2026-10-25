import type { Deck } from '@/store/decks';

/**
 * Which list a deck was playing, as `<card count>:<8 hex of a hash of the
 * list>`. Stamped on a seat when a tracked game starts so a later read can
 * group games by the list that played them, without keeping a copy of the list.
 *
 * What counts as the list: the mainboard and the commanders, by oracle id (a
 * printing swap is the same card). The sideboard and considering pile do not
 * play. The count is the sum of copies, so the label reads "99 cards" without
 * a lookup and two lists of different sizes can never collide.
 */
export function deckVersionOf(
  deck: Pick<Deck, 'commander' | 'partnerCommander' | 'cards'>
): string {
  const copies = new Map<string, number>();
  const add = (card: { oracle_id?: string; name: string } | null) => {
    if (!card) return;
    const key = card.oracle_id ?? card.name;
    copies.set(key, (copies.get(key) ?? 0) + 1);
  };
  add(deck.commander);
  add(deck.partnerCommander);
  for (const row of deck.cards) add(row.card);

  let count = 0;
  const lines: string[] = [];
  for (const [key, n] of copies) {
    count += n;
    lines.push(`${key}x${n}`);
  }
  lines.sort();
  return `${count}:${fnv1a(lines.join('\n'))}`;
}

/** 32-bit FNV-1a, as 8 hex digits. A grouping key, not a security boundary:
 *  one account's few versions of one deck are far from 2^16 lists, where a
 *  32-bit hash starts to collide. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The card count out of a version label, or null for anything else. */
export function versionCardCount(version: string | null | undefined): number | null {
  const m = version ? /^(\d{1,4}):[0-9a-f]{8}$/.exec(version) : null;
  return m ? Number(m[1]) : null;
}

/** The version of one of this device's decks, or null for a deck it does not
 *  hold (a friend's, a starter) or no deck at all. */
export function versionOfDeckId(decks: readonly Deck[], deckId: string | null): string | null {
  const deck = deckId ? decks.find((d) => d.id === deckId) : undefined;
  return deck ? deckVersionOf(deck) : null;
}
