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
import {
  compileFilterGroups,
  cardMatchesAnyGroup,
  cardMatchesCompiled,
  PRICE_STICKINESS_MARGIN,
} from './rules.js';
import { ALL_SECTION, getSectionMeta, type SectionMeta } from './sections.js';
import {
  sortCards,
  buildQtyByPrintingKey,
  getImplicitTiebreakers,
  getDisplaySorts,
  printingFinishKey,
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

/** Number of pages needed to hold `cardCount` cards in a pocket of `slotSize`. */
function countPages(cardCount: number, slotSize: number): number {
  const effective = slotSize > 0 ? slotSize : 9;
  return Math.ceil(cardCount / effective);
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Routes cards through binder definitions in priority order.
 * Each card joins the FIRST binder whose rules match. Unmatched cards land in the uncategorized bucket.
 * Pinned cards (def.pinnedCopyIds) are claimed before rule routing so they can't appear in other binders.
 */
/**
 * A deck-allocated copy is "swallowed" by a binder that opts out of showing
 * deck-allocated cards (`hideDeckAllocated === false`): it renders nowhere but
 * keeps its routing so it returns when the deck releases it. Shared so the
 * three routing sites can't drift from each other (F36).
 */
function isSwallowedByBinder(isAllocated: boolean, def: BinderDef): boolean {
  return isAllocated && def.hideDeckAllocated === false;
}

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
  // Per-binder exclusion sets, same indexing as compiledGroups. A binder that
  // excludes a copyId must never claim it — the card falls through to the
  // next matching binder (or uncategorized) instead of vanishing into limbo.
  const excludedSets = orderedDefs.map((d) => new Set(d.excludedCopyIds ?? []));
  // Per-binder reviewed-membership keys, for the sticky price-retention pass.
  const snapshotKeySets = orderedDefs.map((d) => new Set(d.lastReviewedSnapshot?.keys ?? []));
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
      if (isSwallowedByBinder(isAllocated, claimingDef)) continue;
      buckets.get(claimedBy)?.push(card);
      continue;
    }
    // Sticky price retention: a card the user confirmed in a binder (its key
    // is in that binder's lastReviewedSnapshot) that now fails the binder's
    // rules ONLY by a within-margin price miss stays put — even when an
    // earlier binder matches it exactly. Without this, a card priced near a
    // priceMin/priceMax boundary flaps between binders (and churns the review
    // queue) on every daily price refresh. A snapshot binder that still
    // matches exactly is left to normal routing below, so first-match-wins
    // precedence and "rule edits re-route immediately" are unchanged.
    const cardKey = printingFinishKey(card);
    let stuck = false;
    for (let i = 0; i < orderedDefs.length; i++) {
      const def = orderedDefs[i];
      if (def.mode === 'manual') continue;
      if (!snapshotKeySets[i].has(cardKey)) continue;
      if (excludedSets[i].has(card.copyId)) continue; // exclusion is explicit intent
      if (cardMatchesAnyGroup(card, compiledGroups[i])) break; // exact match → normal routing
      if (!cardMatchesAnyGroup(card, compiledGroups[i], PRICE_STICKINESS_MARGIN)) continue;
      // Same swallow rule as pins/routing for deck-allocated copies.
      if (!isSwallowedByBinder(isAllocated, def)) {
        buckets.get(def.id)!.push(card);
      }
      stuck = true;
      break;
    }
    if (stuck) continue;

    let matched = false;
    let swallowed = false;
    for (let i = 0; i < orderedDefs.length; i++) {
      const def = orderedDefs[i];
      if (def.mode === 'manual') continue;
      if (!cardMatchesAnyGroup(card, compiledGroups[i])) continue;
      if (excludedSets[i].has(card.copyId)) continue; // excluded here: fall through
      if (isSwallowedByBinder(isAllocated, def)) {
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
    const excluded = excludedSets[i];
    const wanted = new Set<string>();
    for (const c of bucket) {
      if (c.oracleId && !pinned.has(c.copyId)) wanted.add(c.oracleId);
    }
    if (wanted.size === 0) continue;
    const kept: EnrichedCard[] = [];
    for (const card of uncategorized) {
      // A copy this binder excludes must never be pulled back in by promotion,
      // even if a sibling printing matched — exclusion is explicit intent.
      if (card.oracleId !== undefined && wanted.has(card.oracleId) && !excluded.has(card.copyId)) {
        // Same swallow rule as the main routing loop, for deck-allocated copies.
        if (isSwallowedByBinder(allocated.has(card.copyId), def)) continue;
        bucket.push(card);
      } else {
        kept.push(card);
      }
    }
    uncategorized.length = 0;
    for (const c of kept) uncategorized.push(c);
  }

  const materialized: MaterializedBinder[] = orderedDefs.map((def) => {
    const rawCards = buildBinderCards(def, buckets.get(def.id)!);
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
            def.pageBreakDepth ?? 1,
            { value: 0 },
            '',
            '',
            def.packSections ?? false
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
 * Applies manual ordering to the raw bucket of cards (exclusions are already
 * enforced upstream — an excluded copy never enters `bucket`). Returns the
 * card list that should be passed to section-building.
 */
function buildBinderCards(def: BinderDef, bucket: EnrichedCard[]): EnrichedCard[] {
  if (!def.manualOrder?.length) return bucket;

  // Manual order: cards appear in the specified order; any cards not in the
  // list (new rule matches or pins added after the order was set) are appended.
  const byId = new Map(bucket.map((c) => [c.copyId, c]));
  const seen = new Set<string>();
  const ordered: EnrichedCard[] = [];
  for (const id of def.manualOrder) {
    const card = byId.get(id);
    if (card) {
      ordered.push(card);
      seen.add(id);
    }
  }
  for (const card of bucket) {
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

/** A primary-sort group, before it becomes a section. */
interface SectionGroup {
  meta: SectionMeta;
  cards: EnrichedCard[];
  /** Labels of every group merged in, in order. Only set by `packGroups`. */
  labels?: string[];
}

/**
 * Flow consecutive groups onto shared pages (`BinderDef.packSections`).
 *
 * A group joins the section being built only while it fits *entirely* in the
 * space left on that section's last page — so a group is never split across a
 * page boundary, which is the property that matters when you're physically
 * sleeving cards. Once a section lands exactly on a page boundary the next
 * group starts a fresh section, which is what keeps every section owning whole
 * pages (the invariant the whole section→page render depends on) instead of
 * collapsing the binder into one giant merged section.
 *
 * A group bigger than a page always starts its own section, then the leftover
 * slots on its final page are offered to whatever comes next.
 *
 * `continuous` (`packSections: 'continuous'`) drops the fits-entirely check:
 * every group merges into the running section, which closes only when its
 * card count lands exactly on a page boundary. Cards flow edge-to-edge with
 * zero empty pockets (a group may span pages), and sections still own whole
 * pages — the boundary-closure is what keeps the binder from collapsing into
 * one giant merged section.
 */
function packGroups(
  ordered: SectionGroup[],
  slotSize: number,
  continuous: boolean
): SectionGroup[] {
  const packed: SectionGroup[] = [];
  for (const group of ordered) {
    const current = packed[packed.length - 1];
    const fill = current ? current.cards.length % slotSize : 0;
    if (current && fill > 0 && (continuous || fill + group.cards.length <= slotSize)) {
      current.cards.push(...group.cards);
      current.labels!.push(group.meta.label);
    } else {
      packed.push({ meta: group.meta, cards: [...group.cards], labels: [group.meta.label] });
    }
  }
  return packed;
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
  pageOffsetRef = { value: 0 },
  // When recursing for page-break depth > 1, the parent group's label/key are
  // threaded down so nested sub-sections read as "Red · 1 CMC" (not a bare
  // "1 CMC" that repeats per parent) and carry a unique key per parent group.
  labelPrefix = '',
  keyPrefix = '',
  packSections: boolean | 'continuous' = false
): BinderSection[] {
  const primary = sorts[0];
  const useGrouping = !!primary && primary.field !== 'none';

  const buildSection = (
    meta: SectionMeta,
    sectionCards: EnrichedCard[],
    labels?: string[]
  ): BinderSection | null => {
    const sectionPageCount = countPages(sectionCards.length, slotSize);
    const startPage = pageOffsetRef.value;
    const pages = chunkIntoPages(sectionCards, slotSize, isMatch, startPage);
    pageOffsetRef.value += sectionPageCount;
    // A merged section spans several groups, so the header alone can't say
    // which group sits on which page — stamp each surviving page with the
    // distinct labels of the cards physically on it. Recomputed from each
    // card (not from pre-merge group sizes) because the leaf re-sorts the
    // merged cards by the full chain, which can reorder across groups.
    if (labels && labels.length > 1 && primary) {
      const effSlot = slotSize > 0 ? slotSize : 9;
      for (const page of pages) {
        const idx = page.pageNum - 1 - startPage;
        const distinct: string[] = [];
        for (const c of sectionCards.slice(idx * effSlot, (idx + 1) * effSlot)) {
          const l = getSectionMeta(c, primary.field, ctx).label;
          if (!distinct.includes(l)) distinct.push(l);
        }
        page.labels = distinct;
      }
    }
    const matchingCards = sectionCards.filter(isMatch);
    if (matchingCards.length === 0) return null;
    const label = labels?.length ? labels.join(' · ') : meta.label;
    return {
      key: keyPrefix ? `${keyPrefix}/${meta.key}` : meta.key,
      label: labelPrefix ? `${labelPrefix} · ${label}` : label,
      ...(labels && labels.length > 1 ? { labels } : {}),
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
  const groups = new Map<string, SectionGroup>();
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
  const recursing = pageBreakDepth > 1 && subSorts.length > 0;
  // Packing only makes sense at the leaf, where groups actually become pages.
  const groupsToBuild =
    packSections && !recursing
      ? packGroups(ordered, slotSize, packSections === 'continuous')
      : ordered;
  const sections: BinderSection[] = [];
  for (const { meta, cards: gCards, labels } of groupsToBuild) {
    if (recursing) {
      // Recurse: sub-sorts also break pages. Each sub-group starts fresh.
      // pageOffsetRef is threaded through so page numbers stay globally monotonic.
      const subSections = buildSections(
        gCards,
        subSorts,
        slotSize,
        isMatch,
        ctx,
        pageBreakDepth - 1,
        pageOffsetRef,
        labelPrefix ? `${labelPrefix} · ${meta.label}` : meta.label,
        keyPrefix ? `${keyPrefix}/${meta.key}` : meta.key
      );
      sections.push(...subSections);
    } else {
      // Leaf behavior (depth=1 or no more sorts): sort cards flat, pack into pages.
      // Sort by the FULL chain, primary included — grouping is coarser than the
      // sort for every bucketed field (all of collectorNumber/quantity/treatment/
      // finish/date* land in one "All cards" group, and cmc 7+/price/name-letter/
      // edhrec buckets each span a range), so dropping the primary here left the
      // user's first sort field — and its direction — with no effect at all.
      const sorted = sortCards(gCards, sorts, ctx);
      const section = buildSection(meta, sorted, labels);
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
  // No groups defined → no sections. Guards the buckets[buckets.length-1]
  // fall-through below, which would be buckets[-1] (undefined) → crash the
  // whole binder view. Reachable via a malformed stored binder (group mode,
  // empty filterGroups).
  if (def.filterGroups.length === 0) return [];

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

    const sectionPageCount = countPages(sorted.length, slotSize);
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
