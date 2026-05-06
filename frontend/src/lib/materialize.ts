import type {
  BinderDef,
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
  globalPocketSize: PocketSize;
  search: string;
  /** Sort applied to the unbinned bucket. */
  unbinnedSorts?: SortField[];
}

const DEFAULT_UNBINNED_SORTS: SortField[] = ['color', 'cmc', 'name'];

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
  const filtered = search
    ? cards.filter((c) => c.name.toLowerCase().includes(search))
    : cards;

  const orderedDefs = [...binderDefs].sort((a, b) => a.position - b.position);

  const buckets = new Map<string, EnrichedCard[]>();
  orderedDefs.forEach((d) => buckets.set(d.id, []));
  const unbinned: EnrichedCard[] = [];

  for (const card of filtered) {
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
    const effectivePocketSize = (def.pocketSize ?? opts.globalPocketSize) as PocketSize;
    const sections = buildSections(cardsInBinder, def.sorts, effectivePocketSize);
    return {
      def,
      effectivePocketSize,
      sections,
      totalCards: cardsInBinder.length,
      totalPages: sections.reduce((s, sec) => s + sec.pages.length, 0),
    };
  });

  const unbinnedSorts = opts.unbinnedSorts ?? DEFAULT_UNBINNED_SORTS;
  const unbinnedSections = buildSections(unbinned, unbinnedSorts, opts.globalPocketSize);

  return {
    binders: materialized,
    unbinned: {
      totalCards: unbinned.length,
      sections: unbinnedSections,
      totalPages: unbinnedSections.reduce((s, sec) => s + sec.pages.length, 0),
      effectivePocketSize: opts.globalPocketSize,
    },
  };
}

function buildSections(
  cards: EnrichedCard[],
  sorts: SortField[],
  slotSize: number
): BinderSection[] {
  const primary = sorts[0];
  const groupByColor = !primary || primary === 'none' || primary === 'color';

  if (!groupByColor) {
    const sorted = sortCards(cards, sorts);
    return [
      {
        colorKey: 'ALL',
        cards: sorted,
        pages: chunkIntoPages(sorted, slotSize),
      },
    ];
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
      sections.push({
        colorKey,
        cards: sorted,
        pages: chunkIntoPages(sorted, slotSize),
      });
    }
  }

  for (const colorKey of Object.keys(groups)) {
    if (!COLOR_ORDER.includes(colorKey)) {
      const sorted = sortCards(groups[colorKey], subSorts);
      sections.push({
        colorKey,
        cards: sorted,
        pages: chunkIntoPages(sorted, slotSize),
      });
    }
  }

  return sections;
}

function chunkIntoPages(cards: EnrichedCard[], slotSize: number): Page[] {
  const pages: Page[] = [];
  for (let i = 0; i < cards.length; i += slotSize) {
    const page: Page = cards.slice(i, i + slotSize);
    while (page.length < slotSize) page.push(null);
    pages.push(page);
  }
  return pages;
}
