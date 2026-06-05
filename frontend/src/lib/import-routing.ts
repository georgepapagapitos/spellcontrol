import type { BinderDef, EnrichedCard } from '../types';
import { materializeBinders } from './materialize';

/**
 * Where the cards from a particular import ended up after rule routing.
 * Only real binder destinations are reported — the uncategorized remainder is
 * deliberately not surfaced (see `summarizeImportRouting`).
 */
export interface ImportRoutingEntry {
  binderId: string;
  binderName: string;
  binderColor?: string;
  count: number;
}

export interface ImportRoutingSummary {
  /** Per-binder breakdown, sorted by count desc. Cards that matched no binder
   *  (the "Uncategorized" remainder) are intentionally omitted — falling
   *  through to Uncategorized just means "still in your collection, unrouted",
   *  which isn't worth surfacing as a where-did-my-cards-go destination (E11). */
  entries: ImportRoutingEntry[];
  /** Total cards from the import that landed in a binder. Same as
   *  `entries.reduce(+ count)` — surfaced separately so callers don't need
   *  to recompute it. Excludes the uncategorized remainder. */
  totalRouted: number;
}

/**
 * Bucket every card stamped with one of `importIds` into the binder its rules
 * routed it to. The user just hit "Import" — they want a one-glance answer to
 * "where did my cards go?"
 *
 * Cards that matched no binder fall through to the Uncategorized remainder and
 * are NOT reported (E11): "uncategorized" is just "still in the collection,
 * unrouted", a no-op default not worth surfacing. When nothing matched a real
 * binder the summary is empty and the caller hides the panel entirely (the
 * import success banner already confirms the import landed).
 *
 * We materialize the *current* binder layout once and walk the per-binder
 * card lists, so the result agrees with what the user will see when they
 * navigate to each binder — including deck-allocation hiding, pinned-card
 * promotion, and any other routing quirks the materializer applies. The
 * naive approach (re-running rule matching here) would silently disagree
 * with materializeBinders when those edge cases kick in.
 */
export function summarizeImportRouting(
  importIds: ReadonlySet<string>,
  cards: EnrichedCard[],
  binderDefs: BinderDef[]
): ImportRoutingSummary {
  if (importIds.size === 0) return { entries: [], totalRouted: 0 };

  // Run the same routing the BinderView uses. We don't care about pocket size
  // or sorts here — only which cards landed where — but we still go through
  // the official path so quirks like deck-allocation hiding and printing
  // promotion stay consistent with the user-visible layout.
  const { binders } = materializeBinders(cards, binderDefs, {
    globalPocketSize: 9,
    search: '',
  });

  const entries: ImportRoutingEntry[] = [];
  for (const b of binders) {
    let n = 0;
    for (const section of b.sections) {
      for (const c of section.cards) {
        if (c.importId && importIds.has(c.importId)) n++;
      }
    }
    if (n > 0) {
      entries.push({
        binderId: b.def.id,
        binderName: b.def.name,
        binderColor: b.def.color,
        count: n,
      });
    }
  }

  // Binders sort by count desc, name asc on ties. The uncategorized remainder
  // isn't collected at all — it's the "fell through, still in the collection"
  // pile, not a destination worth reporting.
  entries.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return a.binderName.localeCompare(b.binderName);
  });

  const totalRouted = entries.reduce((s, e) => s + e.count, 0);
  return { entries, totalRouted };
}
