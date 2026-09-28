/**
 * Volumes: when a binder's cards outgrow its own fixed capacity, it becomes
 * several physical books instead of one — ONE rule set (`BinderDef` never
 * changes), N derived books. This module never touches `BinderDef` or persists
 * anything; every caller re-derives volumes from an already-materialized
 * binder's sections, exactly the way page numbers themselves are derived
 * rather than stored. See board E494 / `project_binder_program` ("Rework
 * direction (2026-09-28)") for the product decision behind this.
 */
import type { BinderPage, BinderSection, PocketSize } from './types.js';

/** One physical book a binder's pages split across once it's over capacity. */
export interface Volume {
  /** 1-based position on the shelf. */
  index: number;
  /** The binder's own global page numbering (`BinderPage.pageNum`), inclusive. */
  pageStart: number;
  pageEnd: number;
  cardCount: number;
  /** Label of the section that opens this volume (its first page). */
  firstLabel: string;
  /** Label of the section that closes this volume (its last page). */
  lastLabel: string;
}

function countCards(pages: readonly BinderPage[]): number {
  let n = 0;
  for (const page of pages) {
    for (const slot of page.slots) if (slot) n++;
  }
  return n;
}

/**
 * Splits an already-materialized binder's sections into physical volumes once
 * its card count outgrows `capacityCards`.
 *
 * - `capacityCards === null` (no fixed capacity) means there's no such thing
 *   as "outgrowing" this binder — returns `null`, not an empty/one-item array,
 *   so a caller can tell "no capacity set" apart from "fits in one book".
 * - A binder with pages, all of which fit in one physical book, still returns
 *   a single-element array. Callers gate the volumes UI on
 *   `volumes !== null && volumes.length > 1` — never on truthiness alone.
 * - An empty binder (no pages at all) returns `[]`: nothing to split.
 *
 * **Rounding**: capacity is converted to pages with
 * `Math.floor(capacityCards / pocketSize)`, never `ceil`. A physical volume
 * can only hold WHOLE pages, so rounding up would let a volume claim a page
 * the stated card capacity doesn't actually cover — a 358-card capacity at 9
 * pockets/page is 39 whole pages (351 cards), not 40. The result is clamped
 * to at least 1 page/volume so a capacity smaller than one page's worth of
 * pockets still terminates instead of looping forever (an edge case only a
 * hand-typed "Other…" capacity could reach). `doubleSided` plays NO part in
 * this: it's display metadata for how a page maps to a physical sheet, not a
 * multiplier on capacity — see `BinderDef.fixedCapacity`'s own doc comment.
 *
 * **Cutting rule** (the user's own words, board E494: "split it into multiple
 * binders"): a volume takes whole sections for as long as they fit in what's
 * left of it. The first section that would overflow the remaining space
 * closes the volume instead of splitting it — UNLESS the volume is still
 * empty, meaning the section alone is bigger than a whole volume, in which
 * case it's cut at a page boundary (never mid-page, matching the app's
 * existing "a section always owns whole pages" invariant one level up) and
 * continues into the next volume(s).
 *
 * This ordered, non-reordering, non-splitting-when-avoidable approach can
 * leave a volume under-full (a big section forces an early cut even though a
 * later, smaller section would have fit in the space left behind) — a
 * deliberate simplicity trade-off, the same one `packGroups` in
 * `materialize.ts` already makes for merging sections onto shared pages.
 *
 * **Caller contract**: pass `sections` from an UNFILTERED materialize pass
 * (`search: ''`). A search-filtered pass drops non-matching pages and cards
 * entirely (`chunkIntoPages`), which would silently count fewer physical
 * pages/cards than the binder actually holds.
 */
export function planVolumes(
  sections: readonly Pick<BinderSection, 'label' | 'pages'>[],
  { capacityCards, pocketSize }: { capacityCards: number | null; pocketSize: PocketSize }
): Volume[] | null {
  if (capacityCards === null) return null;
  const capacityPages = Math.max(1, Math.floor(capacityCards / pocketSize));

  const volumes: Volume[] = [];
  let volPages = 0;
  let volCards = 0;
  let volFirstPage = 0;
  let volLastPage = 0;
  let firstLabel = '';
  let lastLabel = '';

  const flush = () => {
    volumes.push({
      index: volumes.length + 1,
      pageStart: volFirstPage,
      pageEnd: volLastPage,
      cardCount: volCards,
      firstLabel,
      lastLabel,
    });
    volPages = 0;
    volCards = 0;
  };

  for (const section of sections) {
    let offset = 0;
    let remaining = section.pages.length;
    while (remaining > 0) {
      if (volPages === 0) firstLabel = section.label;
      const spaceLeft = capacityPages - volPages;
      if (remaining > spaceLeft && volPages > 0) {
        // Doesn't fit, and the current volume already holds an earlier
        // section: close it here rather than splitting this section across
        // the cut, then re-evaluate against a fresh, empty volume.
        flush();
        continue;
      }
      // Either the rest of the section fits in what's left of this volume, or
      // the volume is still empty and the section alone overflows a whole
      // volume — take as many whole pages as fit (never a partial page).
      const take = Math.min(remaining, spaceLeft);
      const slice = section.pages.slice(offset, offset + take);
      if (volPages === 0) volFirstPage = slice[0]!.pageNum;
      volLastPage = slice[slice.length - 1]!.pageNum;
      volCards += countCards(slice);
      volPages += take;
      lastLabel = section.label;
      offset += take;
      remaining -= take;
      // Only reachable when this volume just filled to capacity mid-section
      // (the hard-split case) — the section continues into the next volume.
      if (remaining > 0) flush();
    }
  }
  if (volPages > 0) flush();
  return volumes;
}

/**
 * Page-count tiers the three standard capacity chips (Pages editor: "No
 * limit / 360 / 480 / 640 / Other…") represent. Chosen so that at 9 pockets —
 * the app's default pocket size and the one nearly every card binder on the
 * market uses — they reproduce those exact chips: 40 pages → 360 cards, 53
 * pages → 477 (~480), 71 pages → 639 (~640). Scaled to other pocket sizes so
 * "a binder that fits" always means the same physical page depth, not an
 * arbitrary card count that happens to divide evenly.
 */
const STANDARD_PAGE_TIERS = [40, 53, 71] as const;

/** The standard capacity chips (raw card counts) for a given pocket size. */
export function standardBinderSizes(pocketSize: PocketSize): number[] {
  return STANDARD_PAGE_TIERS.map((pages) => pages * pocketSize);
}

/**
 * The smallest standard binder size that holds `cardCount` cards at
 * `pocketSize`, for "Use a binder that fits" — or `null` when even the
 * largest standard size isn't enough, meaning a split into volumes (or a
 * custom "Other…" capacity) is the only option.
 *
 * `sizes` defaults to {@link standardBinderSizes}; a caller with its own
 * catalogue (e.g. a store's actual SKU list) can pass its own.
 */
export function smallestFittingCapacity(
  cardCount: number,
  pocketSize: PocketSize,
  sizes: readonly number[] = standardBinderSizes(pocketSize)
): number | null {
  let best: number | null = null;
  for (const size of sizes) {
    if (size >= cardCount && (best === null || size < best)) best = size;
  }
  return best;
}
