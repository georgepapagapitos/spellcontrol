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
 * left of it. A section that would overflow the remaining space but fits whole
 * in a fresh volume closes the current one instead of being split. A section
 * bigger than a whole volume is split regardless, so it fills the current
 * volume first and continues into the next at a page boundary (never
 * mid-page, matching the "a section always owns whole pages" invariant one
 * level up). So a binder never needs more books than necessary because of a
 * big section: 43 pages at 40 a book are 2 volumes, whatever comes first.
 *
 * A volume can still end under-full when a section that fits whole in a fresh
 * volume doesn't fit in what's left: that keeps the section in one book, a
 * deliberate trade-off, the same one `packGroups` in `materialize.ts` makes
 * for merging sections onto shared pages.
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
      if (remaining > spaceLeft && volPages > 0 && remaining <= capacityPages) {
        // Doesn't fit here but would fit whole in a fresh volume, and this
        // volume already holds an earlier section: close it rather than
        // splitting this section across the cut.
        flush();
        continue;
      }
      // Either the rest of the section fits in what's left of this volume, or
      // it is bigger than a whole volume and gets split anyway. Then it fills
      // this volume first: closing early there only strands the space (a
      // 2-page section before a 41-page one made 3 books of a 43-page binder
      // at 40 pages a book). Take as many whole pages as fit, never a partial.
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
 * Marketed binder sizes (raw card counts), per pocket size, for "Use a
 * binder that fits". These are NOT derived from a formula — capacity chips
 * are a real-world SKU number, and a formula that happens to look clean
 * (e.g. an exact multiple of the pocket count) is not necessarily what a
 * store sells.
 *
 * - **9 pockets**: 360 / 480 / 640 are the sizes already established
 *   elsewhere in this app for the common 9-pocket zip/pro binder (the Pages
 *   editor's own capacity chips) — the standard trading-card album size
 *   tier, e.g. a 360-card binder as 20 double-sided sheets.
 * - **4 and 12 pockets**: no equally-standard, citable marketed-capacity
 *   list exists for toploader (4-pocket) or zip (12-pocket) pages the way it
 *   does for 9-pocket albums. These are a reasoned scaling of the 9-pocket
 *   sizes by pocket-count ratio, rounded to a clean number — a defensible
 *   estimate, not a sourced figure. Revisit if real SKU data turns up.
 */
const STANDARD_SIZES: Record<PocketSize, readonly number[]> = {
  4: [160, 240, 320],
  9: [360, 480, 640],
  12: [480, 720, 960],
};

/** The standard capacity chips (raw card counts) for a given pocket size. */
export function standardBinderSizes(pocketSize: PocketSize): readonly number[] {
  return STANDARD_SIZES[pocketSize];
}

/**
 * The smallest standard binder size that holds a binder of `totalPages`
 * pages at `pocketSize`, for "Use a binder that fits" — or `null` when even
 * the largest standard size isn't enough, meaning a split into volumes (or a
 * custom "Other…" capacity) is the only option.
 *
 * **Page-based, not card-based.** A size "fits" iff
 * `Math.floor(size / pocketSize) >= totalPages` — comparing against a raw
 * card count instead would silently under-count whenever sections start
 * fresh pages: 350 cards spread one-per-color-section-per-page over 9
 * pockets can span 45 pages (405 pockets), which a nominally-"360-card"
 * binder (40 pages, 360 pockets) does NOT physically hold, even though
 * 350 < 360. Pass `totalPages` from the same unfiltered materialize pass
 * `planVolumes` itself requires.
 *
 * `sizes` defaults to {@link standardBinderSizes}; a caller with its own
 * catalog (e.g. a store's actual SKU list) can pass its own.
 */
export function smallestFittingCapacity(
  totalPages: number,
  pocketSize: PocketSize,
  sizes: readonly number[] = standardBinderSizes(pocketSize)
): number | null {
  let best: number | null = null;
  for (const size of sizes) {
    const pages = Math.floor(size / pocketSize);
    if (pages >= totalPages && (best === null || size < best)) best = size;
  }
  return best;
}
