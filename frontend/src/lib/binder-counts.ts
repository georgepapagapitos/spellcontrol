import type { EnrichedCard, BinderFilterGroup } from '../types';
import { compileFilterGroups, cardMatchesCompiled } from './rules';

export interface BinderCounts {
  /**
   * Per-OR-group raw rule-match counts. Promotion-agnostic on purpose:
   * "keep all printings together" is a binder-level effect, so promoted
   * copies can't be attributed to a specific group.
   */
  perGroup: number[];
  /**
   * Deduped binder-size estimate for the editor.
   *
   * Without `keepPrintingsTogether`: number of owned copies matching ≥1 group.
   *
   * With `keepPrintingsTogether`: expands to every owned copy that shares an
   * `oracleId` with a rule-matched card (matching `materializeBinders`'s
   * promotion grouping), plus matched copies that have no `oracleId` (can't be
   * grouped, but they matched so they're in). This is an **upper bound** — it
   * ignores cross-binder routing/priority, exactly like the rest of the
   * editor's in-isolation estimate, and over-estimating is the safe direction
   * for the over-capacity warning.
   */
  total: number;
}

/**
 * Computes the editor's per-group and total match counts for a binder's
 * draft rules. Pure; mirrors the membership logic in `materializeBinders`.
 */
export function countBinderMatches(
  cards: EnrichedCard[],
  groups: BinderFilterGroup[],
  keepPrintingsTogether: boolean
): BinderCounts {
  const compiled = compileFilterGroups(groups);
  const perGroup = new Array(compiled.length).fill(0) as number[];
  const matchedOracleIds = new Set<string>();
  let matchedNoOracle = 0;
  let plainTotal = 0;
  for (const card of cards) {
    let any = false;
    for (let i = 0; i < compiled.length; i++) {
      if (cardMatchesCompiled(card, compiled[i])) {
        perGroup[i]++;
        any = true;
      }
    }
    if (any) {
      plainTotal++;
      if (card.oracleId !== undefined) matchedOracleIds.add(card.oracleId);
      else matchedNoOracle++;
    }
  }
  if (!keepPrintingsTogether) return { perGroup, total: plainTotal };

  let expanded = matchedNoOracle;
  for (const card of cards) {
    if (card.oracleId !== undefined && matchedOracleIds.has(card.oracleId)) expanded++;
  }
  return { perGroup, total: expanded };
}
