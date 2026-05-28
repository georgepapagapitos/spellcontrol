/**
 * Pacing detection — classifies a deck's tempo (aggressive-early / fast-tempo /
 * midrange / late-game / balanced) from its mana curve plus a light scan for
 * aggressive combat keywords on cheap creatures. Consumed by deck analysis and
 * the deck-identity strip.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import type { CurveSlot } from './deckAnalyzer';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';

// ─── Types ───────────────────────────────────────────────────────────

import type { Pacing } from '@/deck-builder/types';
export type { Pacing };

// ─── Pacing Detection ────────────────────────────────────────────────

const AGGRO_KEYWORDS = new Set([
  'haste',
  'first strike',
  'double strike',
  'menace',
  'trample',
  'prowess',
  'exalted',
]);

export function detectPacing(
  currentCards: ScryfallCard[],
  curveAnalysis: CurveSlot[]
): { pacing: Pacing; label: string } {
  const totalNonLand = curveAnalysis.reduce((sum, s) => sum + s.current, 0);
  if (totalNonLand === 0) return { pacing: 'balanced', label: 'a versatile approach' };

  const weightedCmc = curveAnalysis.reduce((sum, s) => sum + s.cmc * s.current, 0);
  const avgCmc = weightedCmc / totalNonLand;

  const earlyCount = curveAnalysis.filter((s) => s.cmc <= 2).reduce((sum, s) => sum + s.current, 0);
  const earlyPct = earlyCount / totalNonLand;

  const lateCount = curveAnalysis.filter((s) => s.cmc >= 5).reduce((sum, s) => sum + s.current, 0);
  const latePct = lateCount / totalNonLand;

  const midCount = curveAnalysis
    .filter((s) => s.cmc >= 3 && s.cmc <= 4)
    .reduce((sum, s) => sum + s.current, 0);
  const midPct = midCount / totalNonLand;

  // Scan for aggressive combat keywords on low-CMC creatures
  let aggroKeywordCount = 0;
  for (const card of currentCards) {
    if ((card.cmc ?? 99) > 3) continue;
    const typeLine = getFrontFaceTypeLine(card).toLowerCase();
    if (!typeLine.includes('creature')) continue;
    for (const kw of card.keywords || []) {
      if (AGGRO_KEYWORDS.has(kw.toLowerCase())) {
        aggroKeywordCount++;
        break;
      }
    }
  }
  const aggroKeywordPct = aggroKeywordCount / totalNonLand;

  if (avgCmc <= 2.4 && earlyPct >= 0.5 && aggroKeywordPct >= 0.08) {
    return { pacing: 'aggressive-early', label: 'early game aggression' };
  }
  if (avgCmc <= 2.7 && earlyPct >= 0.42) {
    return { pacing: 'fast-tempo', label: 'a fast, low-curve game plan' };
  }
  if (avgCmc >= 3.8 || latePct >= 0.28) {
    return { pacing: 'late-game', label: 'a late-game value engine' };
  }
  if (avgCmc >= 2.8 && avgCmc < 3.8 && midPct >= 0.3) {
    return { pacing: 'midrange', label: 'a steady midrange strategy' };
  }
  return { pacing: 'balanced', label: 'a versatile approach' };
}
