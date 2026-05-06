import type { BinderRule, EnrichedCard } from '../types';
import { getColorKey } from './colors';

/**
 * Returns true iff the card matches ANY of the given rule groups.
 * Within each group, all set fields must match (AND).
 *
 * An empty `rules` array matches nothing.
 * A `rules` array containing a single empty rule matches everything.
 */
export function cardMatchesRules(card: EnrichedCard, rules: BinderRule[]): boolean {
  if (!rules || rules.length === 0) return false;
  return rules.some((rule) => cardMatchesSingleRule(card, rule));
}

/**
 * Internal: tests one rule group. All set fields must match. Empty fields impose no constraint.
 */
export function cardMatchesSingleRule(card: EnrichedCard, rule: BinderRule): boolean {
  // Rarity
  if (rule.rarities && rule.rarities.length > 0) {
    if (!rule.rarities.includes(card.rarity.toLowerCase() as never)) return false;
  }

  // Price range
  if (rule.priceMin !== undefined && card.purchasePrice < rule.priceMin) return false;
  if (rule.priceMax !== undefined && card.purchasePrice > rule.priceMax) return false;

  // Colors — match by color identity (lands match too: Forest → G, Wastes → C, dual lands → M).
  if (rule.colors && rule.colors.length > 0) {
    const key = getColorKey(card);
    if (key === '?') return false;
    if (!rule.colors.includes(key as never)) return false;
  }

  // Types — substring match on type_line. ANY of the listed types matches.
  if (rule.types && rule.types.length > 0) {
    const tl = (card.typeLine || '').toLowerCase();
    const anyMatch = rule.types.some((t) => tl.includes(t.toLowerCase()));
    if (!anyMatch) return false;
  }

  // CMC range — if Scryfall didn't enrich, treat as 0
  if (rule.cmcMin !== undefined && (card.cmc ?? 0) < rule.cmcMin) return false;
  if (rule.cmcMax !== undefined && (card.cmc ?? 0) > rule.cmcMax) return false;

  // Name substring
  if (rule.nameContains && rule.nameContains.trim()) {
    if (!card.name.toLowerCase().includes(rule.nameContains.trim().toLowerCase())) {
      return false;
    }
  }

  // Set codes — exact match
  if (rule.setCodes && rule.setCodes.length > 0) {
    const sc = card.setCode.toLowerCase();
    if (!rule.setCodes.some((s) => s.toLowerCase() === sc)) return false;
  }

  // Foil
  if (rule.foil && rule.foil !== 'any') {
    if (rule.foil === 'foil' && !card.foil) return false;
    if (rule.foil === 'nonfoil' && card.foil) return false;
  }

  // Source category substring (ManaBox binder name, Moxfield tag, etc)
  if (rule.sourceCategoryContains && rule.sourceCategoryContains.trim()) {
    if (
      !card.sourceCategory.toLowerCase().includes(rule.sourceCategoryContains.trim().toLowerCase())
    ) {
      return false;
    }
  }

  // EDHREC rank threshold — card matches if its rank is at or below the cap.
  // Cards without an edhrec_rank (e.g. tokens, oddities) never match an edhrecRankMax filter.
  if (rule.edhrecRankMax !== undefined) {
    if (card.edhrecRank === undefined) return false;
    if (card.edhrecRank > rule.edhrecRankMax) return false;
  }

  // Treatments — ANY of the selected treatments matches. 'fullart' is special:
  // it matches both the explicit fullArt flag and any 'fullart' frame effect.
  if (rule.treatments && rule.treatments.length > 0) {
    const effects = card.frameEffects || [];
    const matched = rule.treatments.some((t) => {
      if (t === 'fullart') return card.fullArt === true || effects.includes('fullart');
      return effects.includes(t);
    });
    if (!matched) return false;
  }

  // Border color — ANY-of match.
  if (rule.borderColors && rule.borderColors.length > 0) {
    if (!card.borderColor) return false;
    if (!rule.borderColors.includes(card.borderColor as never)) return false;
  }

  return true;
}

/** True if a single rule has no constraints (matches every card). */
export function isRuleEmpty(rule: BinderRule): boolean {
  return (
    (!rule.rarities || rule.rarities.length === 0) &&
    rule.priceMin === undefined &&
    rule.priceMax === undefined &&
    (!rule.colors || rule.colors.length === 0) &&
    (!rule.types || rule.types.length === 0) &&
    rule.cmcMin === undefined &&
    rule.cmcMax === undefined &&
    !rule.nameContains?.trim() &&
    (!rule.setCodes || rule.setCodes.length === 0) &&
    (!rule.foil || rule.foil === 'any') &&
    !rule.sourceCategoryContains?.trim() &&
    rule.edhrecRankMax === undefined &&
    (!rule.treatments || rule.treatments.length === 0) &&
    (!rule.borderColors || rule.borderColors.length === 0)
  );
}

/** True if at least one rule group in the array is empty. Used for the editor's warning banner. */
export function hasEmptyRule(rules: BinderRule[]): boolean {
  return rules.some(isRuleEmpty);
}
