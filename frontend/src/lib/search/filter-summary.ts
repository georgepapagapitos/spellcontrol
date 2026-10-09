import type { BinderFilter, BinderFilterGroup, ChipExpression } from '@/types/index';
import type { ColorMatchMode } from '@spellcontrol/binder-routing';
import { currencySymbol } from '@/lib/collection/currency';
import { cardTagLabel } from '@/lib/cards/card-tags';

/**
 * Filter-facing color names, matching the filter popovers' own option labels.
 * Deliberately not `COLOR_INFO` from binder-routing — that's the *grouping*
 * vocabulary ('C' reads "Colorless / Artifact", plus M/L/? buckets), too long
 * and too broad for a filter chip.
 */
const FILTER_COLOR_LABELS: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
};

/**
 * The "Color group" field's bucket keys (`FilterGroupEditor`'s `COLORS`
 * array) — WUBRG plus Multicolor, distinct from `FILTER_COLOR_LABELS` (which
 * only covers color IDENTITY's WUBRG-C). A rule's autoSummary otherwise read
 * the raw chip code ("U") as its title once an unnamed rule started showing
 * its summary as the headline (E497).
 */
const COLOR_GROUP_LABELS: Record<string, string> = {
  ...FILTER_COLOR_LABELS,
  M: 'Multicolor',
};

/**
 * "White, Blue" for a set of WUBRG(C) filter keys. In 'all' (AND) mode the
 * chip reads as an intersection — "White + Blue" — so the label itself says
 * which combine semantics are active.
 */
export function colorChipLabel(keys: Iterable<string>, mode: ColorMatchMode = 'any'): string {
  return [...keys].map((k) => FILTER_COLOR_LABELS[k] ?? k).join(mode === 'all' ? ' + ' : ', ');
}

/**
 * Build a short human-readable summary of a filter for use as the group's
 * legend placeholder and aria-label fallback. Walks every filter field;
 * caps at 4 parts so the summary stays scannable. Returns '' for an empty
 * filter. Field order is roughly "most distinguishing first" so when the
 * cap kicks in you keep the parts a user is most likely to recognize.
 */
export function autoSummary(f: BinderFilter): string {
  const parts: string[] = [];
  const chipNames = (expr: ChipExpression | undefined, max = 2) => {
    if (!expr || expr.chips.length === 0) return null;
    const is = expr.chips.filter((c) => !c.negate).map((c) => c.value);
    if (is.length === 0) return null;
    if (is.length <= max) return is.join(', ');
    return `${is.slice(0, max).join(', ')} +${is.length - max}`;
  };
  const push = (s: string | null | undefined) => {
    if (s) parts.push(s);
  };

  const colorGroupNames = (expr: ChipExpression | undefined, max = 2) => {
    if (!expr || expr.chips.length === 0) return null;
    const is = expr.chips
      .filter((c) => !c.negate)
      .map((c) => COLOR_GROUP_LABELS[c.value] ?? c.value);
    if (is.length === 0) return null;
    if (is.length <= max) return is.join(', ');
    return `${is.slice(0, max).join(', ')} +${is.length - max}`;
  };

  push(chipNames(f.rarities));
  push(chipNames(f.typeTokenChips));
  push(chipNames(f.typeChips));
  push(chipNames(f.supertypeChips));
  push(chipNames(f.subtypeChips));
  push(colorGroupNames(f.colors));
  if (f.colorIdentity?.colors.length)
    push(colorChipLabel(f.colorIdentity.colors, f.colorIdentity.mode));
  push(chipNames(f.treatments));
  push(chipNames(f.finishes));
  push(chipNames(f.layouts));
  push(chipNames(f.borderColors));
  push(chipNames(f.legalities));
  push(chipNames(f.oracleChips));
  // Tags summarize with their friendly label (e.g. "mana-rock" → "Mana rock").
  {
    const tagIs = f.oracleTagChips?.chips
      .filter((c) => !c.negate)
      .map((c) => cardTagLabel(c.value));
    if (tagIs && tagIs.length > 0) {
      push(
        tagIs.length <= 2
          ? tagIs.join(', ')
          : `${tagIs.slice(0, 2).join(', ')} +${tagIs.length - 2}`
      );
    }
  }

  if (f.commanderEligible === true) parts.push('Commander');
  else if (f.commanderEligible === false) parts.push('Not commander');

  if (f.proxy === true) parts.push('Proxy');
  else if (f.proxy === false) parts.push('Not proxy');

  if (f.spareCopies === true) parts.push('Spare copies');
  else if (f.spareCopies === false) parts.push('Not spare copies');

  if (f.setCodes && f.setCodes.length > 0) {
    push(
      f.setCodes.length <= 2
        ? f.setCodes.join(', ')
        : `${f.setCodes.slice(0, 2).join(', ')} +${f.setCodes.length - 2}`
    );
  }

  // Price rules match against the display-currency price — label accordingly.
  const sym = currencySymbol();
  if (f.priceMin !== undefined && f.priceMax !== undefined)
    parts.push(`${sym}${f.priceMin}–${f.priceMax}`);
  else if (f.priceMin !== undefined) parts.push(`≥ ${sym}${f.priceMin}`);
  else if (f.priceMax !== undefined) parts.push(`≤ ${sym}${f.priceMax}`);

  if (f.cmcMin !== undefined && f.cmcMax !== undefined)
    parts.push(`Mana value ${f.cmcMin}–${f.cmcMax}`);
  else if (f.cmcMin !== undefined) parts.push(`Mana value ≥ ${f.cmcMin}`);
  else if (f.cmcMax !== undefined) parts.push(`Mana value ≤ ${f.cmcMax}`);

  if (f.edhrecRankMax !== undefined) parts.push(`EDH top ${f.edhrecRankMax}`);
  if (f.manaCost?.trim()) parts.push(f.manaCost.trim());
  if (f.nameContains?.trim()) parts.push(`"${f.nameContains.trim()}"`);
  if (f.scryfallQuery?.query.trim()) parts.push(`⌕ ${f.scryfallQuery.query.trim()}`);

  return parts.slice(0, 4).join(' · ');
}

/**
 * What a rule is called wherever it is shown: its name, else the summary the
 * editor uses as its placeholder, else "Rule N". One label, so the card
 * preview's "Filed by …" names the rule the way the editor shows it.
 */
export function ruleGroupLabel(group: BinderFilterGroup, index: number): string {
  return group.name?.trim() || autoSummary(group.filter) || `Rule ${index + 1}`;
}
