import type {
  BinderDef,
  BinderPage,
  BinderSection,
  EnrichedCard,
  MaterializedBinder,
  Page,
  PocketSize,
  SetMap,
  SortEntry,
  SortField,
  UncategorizedBucket,
} from './types.js';
import { compileFilterGroups, cardMatchesAnyGroup, cardMatchesCompiled } from './rules.js';
import { ALL_SECTION, getSectionMeta, type SectionMeta } from './sections.js';
import {
  sortCards,
  buildQtyByPrintingKey,
  getImplicitTiebreakers,
  getDisplaySorts,
} from './sorting.js';

export interface MaterializeOptions {
  globalPocketSize?: PocketSize;
  search: string;
  /** Sort applied to the uncategorized bucket. */
  uncategorizedSorts?: SortEntry[];
  /** copyIds currently allocated to any deck. Binders with hideDeckAllocated=false
   *  skip these cards entirely — they aren't routed to that binder, don't fall
   *  through to other binders, and don't land in Uncategorized. */
  allocatedCopyIds?: ReadonlySet<string>;
  /** Scryfall set metadata. When provided, "set" sort uses release date. */
  setMap?: SetMap;
}

const DEFAULT_UNCATEGORIZED_SORTS: SortEntry[] = [
  { field: 'color', dir: 'asc' },
  { field: 'cmc', dir: 'asc' },
  { field: 'name', dir: 'asc' },
];

/** Fallback pocket size for binders that don't specify one and for the uncategorized bucket. */
const DEFAULT_POCKET_SIZE: PocketSize = 9;

const EMPTY_SET: ReadonlySet<string> = new Set();

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
  const defsById = new Map(orderedDefs.map((d) => [d.id, d]));
  const allocated = opts.allocatedCopyIds ?? EMPTY_SET;

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
    const isAllocated = allocated.has(card.copyId);

    // Pinned cards go directly to their binder, bypassing rule routing.
    const claimedBy = reservedToBinder.get(card.copyId);
    if (claimedBy) {
      const claimingDef = defsById.get(claimedBy)!;
      // If the pinning binder hides deck-allocated cards and this card is in a
      // deck, swallow it — don't render anywhere, but keep the pin metadata so
      // it returns to its slot when the deck releases it.
      if (isAllocated && claimingDef.hideDeckAllocated === false) continue;
      buckets.get(claimedBy)?.push(card);
      continue;
    }
    let matched = false;
    let swallowed = false;
    for (let i = 0; i < orderedDefs.length; i++) {
      const def = orderedDefs[i];
      if (def.mode === 'manual') continue;
      if (cardMatchesAnyGroup(card, compiledGroups[i])) {
        if (isAllocated && def.hideDeckAllocated === false) {
          // First matching binder hides deck-allocated cards: card is dropped
          // from the binder system entirely (not routed to a later binder, not
          // sent to uncategorized). It returns when un-allocated.
          swallowed = true;
        } else {
          buckets.get(def.id)!.push(card);
          matched = true;
        }
        break;
      }
    }
    if (!matched && !swallowed) uncategorized.push(card);
  }

  // "Keep all printings together": for each opted-in binder (rules mode only),
  // a card that matched its rules via any owned copy reclaims that card's
  // OTHER owned copies (same Scryfall oracleId) from Uncategorized. We only
  // reclaim from Uncategorized — copies already routed to another binder keep
  // first-match-wins precedence, so a card is never duplicated across binders.
  // Pinned copies don't trigger promotion (pins are explicit). Processing
  // binders in position order lets an earlier opted-in binder reclaim first.
  for (let i = 0; i < orderedDefs.length; i++) {
    const def = orderedDefs[i];
    if (!def.keepPrintingsTogether || def.mode === 'manual') continue;
    const bucket = buckets.get(def.id)!;
    const pinned = new Set(def.pinnedCopyIds ?? []);
    const wanted = new Set<string>();
    for (const c of bucket) {
      if (c.oracleId && !pinned.has(c.copyId)) wanted.add(c.oracleId);
    }
    if (wanted.size === 0) continue;
    const kept: EnrichedCard[] = [];
    for (const card of uncategorized) {
      if (card.oracleId !== undefined && wanted.has(card.oracleId)) {
        // Mirror the main loop's swallow rule for deck-allocated copies.
        if (allocated.has(card.copyId) && def.hideDeckAllocated === false) continue;
        bucket.push(card);
      } else {
        kept.push(card);
      }
    }
    uncategorized.length = 0;
    for (const c of kept) uncategorized.push(c);
  }

  const materialized: MaterializedBinder[] = orderedDefs.map((def) => {
    const rawCards = buildBinderCards(def, buckets.get(def.id)!, cardsByCopyId);
    const effectivePocketSize = (def.pocketSize ??
      opts.globalPocketSize ??
      DEFAULT_POCKET_SIZE) as PocketSize;
    const useManualOrder = !!def.manualOrder?.length;
    const effectiveSorts = useManualOrder ? [] : withImplicitTiebreaker(def.sorts);
    const sortCtx = {
      setMap: opts.setMap,
      qtyByPrintingKey: buildQtyByPrintingKey(rawCards),
      valueOrders: def.sortValueOrders,
    };
    const sections = useManualOrder
      ? buildManualSection(rawCards, effectivePocketSize, isMatch)
      : def.sectionMode === 'group'
        ? buildGroupSections(rawCards, def, effectiveSorts, effectivePocketSize, isMatch, sortCtx)
        : buildSections(
            rawCards,
            effectiveSorts,
            effectivePocketSize,
            isMatch,
            sortCtx,
            def.pageBreakDepth ?? 1
          );
    return {
      def,
      effectivePocketSize,
      effectiveSorts,
      displaySorts: getDisplaySorts(effectiveSorts, def.sorts, def.sortValueOrders),
      sections,
      totalCards: sections.reduce((s, sec) => s + sec.cards.length, 0),
      totalPages: sections.reduce((s, sec) => s + sec.pages.length, 0),
      totalValue: sections.reduce(
        (s, sec) => s + sec.cards.reduce((cs, c) => cs + c.purchasePrice, 0),
        0
      ),
    };
  });

  const uncategorizedSorts = withImplicitTiebreaker(
    opts.uncategorizedSorts ?? DEFAULT_UNCATEGORIZED_SORTS
  );
  const uncatCtx = {
    setMap: opts.setMap,
    qtyByPrintingKey: buildQtyByPrintingKey(uncategorized),
  };
  const uncategorizedSections = buildSections(
    uncategorized,
    uncategorizedSorts,
    opts.globalPocketSize ?? DEFAULT_POCKET_SIZE,
    isMatch,
    uncatCtx
  );

  return {
    binders: materialized,
    uncategorized: {
      totalCards: uncategorizedSections.reduce((s, sec) => s + sec.cards.length, 0),
      sections: uncategorizedSections,
      totalPages: uncategorizedSections.reduce((s, sec) => s + sec.pages.length, 0),
      effectivePocketSize: opts.globalPocketSize ?? DEFAULT_POCKET_SIZE,
      effectiveSorts: uncategorizedSorts,
      displaySorts: getDisplaySorts(
        uncategorizedSorts,
        opts.uncategorizedSorts ?? DEFAULT_UNCATEGORIZED_SORTS
      ),
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
 * Append implicit tiebreakers so cards that compare equal across all chosen
 * sort fields land in a stable, meaningful order. Treatment groups fancy
 * frames before the plain printing; finish puts foils before non-foils;
 * name is the final alphabetical fallback. Any field already in the user's
 * chain is left alone so their explicit choice wins.
 */
function withImplicitTiebreaker(sorts: SortEntry[]): SortEntry[] {
  const extras = getImplicitTiebreakers(sorts);
  return extras.length ? [...sorts, ...extras] : sorts;
}

function buildSections(
  cards: EnrichedCard[],
  sorts: SortEntry[],
  slotSize: number,
  isMatch: (c: EnrichedCard) => boolean,
  ctx?: {
    setMap?: SetMap;
    qtyByPrintingKey?: Map<string, number>;
    valueOrders?: Partial<Record<SortField, string[]>>;
  },
  pageBreakDepth = 1,
  pageOffsetRef = { value: 0 }
): BinderSection[] {
  const primary = sorts[0];
  const useGrouping = !!primary && primary.field !== 'none';

  const buildSection = (meta: SectionMeta, sectionCards: EnrichedCard[]): BinderSection | null => {
    const effectiveSlots = slotSize > 0 ? slotSize : 9;
    const sectionPageCount = Math.ceil(sectionCards.length / effectiveSlots);
    const pages = chunkIntoPages(sectionCards, slotSize, isMatch, pageOffsetRef.value);
    pageOffsetRef.value += sectionPageCount;
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
    const sorted = sortCards(cards, sorts, ctx);
    const section = buildSection(ALL_SECTION, sorted);
    return section ? [section] : [];
  }

  // Group by primary sort. Preserve first-seen meta so set-name/label is captured
  // from a real card (avoids needing a second lookup table).
  const groups = new Map<string, { meta: SectionMeta; cards: EnrichedCard[] }>();
  for (const card of cards) {
    const meta = getSectionMeta(card, primary.field, ctx);
    const entry = groups.get(meta.key);
    if (entry) entry.cards.push(card);
    else groups.set(meta.key, { meta, cards: [card] });
  }

  // Section ordering: by meta.order, ties broken by label (alphabetical).
  // For set/name groupings, all groups share order=0 so label sort kicks in.
  // When the primary sort is descending, both layers are reversed.
  const dirMult = primary.dir === 'desc' ? -1 : 1;
  const ordered = [...groups.values()].sort((a, b) => {
    if (a.meta.order !== b.meta.order) return (a.meta.order - b.meta.order) * dirMult;
    return a.meta.label.localeCompare(b.meta.label) * dirMult;
  });

  const subSorts = sorts.slice(1);
  const sections: BinderSection[] = [];
  for (const { meta, cards: gCards } of ordered) {
    if (pageBreakDepth > 1 && subSorts.length > 0) {
      // Recurse: sub-sorts also break pages. Each sub-group starts fresh.
      // pageOffsetRef is threaded through so page numbers stay globally monotonic.
      const subSections = buildSections(
        gCards,
        subSorts,
        slotSize,
        isMatch,
        ctx,
        pageBreakDepth - 1,
        pageOffsetRef
      );
      sections.push(...subSections);
    } else {
      // Leaf behavior (depth=1 or no more sorts): sort cards flat, pack into pages.
      const sorted = sortCards(gCards, subSorts, ctx);
      const section = buildSection(meta, sorted);
      if (section) sections.push(section);
    }
  }
  return sections;
}

/**
 * Sections driven by filterGroups: one section per group, in group definition
 * order. Cards are assigned by first-matching-group-wins (same semantics as the
 * cross-binder routing so the labeling is consistent). Empty sections are omitted.
 * Within each section, cards are sorted by `sorts`.
 */
function buildGroupSections(
  cards: EnrichedCard[],
  def: BinderDef,
  sorts: SortEntry[],
  slotSize: number,
  isMatch: (c: EnrichedCard) => boolean,
  ctx?: { setMap?: SetMap; qtyByPrintingKey?: Map<string, number> }
): BinderSection[] {
  const compiled = compileFilterGroups(def.filterGroups);
  // Assign each card to its first matching group (index), or fall through to the last bucket.
  const buckets: EnrichedCard[][] = def.filterGroups.map(() => []);
  const assigned = new Set<string>(); // copyIds
  for (const card of cards) {
    for (let i = 0; i < compiled.length; i++) {
      if (cardMatchesCompiled(card, compiled[i])) {
        buckets[i].push(card);
        assigned.add(card.copyId);
        break;
      }
    }
  }
  // Any card that slipped through (shouldn't happen but defensive) goes in the last bucket.
  for (const card of cards) {
    if (!assigned.has(card.copyId)) buckets[buckets.length - 1].push(card);
  }

  let pageOffset = 0;
  const sections: BinderSection[] = [];
  for (let i = 0; i < def.filterGroups.length; i++) {
    const group = def.filterGroups[i];
    const groupCards = buckets[i];
    if (groupCards.length === 0) continue; // hide empty sections

    const label = group.name?.trim() || `Group ${i + 1}`;
    const key = `group-${i}`;
    const sorted = sortCards(groupCards, sorts, ctx);

    const effectiveSlots = slotSize > 0 ? slotSize : 9;
    const sectionPageCount = Math.ceil(sorted.length / effectiveSlots);
    const pages = chunkIntoPages(sorted, slotSize, isMatch, pageOffset);
    pageOffset += sectionPageCount;
    const matchingCards = sorted.filter(isMatch);
    if (matchingCards.length === 0) continue; // skip if search hides all cards in this group

    sections.push({ key, label, cards: matchingCards, pages });
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
