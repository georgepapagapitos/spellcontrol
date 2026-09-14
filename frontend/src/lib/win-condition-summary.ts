import type { WinConditionAnalysis } from '@/deck-builder/services/winConditions/types';

/**
 * Build a one-line win-condition summary for the PowerHero Gameplan pillar.
 * e.g. "Wins via Infinite combo · backup: Mill, Aristocrats"
 *
 * Lives here rather than on the deck editor because the shared/public deck
 * surface renders the same PowerHero — one deck view, one summary.
 */
export function buildWinConditionSummary(wc: WinConditionAnalysis | undefined): string | undefined {
  if (!wc) return undefined;
  if (wc.noClearWinCondition) return 'No clear win condition';
  if (!wc.primary) return undefined;
  const parts: string[] = [`Wins via ${wc.primary.label}`];
  if (wc.secondary.length > 0) {
    parts.push(`backup: ${wc.secondary.map((s) => s.label).join(', ')}`);
  }
  return parts.join(' · ');
}
