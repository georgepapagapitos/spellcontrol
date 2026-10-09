import type { BinderDef, EnrichedCard, MaterializedBinder } from '@/types/index';
import {
  areAllGroupsEmpty,
  cardMatchesAnyGroup,
  compileFilterGroups,
} from '@spellcontrol/binder-routing';
import { ruleGroupLabel } from '@/lib/search/filter-summary';

/** Why a card sits in a binder, in the words the card preview shows. */
export interface PlacementExplanation {
  /** One sentence: what put it here. */
  reason: string;
  /** What else claims it: a binder it was taken out of, or one further down
   *  whose rules match it too. At most one, the one most likely asked about. */
  also?: string;
}

/**
 * Explains one card's place in `binder`, reading the reason materialize
 * recorded when it placed the card (`binder.reasons`), so the answer can never
 * disagree with the routing. `defs` is every binder, for the "also" line.
 *
 * Returns null when the binder carries no reason for the card (a hand-built
 * fixture, or a card that is not in this binder).
 */
export function explainPlacement(
  card: EnrichedCard,
  binder: MaterializedBinder,
  defs: BinderDef[]
): PlacementExplanation | null {
  const why = binder.reasons?.get(card.copyId);
  if (!why) return null;
  const def = binder.def;

  let reason: string;
  switch (why.kind) {
    case 'pinned':
      reason = 'Added by hand, so it stays here.';
      break;
    case 'price-margin':
      reason = "Kept here: its price moved just past this binder's rule.";
      break;
    case 'printings':
      reason = 'Kept with its other printings, which match the rules.';
      break;
    case 'rule':
      reason = areAllGroupsEmpty(def.filterGroups)
        ? 'This binder has no conditions, so it takes what the binders above pass on.'
        : `Filed by the rule “${ruleGroupLabel(def.filterGroups[why.group] ?? { filter: {} }, why.group)}”.`;
      break;
  }

  return { reason, also: why.kind === 'pinned' ? undefined : alsoLine(card, def, defs) };
}

function alsoLine(card: EnrichedCard, here: BinderDef, defs: BinderDef[]): string | undefined {
  const ordered = [...defs].sort((a, b) => a.position - b.position);
  // A binder above that would have taken it, but the user took it out: the
  // likeliest "why isn't it in X".
  for (const d of ordered) {
    if (d.position >= here.position) break;
    if (!(d.excludedCopyIds ?? []).includes(card.copyId)) continue;
    if (routesByRules(d) && cardMatchesAnyGroup(card, compileFilterGroups(d.filterGroups)))
      return `You took it out of ${d.name}, so it came here.`;
  }
  // The first binder further down whose own rules match it: it would land
  // there if this binder let it go. Catch-alls match everything, so they say
  // nothing and are skipped.
  for (const d of ordered) {
    if (d.position <= here.position || !routesByRules(d)) continue;
    if (areAllGroupsEmpty(d.filterGroups)) continue;
    if (cardMatchesAnyGroup(card, compileFilterGroups(d.filterGroups)))
      return `Also matches ${d.name}, further down the list.`;
  }
  return undefined;
}

function routesByRules(def: BinderDef): boolean {
  return def.mode !== 'manual';
}
