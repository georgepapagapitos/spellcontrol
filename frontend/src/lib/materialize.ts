import type {
  BinderDef,
  BinderPage,
  BinderSection,
  EnrichedCard,
  MaterializedBinder,
  Page,
  PocketSize,
  SortField,
  UnbinnedBucket,
} from '../types';
import { COLOR_ORDER, getColorKey } from './colors';
import { cardMatchesRules } from './rules';
import { sortCards } from './sorting';

export interface MaterializeOptions {
  globalPocketSize?: PocketSize;
  search: string;
  /** Sort applied to the unbinned bucket. */
  unbinnedSorts?: SortField[];
}

const DEFAULT_UNBINNED_SORTS: SortField[] = ['color', 'cmc', 'name'];

/** Fallback pocket size for binders that don't specify one and for the unbinned bucket. */
export const DEFAULT_POCKET_SIZE: PocketSize = 9;

/**
 * Routes cards through binder definitions in priority order.
 * Each card joins the FIRST binder whose rules match. Unmatched cards land in the unbinned bucket.
 */
export function materializeBinders(
  cards: EnrichedCard[],
  binderDefs: BinderDef[],
  opts: MaterializeOptions
): { binders: MaterializedBinder[]; unbinned: UnbinnedBucket } {
  const search = opts.search.trim().toLowerCase();
  const isMatch = search
    ? (c: EnrichedCard) => c.name.toLowerCase().includes(search)
    : () => true;

  const orderedDefs = [...binderDefs].sort((a, b) => a.position - b.position);

  const buckets = new Map<string, EnrichedCard[]>();
  orderedDefs.forEach((d) => buckets.set(d.id, []));
  const unbinned: EnrichedCard[] = [];

  for (const card of cards) {
    let matched = false;
    for (const def of orderedDefs) {
      if (cardMatchesRules(card, def.rules)) {
        buckets.get(def.id)!.push(card);
        matched = true;
        break;
      }
    }
    if (!matched) unbinned.push(card);
  }

  const materialized: MaterializedBinder[] = orderedDefs.map((def) => {
    const cardsInBinder = buckets.get(def.id)!;
    const effectivePocketSize = (def.pocketSize ?? (opts.globalPocketSize ?? DEFAULT_POCKET_SIZE)) as PocketSize;
    const sections = buildSections(cardsInBinder, def.sorts, effectivePocketSize, isMatch);
    return {
      def,
      effectivePocketSize,
      sections,
      totalCards: sections.reduce((s, sec) => s + sec.cards.length, 0),
      totalPages: sections.reduce((s, sec) => s + sec.pages.length, 0),
    };
  });

  const unbinnedSorts = opts.unbinnedSorts ?? DEFAULT_UNBINNED_SORTS;
  const unbinnedSections = buildSections(
    unbinned,
    unbinnedSorts,
    (opts.globalPocketSize ?? DEFAULT_POCKET_SIZE),
    isMatch
  );

  return {
    binders: materialized,
    unbinned: {
      totalCards: unbinnedSections.reduce((s, sec) => s + sec.cards.length, 0),
      sections: unbinnedSections,
      totalPages: unbinnedSections.reduce((s, sec) => s + sec.pages.length, 0),
      effectivePocketSize: (opts.globalPocketSize ?? DEFAULT_POCKET_SIZE),
    },
  };
}

function buildSections(
  cards: EnrichedCard[],
  sorts: SortField[],
  slotSize: number,
  isMatch: (c: EnrichedCard) => boolean
): BinderSection[] {
  const primary = sorts[0];
  const groupByColor = !primary || primary === 'none' || primary === 'color';

  const buildSection = (colorKey: string, sectionCards: EnrichedCard[]): BinderSection | null => {
    const pages = chunkIntoPages(sectionCards, slotSize, isMatch);
    const matchingCards = sectionCards.filter(isMatch);
    if (matchingCards.length === 0) return null;
    return { colorKey, cards: matchingCards, pages };
  };

  if (!groupByColor) {
    const sorted = sortCards(cards, sorts);
    const section = buildSection('ALL', sorted);
    return section ? [section] : [];
  }

  const groups: Record<string, EnrichedCard[]> = {};
  for (const card of cards) {
    const key = getColorKey(card);
    if (!groups[key]) groups[key] = [];
    groups[key].push(card);
  }

  const subSorts = sorts.slice(1);
  const sections: BinderSection[] = [];

  for (const colorKey of COLOR_ORDER) {
    if (groups[colorKey] && groups[colorKey].length > 0) {
      const sorted = sortCards(groups[colorKey], subSorts);
      const section = buildSection(colorKey, sorted);
      if (section) sections.push(section);
    }
  }

  for (const colorKey of Object.keys(groups)) {
    if (!COLOR_ORDER.includes(colorKey)) {
      const sorted = sortCards(groups[colorKey], subSorts);
      const section = buildSection(colorKey, sorted);
      if (section) sections.push(section);
    }
  }

  return sections;
}

/**
 * Slice the section's full card list into physical pages, then keep only pages
 * that contain a search match. Surviving pages preserve their original 1-based
 * page number and replace non-matching slots with null so a match stays in its
 * real physical position.
 */
function chunkIntoPages(
  cards: EnrichedCard[],
  slotSize: number,
  isMatch: (c: EnrichedCard) => boolean
): BinderPage[] {
  if (slotSize <= 0) slotSize = 9;
  const pages: BinderPage[] = [];
  let pageNum = 0;
  for (let i = 0; i < cards.length; i += slotSize) {
    pageNum += 1;
    const window = cards.slice(i, i + slotSize);
    const slots: Page = window.map((c) => (isMatch(c) ? c : null));
    while (slots.length < slotSize) slots.push(null);
    if (slots.some((c) => c !== null)) {
      pages.push({ slots, pageNum });
    }
  }
  return pages;
}
