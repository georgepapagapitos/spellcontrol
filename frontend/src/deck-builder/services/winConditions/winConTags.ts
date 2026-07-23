/**
 * E125: the user-tag ↔ win-condition-engine cross-link. Pure, display-level
 * only — never an input to `detectWinConditions` (engine stays untouched, no
 * v2-wincon signature bump owed).
 */

import type { WinConditionAnalysis } from './types';

/**
 * User-tagged card names that the engine's own primary/secondary evidence
 * does NOT already list — the leftover set `WinConditionPanel` renders in its
 * own "Tagged by you" section. A name the engine already surfaces is left out
 * here on purpose (dedupe rule: the engine entry wins, the tag just marks it)
 * so it's never shown twice. Order-preserving, de-duplicated.
 */
export function tagOnlyWinCons(
  analysis: Pick<WinConditionAnalysis, 'primary' | 'secondary'>,
  tags: readonly string[]
): string[] {
  const engineNames = new Set<string>(analysis.primary?.evidence ?? []);
  for (const wc of analysis.secondary) {
    for (const name of wc.evidence) engineNames.add(name);
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of tags) {
    if (seen.has(name) || engineNames.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

/** Add/remove `name` from a wincon-tag list — the panel's per-card toggle.
 *  Order-preserving; toggling an already-tagged name removes it. */
export function toggleWinConTag(tags: readonly string[] | undefined, name: string): string[] {
  const list = tags ?? [];
  return list.includes(name) ? list.filter((n) => n !== name) : [...list, name];
}
