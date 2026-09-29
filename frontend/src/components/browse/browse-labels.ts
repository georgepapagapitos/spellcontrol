import { formatDeckCount } from '@/components/deck/CommanderResultCard';
import { saltBandWord } from '@/components/deck/SaltiestPanel';
import { classifyInclusion } from '@/lib/inclusion-label';
import type { BrowseItem, BrowseListId } from '@/lib/browse-lists';

/** "Released Aug 14", with the year only when it isn't this one. */
function releaseLabel(date: string, now = new Date()): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return `Released ${d.toLocaleDateString(undefined, opts)}`;
}

/**
 * The one line under a tile: what the list ranks the card by. Game Changers
 * and the ban list rank nothing, so they have none.
 */
export function browseStat(list: BrowseListId, item: BrowseItem): string | null {
  switch (list) {
    case 'commanders':
      return item.numDecks ? formatDeckCount(item.numDecks) : null;
    case 'cards':
      if (item.potentialDecks && item.numDecks) {
        return classifyInclusion((item.numDecks / item.potentialDecks) * 100).label;
      }
      return item.numDecks ? formatDeckCount(item.numDecks) : null;
    case 'salt':
      return item.salt != null ? `Salt ${item.salt.toFixed(2)}` : null;
    case 'new-commanders':
      return item.releasedAt ? releaseLabel(item.releasedAt) || null : null;
    default:
      return null;
  }
}

/** The longer line the card preview shows under the art, where there's room
 *  to say what the number means. */
export function browsePreviewLabel(list: BrowseListId, item: BrowseItem, title: string): string {
  if (list === 'cards' && item.potentialDecks && item.numDecks) {
    const pct = Math.round((item.numDecks / item.potentialDecks) * 100);
    if (pct >= 1) return `In ${pct}% of the decks that could run it`;
  }
  if (list === 'salt' && item.salt != null) {
    return `Salt ${item.salt.toFixed(2)} of 4 · ${saltBandWord(item.salt)}`;
  }
  return browseStat(list, item) ?? title;
}
