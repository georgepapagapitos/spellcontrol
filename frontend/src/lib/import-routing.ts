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
 */
export function summarizeImportRouting(
  importIds: ReadonlySet<string>,
  cards: EnrichedCard[],
  binderDefs: BinderDef[]
): ImportRoutingSummary {
  if (importIds.size === 0) return { entries: [], totalRouted: 0, unroutedCount: 0 };

  // Run the same routing the BinderView uses. We don't care about pocket size
  // or sorts here — only which cards landed where — but we still go through
  // the official path so quirks like deck-allocation hiding and printing
  // promotion stay consistent with the user-visible layout.
  const { binders, uncategorized } = materializeBinders(cards, binderDefs, {
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
