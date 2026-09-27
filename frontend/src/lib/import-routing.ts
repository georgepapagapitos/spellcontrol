import type { SetMap } from '@spellcontrol/binder-routing';
import type { BinderDef, EnrichedCard } from '../types';
import { materializeBinders } from './materialize';

/**
 * Where the cards from a particular import ended up after rule routing.
 * The uncategorized remainder is reported separately as a count, not as an
 * entry — it has no binder to open (see `summarizeImportRouting`).
 */
export interface ImportRoutingEntry {
  binderId: string;
  binderName: string;
  binderColor?: string;
  count: number;
  /**
   * 1-based physical page numbers (within this binder's default Pages view —
   * group-printings off, the state a binder opens in until the user toggles
   * it) that at least one of the imported cards landed on. Ascending,
   * deduped, never empty when `count > 0` — see `summarizeImportRouting`'s
   * doc comment for exactly which inputs this needs to agree with BinderPage.
   */
  pages: number[];
}

/**
 * Formats a page-number list the way a physical binder is discussed:
 * "p. 3" for one page, "pp. 3, 7" for a few, "pp. 3-5" for a run — a mix of
 * both when some are adjacent and some aren't. Returns '' for an empty list
 * so a caller can treat it as "nothing to show" without a special case.
 */
export function formatBinderPages(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (sorted.length === 0) return '';
  const runs: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    runs.push(start === prev ? `${start}` : `${start}-${prev}`);
    if (cur !== undefined) {
      start = cur;
      prev = cur;
    }
  }
  return sorted.length === 1 ? `p. ${runs[0]}` : `pp. ${runs.join(', ')}`;
}

export interface ImportRoutingSummary {
  /** Per-binder breakdown, sorted by count desc. Never contains the
   *  uncategorized remainder — that has no binder id to open, so it rides
   *  along as `unroutedCount` instead. */
  entries: ImportRoutingEntry[];
  /** Total cards from the import that landed in a binder. Same as
   *  `entries.reduce(+ count)` — surfaced separately so callers don't need
   *  to recompute it. Excludes the uncategorized remainder. */
  totalRouted: number;
  /** Cards from this import that matched NO binder's rules and fell through to
   *  Uncategorized. E11 originally suppressed this as "a no-op default not
   *  worth surfacing", which left the panel reporting "Routed 312 cards" and
   *  saying nothing about the other 88 — the user's only route to them was a
   *  Collection-page filter they had to know existed. It is the signal that a
   *  rule is missing, so it is now reported (E296). */
  unroutedCount: number;
}

/**
 * Bucket every card stamped with one of `importIds` into the binder its rules
 * routed it to. The user just hit "Import" — they want a one-glance answer to
 * "where did my cards go?"
 *
 * Cards that matched no binder fall through to the Uncategorized remainder and
 * are counted into `unroutedCount` (E296, reversing E11's suppression). That
 * count is the one number that tells the user a rule is missing — without it
 * the panel confirms what landed and stays silent about what escaped, which
 * is exactly the half the user needs in order to act.
 *
 * We materialize the *current* binder layout once and walk the per-binder
 * card lists, so the result agrees with what the user will see when they
 * navigate to each binder — including deck-allocation hiding, pinned-card
 * promotion, and any other routing quirks the materializer applies. The
 * naive approach (re-running rule matching here) would silently disagree
 * with materializeBinders when those edge cases kick in.
 *
 * Each entry's `pages` is read off the SAME materialize pass, walking
 * `section.pages[].slots` (not `section.cards`, which carries no page
 * number). For this to equal what `BinderPage` actually renders, `opts`
 * must carry the same `allocatedCopyIds`/`setMap` BinderPage does — those are
 * the two materialize inputs (besides the cards/binders every caller already
 * passes) that can shift a card onto a different page: `allocatedCopyIds`
 * for a `hideDeckAllocated: false` binder, `setMap` for a binder sorted by
 * release date. (`qtyByPrintingKey` is deliberately never passed: omitting it
 * makes materialize fall back to counting quantities from `cards` itself,
 * which is exactly BinderPage's own default "group printings" off state —
 * passing a grouped count here would answer a view this summary never
 * renders.) A caller that can't source `allocatedCopyIds`/`setMap` gets
 * `pages` computed anyway; it's exactly right for every binder that isn't
 * using one of those two narrow features, and BinderPage itself opens in
 * that same "group printings off" state by default.
 */
export function summarizeImportRouting(
  importIds: ReadonlySet<string>,
  cards: EnrichedCard[],
  binderDefs: BinderDef[],
  opts: { allocatedCopyIds?: ReadonlySet<string>; setMap?: SetMap } = {}
): ImportRoutingSummary {
  if (importIds.size === 0) return { entries: [], totalRouted: 0, unroutedCount: 0 };

  // Run the same routing the BinderView uses. We don't care about sorts here
  // — only which cards landed where and on which page — but we still go
  // through the official path so quirks like deck-allocation hiding and
  // printing promotion stay consistent with the user-visible layout.
  const { binders, uncategorized } = materializeBinders(cards, binderDefs, {
    search: '',
    allocatedCopyIds: opts.allocatedCopyIds,
    setMap: opts.setMap,
  });

  const entries: ImportRoutingEntry[] = [];
  for (const b of binders) {
    let n = 0;
    const pages = new Set<number>();
    for (const section of b.sections) {
      for (const page of section.pages) {
        for (const c of page.slots) {
          if (c?.importId && importIds.has(c.importId)) {
            n++;
            pages.add(page.pageNum);
          }
        }
      }
    }
    if (n > 0) {
      entries.push({
        binderId: b.def.id,
        binderName: b.def.name,
        binderColor: b.def.color,
        count: n,
        pages: [...pages].sort((a, b) => a - b),
      });
    }
  }

  // The uncategorized remainder, walked the same way — it is a count rather
  // than an entry because there is no binder to open, only a Collection view
  // filtered to it.
  let unroutedCount = 0;
  for (const section of uncategorized.sections) {
    for (const c of section.cards) {
      if (c.importId && importIds.has(c.importId)) unroutedCount++;
    }
  }

  // Binders sort by count desc, name asc on ties.
  entries.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return a.binderName.localeCompare(b.binderName);
  });

  const totalRouted = entries.reduce((s, e) => s + e.count, 0);
  return { entries, totalRouted, unroutedCount };
}
