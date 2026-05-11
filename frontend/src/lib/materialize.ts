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
import { compileFilterGroups, cardMatchesAnyGroup } from './rules';
import { ALL_SECTION, getSectionMeta, type SectionMeta } from './sections';
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
 * Pinned cards (def.pinnedCopyIds) are claimed before rule routing so they can't appear in other binders.
 */
export function materializeBinders(
  cards: EnrichedCard[],
  binderDefs: BinderDef[],
  opts: MaterializeOptions
): { binders: MaterializedBinder[]; uncategorized: UncategorizedBucket } {
  const search = opts.search.trim().toLowerCase();
  const isMatch = search ? (c: EnrichedCard) => c.name.toLowerCase().includes(search) : () => true;

  const orderedDefs = [...binderDefs].sort((a, b) => a.position - b.position);
  // Compile each binder's groups once. Outer index = binder, inner = OR-branches.
  const compiledGroups = orderedDefs.map((d) => compileFilterGroups(d.filterGroups));

  // Pre-claim pinned cards: first binder that pins a copyId wins (by position).
  const reservedToBinder = new Map<string, string>(); // copyId → binderId
  for (const def of orderedDefs) {
    for (const copyId of def.pinnedCopyIds ?? []) {
      if (!reservedToBinder.has(copyId)) {
        reservedToBinder.set(copyId, def.id);
      }
    }
  }

  const cardsByCopyId = new Map<string, EnrichedCard>(cards.map((c) => [c.copyId, c]));

  const buckets = new Map<string, EnrichedCard[]>();
  orderedDefs.forEach((d) => buckets.set(d.id, []));
  const uncategorized: EnrichedCard[] = [];

  for (const card of cards) {
    // Pinned cards go directly to their binder, bypassing rule routing.
    const claimedBy = reservedToBinder.get(card.copyId);
    if (claimedBy) {
      buckets.get(claimedBy)?.push(card);
      continue;
    }
    let matched = false;
    for (let i = 0; i < orderedDefs.length; i++) {
      if (cardMatchesAnyGroup(card, compiledGroups[i])) {
        buckets.get(orderedDefs[i].id)!.push(card);
        matched = true;
        break;
      }
    }
    if (!matched) uncategorized.push(card);
  }

  const materialized: MaterializedBinder[] = orderedDefs.map((def) => {
    const rawCards = buildBinderCards(def, buckets.get(def.id)!, cardsByCopyId);
    const effectivePocketSize = (def.pocketSize ??
      opts.globalPocketSize ??
      DEFAULT_POCKET_SIZE) as PocketSize;
    const useManualOrder = !!def.manualOrder?.length;
    const effectiveSorts = useManualOrder ? [] : withImplicitTiebreaker(def.sorts);
    const sections = useManualOrder
      ? buildManualSection(rawCards, effectivePocketSize, isMatch)
      : buildSections(rawCards, effectiveSorts, effectivePocketSize, isMatch);
    return {
      def,
      effectivePocketSize,
      effectiveSorts,
      sections,
      totalCards: sections.reduce((s, sec) => s + sec.cards.length, 0),
      totalPages: sections.reduce((s, sec) => s + sec.pages.length, 0),
    };
  });

  const uncategorizedSorts = withImplicitTiebreaker(
    opts.uncategorizedSorts ?? DEFAULT_UNCATEGORIZED_SORTS
  );
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
      effectiveSorts: uncategorizedSorts,
    },
  };
}

/**
 * Applies per-binder exclusions and manual ordering to the raw bucket of cards.
 * Returns the card list that should be passed to section-building.
 */
function buildBinderCards(
  def: BinderDef,
  bucket: EnrichedCard[],
  _cardsByCopyId: Map<string, EnrichedCard>
): EnrichedCard[] {
  const excluded = new Set(def.excludedCopyIds ?? []);
  const cards = bucket.filter((c) => !excluded.has(c.copyId));

  if (!def.manualOrder?.length) return cards;

  // Manual order: cards appear in the specified order; any cards not in the
  // list (new rule matches or pins added after the order was set) are appended.
  const byId = new Map(cards.map((c) => [c.copyId, c]));
  const seen = new Set<string>();
  const ordered: EnrichedCard[] = [];
  for (const id of def.manualOrder) {
    const card = byId.get(id);
    if (card) {
      ordered.push(card);
      seen.add(id);
    }
  }
  for (const card of cards) {
    if (!seen.has(card.copyId)) ordered.push(card);
  }
  return ordered;
}

/**
 * Builds a single flat section for binders with manual ordering.
 * Skips the primary-sort grouping since the user's drag order is authoritative.
 */
function buildManualSection(
  cards: EnrichedCard[],
  slotSize: PocketSize,
  isMatch: (c: EnrichedCard) => boolean
): BinderSection[] {
  const pages = chunkIntoPages(cards, slotSize, isMatch, 0);
  const matchingCards = cards.filter(isMatch);
  if (!matchingCards.length) return [];
  return [{ key: ALL_SECTION.key, label: ALL_SECTION.label, cards: matchingCards, pages }];
}

/**
 * Append "name" as a deterministic final tiebreaker so cards that compare equal
 * across all chosen sort fields land in stable alphabetical order instead of
 * import order. Skipped if name is already in the chain.
 */
function withImplicitTiebreaker(sorts: SortField[]): SortField[] {
  const active = sorts.filter((s) => s && s !== 'none');
  if (active.includes('name')) return sorts;
  return [...sorts, 'name'];
}

function buildSections(
  cards: EnrichedCard[],
  sorts: SortField[],
  slotSize: number,
  isMatch: (c: EnrichedCard) => boolean
): BinderSection[] {
  const primary = sorts[0];
  const useGrouping = !!primary && primary !== 'none';

  let pageOffset = 0;
  const buildSection = (meta: SectionMeta, sectionCards: EnrichedCard[]): BinderSection | null => {
    const effectiveSlots = slotSize > 0 ? slotSize : 9;
    const sectionPageCount = Math.ceil(sectionCards.length / effectiveSlots);
    const pages = chunkIntoPages(sectionCards, slotSize, isMatch, pageOffset);
    pageOffset += sectionPageCount;
    const matchingCards = sectionCards.filter(isMatch);
    if (matchingCards.length === 0) return null;
    return {
      key: meta.key,
      label: meta.label,
      pip: meta.pip,
      cards: matchingCards,
      pages,
    };
  };

  if (!useGrouping) {
    const sorted = sortCards(cards, sorts);
    const section = buildSection(ALL_SECTION, sorted);
    return section ? [section] : [];
  }

  // Group by primary sort. Preserve first-seen meta so set-name/label is captured
  // from a real card (avoids needing a second lookup table).
  const groups = new Map<string, { meta: SectionMeta; cards: EnrichedCard[] }>();
  for (const card of cards) {
    const meta = getSectionMeta(card, primary);
    const entry = groups.get(meta.key);
    if (entry) entry.cards.push(card);
    else groups.set(meta.key, { meta, cards: [card] });
  }

  // Section ordering: by meta.order, ties broken by label (alphabetical).
  // For set/name groupings, all groups share order=0 so label sort kicks in.
  const ordered = [...groups.values()].sort((a, b) => {
    if (a.meta.order !== b.meta.order) return a.meta.order - b.meta.order;
    return a.meta.label.localeCompare(b.meta.label);
  });

  const subSorts = sorts.slice(1);
  const sections: BinderSection[] = [];
  for (const { meta, cards: gCards } of ordered) {
    const sorted = sortCards(gCards, subSorts);
    const section = buildSection(meta, sorted);
    if (section) sections.push(section);
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
