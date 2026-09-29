/**
 * Curve fit: the nonland spells' share per play phase (early 0-2, mid 3-4,
 * late 5+) against the pacing-aware targets curveGrading.ts grades the deck
 * page with (`pacingAwarePhaseTargets`), under the same rule: early and mid
 * are penalized only for being short (cheap spells never hurt), late both ways
 * (top-heavy is the classic Commander mistake).
 *
 *   dev = (target − share) / target   (early, mid: max(0, dev); late: |dev|)
 *   penalty = CURVE_SCALE × Σ max(0, dev − CURVE_BAND)²
 *
 * CURVE_BAND 0.2 is curveGrading's own "on target" band, so a curve the deck
 * page calls on target costs nothing. The pacing is the CONTEXT's (the plan's),
 * never re-derived from the deck, so the target can't move to meet the deck.
 */
import { CURVE_PHASES, pacingAwarePhaseTargets } from '../../curveGrading';
import type { CardNote } from '../types';
import { nonLandCards, pct, type TermFn } from './shared';

export const CURVE_BAND = 0.2;
/** A late phase at twice its target (dev 1) costs CURVE_SCALE × 0.64 ≈ 1.9 card-equivalents. */
export const CURVE_SCALE = 3;

export const curveTerm: TermFn = (deck, ctx) => {
  const spells = nonLandCards(deck);
  const targets = pacingAwarePhaseTargets(ctx.pacing ?? 'balanced');
  const bucket = (cmc: number) => Math.min(Math.floor(cmc), 7);
  const notes: CardNote[] = [];
  const parts: string[] = [];
  let value = 0;
  for (const phase of CURVE_PHASES) {
    const members = spells.filter((c) => phase.cmcs.includes(bucket(c.cmc ?? 0)));
    const share = spells.length ? members.length / spells.length : 0;
    const target = targets[phase.key];
    parts.push(`${phase.label.toLowerCase()} ${pct(share)} (target ${pct(target)})`);
    if (target <= 0) continue;
    const raw = (target - share) / target;
    const dev = phase.key === 'late' ? Math.abs(raw) : Math.max(0, raw);
    const excess = Math.max(0, dev - CURVE_BAND);
    if (excess === 0) continue;
    const pen = CURVE_SCALE * excess * excess;
    value -= pen;
    const over = share > target;
    // Over: the phase's own cards are the cause, priciest first. Under: every
    // spell outside the phase shares it (nothing in the phase to blame).
    const blamed = over ? members : spells.filter((c) => !phase.cmcs.includes(bucket(c.cmc ?? 0)));
    for (const c of blamed) {
      notes.push({
        name: c.name,
        value: -pen / blamed.length,
        note: over
          ? `${phase.label.toLowerCase()} phase is heavy: ${pct(share)} of spells, target ${pct(target)}`
          : `${phase.label.toLowerCase()} phase is thin: ${pct(share)} of spells, target ${pct(target)}`,
      });
    }
  }
  return { value, summary: parts.join(', '), cards: notes };
};
