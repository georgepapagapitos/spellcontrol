import type { Deck } from '../store/decks';

/**
 * One label per deck for a picker, guaranteed distinct.
 *
 * Generation names a deck after its commander, so an account that rebuilt
 * around a favourite has several "Abigale · Abigale, Eloquent First-Year"
 * rows. B7-04 appended the card count to colliding rows — but every generated
 * Commander deck is 99 cards, so the dev account's four Abigales still read as
 * four identical rows (playtest batch 7). Each tier below only kicks in for
 * rows that still collide after the previous one:
 *   name · commander  →  + card count  →  + last edited  →  + (n)
 */
export function deckPickerLabels(decks: readonly Deck[]): string[] {
  let labels = decks.map((d) => (d.commander ? `${d.name} · ${d.commander.name}` : d.name));
  const tiers: ((d: Deck) => string)[] = [
    (d) => `${d.cards.length} cards`,
    (d) => `edited ${new Date(d.updatedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}`,
  ];
  for (const tier of tiers) {
    const counts = countBy(labels);
    labels = labels.map((l, i) => ((counts.get(l) ?? 0) > 1 ? `${l} · ${tier(decks[i])}` : l));
  }
  // Same name, commander, size and day: number them, in list order.
  const counts = countBy(labels);
  const seen = new Map<string, number>();
  return labels.map((l) => {
    if ((counts.get(l) ?? 0) <= 1) return l;
    const n = (seen.get(l) ?? 0) + 1;
    seen.set(l, n);
    return `${l} (${n})`;
  });
}

function countBy(labels: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  return counts;
}
