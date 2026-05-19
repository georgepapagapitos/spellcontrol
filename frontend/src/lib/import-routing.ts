import type { BinderDef, EnrichedCard } from '../types';
import { materializeBinders } from './materialize';

/**
 * Where the cards from a particular import ended up after rule routing.
 * `binderId` is null for the uncategorized bucket.
 */
export interface ImportRoutingEntry {
  binderId: string | null;
  binderName: string;
  binderColor?: string;
  count: number;
}

export interface ImportRoutingSummary {
  /** Per-destination breakdown, sorted by count desc (uncategorized always
   *  appears last regardless of count so it doesn't drown out the binders). */
  entries: ImportRoutingEntry[];
  /** Total cards from the import that we could place. Same as
   *  `entries.reduce(+ count)` — surfaced separately so callers don't need
   *  to recompute it. */
  totalRouted: number;
}

const UNCATEGORIZED_NAME = 'Uncategorized';

/**
 * Bucket every card stamped with one of `importIds` into the binder its rules
 * routed it to (or "Uncategorized" if nothing matched). The user just hit
 * "Import" — they want a one-glance answer to "where did my cards go?"
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
  const { binders, uncategorized } = materializeBinders(cards, binderDefs, {
    globalPocketSize: 9,
    search: '',
  });

  const counts = new Map<string | null, number>();
  const meta = new Map<string, { name: string; color?: string }>();

  for (const b of binders) {
    meta.set(b.def.id, { name: b.def.name, color: b.def.color });
    let n = 0;
    for (const section of b.sections) {
      for (const c of section.cards) {
        if (c.importId && importIds.has(c.importId)) n++;
      }
    }
    if (n > 0) counts.set(b.def.id, n);
  }

  let uncatCount = 0;
  for (const section of uncategorized.sections) {
    for (const c of section.cards) {
      if (c.importId && importIds.has(c.importId)) uncatCount++;
    }
  }
  if (uncatCount > 0) counts.set(null, uncatCount);

  const binderEntries: ImportRoutingEntry[] = [];
  let uncatEntry: ImportRoutingEntry | null = null;
  for (const [id, count] of counts) {
    if (id === null) {
      uncatEntry = { binderId: null, binderName: UNCATEGORIZED_NAME, count };
    } else {
      const m = meta.get(id);
      binderEntries.push({
        binderId: id,
        binderName: m?.name ?? id,
        binderColor: m?.color,
        count,
      });
    }
  }

  // Binders sort by count desc, name asc on ties. Uncategorized always trails
  // the binder rows since it's the "fell through" pile, not a destination
  // the user picked.
  binderEntries.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return a.binderName.localeCompare(b.binderName);
  });

  const entries = uncatEntry ? [...binderEntries, uncatEntry] : binderEntries;
  const totalRouted = entries.reduce((s, e) => s + e.count, 0);
  return { entries, totalRouted };
}
