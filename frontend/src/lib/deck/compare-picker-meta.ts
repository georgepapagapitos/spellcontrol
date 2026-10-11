import { formatRelativeTime } from '@/lib/util/format-time';

interface PickerDeck {
  id: string;
  name: string;
  cards: readonly unknown[];
  updatedAt: number;
}

/**
 * The size + edited line under each deck in the /decks/compare picker.
 *
 * Relative time collapses to day granularity past 24h, and every Commander
 * deck is 99 cards, so three decks named after the same commander and edited
 * the same day would render identical rows (E322). Only those rows fall back
 * to an absolute, locale-formatted date and time; every other row keeps the
 * short relative form.
 */
export function deckPickerMeta(
  decks: readonly PickerDeck[],
  now: number = Date.now()
): Map<string, string> {
  const relative = (d: PickerDeck) =>
    `${d.cards.length} cards · Edited ${formatRelativeTime(d.updatedAt, { now })}`;
  const seen = new Map<string, number>();
  for (const d of decks) {
    const key = `${d.name}\u0000${relative(d)}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const d of decks) {
    const tied = (seen.get(`${d.name}\u0000${relative(d)}`) ?? 0) > 1;
    out.set(
      d.id,
      tied
        ? `${d.cards.length} cards · Edited ${new Date(d.updatedAt).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}`
        : relative(d)
    );
  }
  return out;
}
