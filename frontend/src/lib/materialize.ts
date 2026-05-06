import type {
  BinderDef,
  BinderPage,
  BinderSection,
  EnrichedCard,
  MaterializedBinder,
  Page,
  PocketSize,
  SortField,
  UncategorizedBucket,
} from '../types';
import { COLOR_ORDER, getColorKey } from './colors';
import { cardMatchesRules } from './rules';
import { sortCards } from './sorting';

export interface MaterializeOptions {
  globalPocketSize?: PocketSize;
  search: string;
  /** Sort applied to the uncategorized bucket. */
  uncategorizedSorts?: SortField[];
}

const DEFAULT_UNCATEGORIZED_SORTS: SortField[] = ['color', 'cmc', 'name'];

/** Fallback pocket size for binders that don't specify one and for the uncategorized bucket. */
export const DEFAULT_POCKET_SIZE: PocketSize = 9;

/**
 * Routes cards through binder definitions in priority order.
 * Each card joins the FIRST binder whose rules match. Unmatched cards land in the uncategorized bucket.
 */
export function materializeBinders(
  cards: EnrichedCard[],
  binderDefs: BinderDef[],
  opts: MaterializeOptions
): { binders: MaterializedBinder[]; uncategorized: UncategorizedBucket } {
  const search = opts.search.trim().toLowerCase();
  const isMatch = search ? (c: EnrichedCard) => c.name.toLowerCase().includes(search) : () => true;

  const orderedDefs = [...binderDefs].sort((a, b) => a.position - b.position);

  const buckets = new Map<string, EnrichedCard[]>();
  orderedDefs.forEach((d) => buckets.set(d.id, []));
  const uncategorized: EnrichedCard[] = [];

  for (const card of cards) {
    let matched = false;
    for (const def of orderedDefs) {
      if (cardMatchesRules(card, def.rules)) {
        buckets.get(def.id)!.push(card);
        matched = true;
        break;
      }
    }
    if (!matched) uncategorized.push(card);
  }

  const materialized: MaterializedBinder[] = orderedDefs.map((def) => {
    const cardsInBinder = buckets.get(def.id)!;
    const effectivePocketSize = (def.pocketSize ??
      opts.globalPocketSize ??
      DEFAULT_POCKET_SIZE) as PocketSize;
    const sections = buildSections(cardsInBinder, def.sorts, effectivePocketSize, isMatch);
    return {
      def,
      effectivePocketSize,
      sections,
      totalCards: sections.reduce((s, sec) => s + sec.cards.length, 0),
      totalPages: sections.reduce((s, sec) => s + sec.pages.length, 0),
    };
  });

  const uncategorizedSorts = opts.uncategorizedSorts ?? DEFAULT_UNCATEGORIZED_SORTS;
  const uncategorizedSections = buildSections(
    uncategorized,
    uncategorizedSorts,
    opts.globalPocketSize ?? DEFAULT_POCKET_SIZE,
    isMatch
  );

  return {
    binders: materialized,
    uncategorized: {
      totalCards: uncategorizedSections.reduce((s, sec) => s + sec.cards.length, 0),
      sections: uncategorizedSections,
      totalPages: uncategorizedSections.reduce((s, sec) => s + sec.pages.length, 0),
      effectivePocketSize: opts.globalPocketSize ?? DEFAULT_POCKET_SIZE,
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

  let pageOffset = 0;
  const buildSection = (colorKey: string, sectionCards: EnrichedCard[]): BinderSection | null => {
    const sectionPageCount = Math.ceil(sectionCards.length / (slotSize > 0 ? slotSize : 9));
    const pages = chunkIntoPages(sectionCards, slotSize, isMatch, pageOffset);
    pageOffset += sectionPageCount;
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
  isMatch: (c: EnrichedCard) => boolean,
  pageOffset = 0
): BinderPage[] {
  if (slotSize <= 0) slotSize = 9;
  const pages: BinderPage[] = [];
  let pageNum = pageOffset;
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
