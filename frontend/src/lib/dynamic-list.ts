import type { BinderFilterGroup, EnrichedCard, ListEntry } from '../types';
import { compileFilterGroups, cardMatchesAnyGroup, areAllGroupsEmpty } from './rules';
import { printingFinishKey } from './collection-mutations';
import type { EnrichedListRow } from './use-enriched-list-entries';

/** A rule with no groups, or only empty groups, matches nothing (a freshly
 *  created dynamic list before its first rule edit). */
export function isRuleEmpty(rule: BinderFilterGroup[] | undefined): boolean {
  return !rule || rule.length === 0 || areAllGroupsEmpty(rule);
}

/**
 * Materialize a dynamic list from the collection: match every owned copy
 * against the rule (OR of groups — same engine as binders), then aggregate
 * per printing+finish into list-shaped rows. The card in each row IS an owned
 * copy, so printing fidelity (art/rarity/finish/price) is exact by
 * construction. An empty rule yields no rows.
 */
export function dynamicListRows(
  cards: EnrichedCard[],
  rule: BinderFilterGroup[]
): EnrichedListRow[] {
  if (isRuleEmpty(rule)) return [];
  const compiled = compileFilterGroups(rule);
  const byKey = new Map<string, { card: EnrichedCard; quantity: number }>();
  for (const card of cards) {
    if (!cardMatchesAnyGroup(card, compiled)) continue;
    const key = printingFinishKey(card);
    const existing = byKey.get(key);
    if (existing) existing.quantity += 1;
    else byKey.set(key, { card, quantity: 1 });
  }
  return [...byKey.entries()].map(([key, { card, quantity }]) => {
    const entry: ListEntry = {
      id: key,
      name: card.name,
      scryfallId: card.scryfallId,
      setCode: card.setCode,
      collectorNumber: card.collectorNumber,
      finish: card.finish ?? (card.foil ? 'foil' : 'nonfoil'),
      oracleId: card.oracleId,
      quantity,
    };
    return { entry, card: { ...card, copyId: key } };
  });
}

/** Copy count a dynamic list currently matches (for index tiles / sorting). */
export function dynamicListCount(cards: EnrichedCard[], rule: BinderFilterGroup[]): number {
  if (isRuleEmpty(rule)) return 0;
  const compiled = compileFilterGroups(rule);
  let n = 0;
  for (const card of cards) if (cardMatchesAnyGroup(card, compiled)) n++;
  return n;
}
