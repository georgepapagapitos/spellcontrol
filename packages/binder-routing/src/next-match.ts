import type { BinderDef, EnrichedCard } from './types.js';
import { compileFilterGroups, cardMatchesAnyGroup } from './rules.js';

export interface NextBinderMatchOptions {
  /** Binder to pretend doesn't exist — e.g. the binder currently being edited,
   *  so the caller can ask "where would this card go if it left this binder." */
  excludeBinderId?: string;
}

/**
 * The first binder (by `position` order) that would claim `card` if it were
 * routed fresh right now, excluding `opts.excludeBinderId`. Mirrors the exact
 * semantics of `materializeBinders`'s routing loop (materialize.ts:82-129) but
 * answers for a single card without re-running the whole collection:
 *
 * - manual-mode binders never claim cards via rules — skipped.
 * - the excluded binder is skipped, as if it weren't in the list at all.
 * - a binder that excludes this copyId (`excludedCopyIds`) is skipped.
 * - pins beat rules: if ANY remaining binder pins this copyId, the first such
 *   binder (by position) wins outright, even if an earlier-positioned rules
 *   match would otherwise have claimed the card first. This mirrors
 *   materialize.ts's pre-claim pass, which reserves pinned copies before rule
 *   routing runs at all — a pin is a stronger, explicit signal than a rule
 *   match and always wins regardless of position.
 * - otherwise, the first binder (excluding manual/excluded/copy-excluded)
 *   whose compiled `filterGroups` match the card wins.
 * - materialize.ts's sticky price retention (snapshot-based within-margin
 *   hold) is deliberately NOT mirrored: this predicts where the card would
 *   file *fresh*, and fresh routing uses the exact rule bounds.
 *
 * Returns `null` if no binder would claim the card (it would land in
 * Uncategorized).
 */
export function nextBinderMatch(
  card: EnrichedCard,
  binderDefs: BinderDef[],
  opts: NextBinderMatchOptions = {}
): BinderDef | null {
  const orderedDefs = [...binderDefs]
    .sort((a, b) => a.position - b.position)
    .filter((d) => d.id !== opts.excludeBinderId);

  // Pins beat rules, in position order — mirrors materialize.ts's pre-claim pass.
  for (const def of orderedDefs) {
    if (def.pinnedCopyIds?.includes(card.copyId)) return def;
  }

  for (const def of orderedDefs) {
    if (def.mode === 'manual') continue;
    if (def.excludedCopyIds?.includes(card.copyId)) continue;
    const compiled = compileFilterGroups(def.filterGroups);
    if (cardMatchesAnyGroup(card, compiled)) return def;
  }

  return null;
}
