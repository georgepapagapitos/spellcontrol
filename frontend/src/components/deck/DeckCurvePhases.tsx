import { useMemo } from 'react';
import './DeckCurvePhases.css';

/**
 * Visualizes a deck's mana curve as a CMC histogram (0..7+) and rolls the
 * counts up into three play-phases — Early (CMC 0-2), Mid (3-4), Late (5+) —
 * each with a transparent A–F grade.
 *
 * `manaCurve` is keyed by CMC where the key 7 is the "7+" bucket.
 */

// CMC slots we render, in order. 7 is the catch-all "7+" bucket.
const CMC_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

type Phase = {
  key: 'early' | 'mid' | 'late';
  label: string;
  /** CMCs that fall into this phase (7 = 7+). */
  cmcs: number[];
};

const PHASES: Phase[] = [
  { key: 'early', label: 'Early', cmcs: [0, 1, 2] },
  { key: 'mid', label: 'Mid', cmcs: [3, 4] },
  { key: 'late', label: 'Late', cmcs: [5, 6, 7] },
];

/**
 * Grading heuristic (explainability, not science).
 *
 * A healthy Commander curve is front-loaded: you want plenty of cheap plays
 * early and relatively few haymakers. We grade each phase purely on the share
 * of non-land spells it holds, against a simple target band per phase:
 *
 *   - Early should carry the most weight  → target ≈ 45% of spells
 *   - Mid is the body of the curve        → target ≈ 35%
 *   - Late should stay lean               → target ≈ 20%, and is *penalized*
 *     for being top-heavy (over its target), not just for being under it.
 *
 * Early/Mid are graded one-sided (only being under target hurts). Late is
 * graded two-sided: too few or too many both pull the grade down, because a
 * top-heavy curve is the classic Commander mistake. The grade is the absolute
 * fractional deviation from target mapped onto letters.
 */
const PHASE_TARGET: Record<Phase['key'], number> = {
  early: 0.45,
  mid: 0.35,
  late: 0.2,
};

function gradeFromDeviation(deviation: number): string {
  // deviation is a non-negative fraction (0 = on target).
  if (deviation <= 0.1) return 'A';
  if (deviation <= 0.2) return 'B';
  if (deviation <= 0.35) return 'C';
  if (deviation <= 0.55) return 'D';
  return 'F';
}

function gradePhase(key: Phase['key'], share: number): string {
  const target = PHASE_TARGET[key];
  if (target === 0) return 'A';
  const raw = (target - share) / target; // >0 means under target
  // Early/Mid: only being *under* target is a problem (more cheap/mid is fine).
  // Late: being over target (top-heavy) is the bigger problem, so grade on
  // absolute deviation either way.
  const penalized = key === 'late' ? Math.abs(raw) : Math.max(0, raw);
  return gradeFromDeviation(penalized);
}

export function DeckCurvePhases({
  manaCurve,
  averageCmc,
}: {
  manaCurve: Record<number, number>;
  averageCmc: number;
}): JSX.Element {
  const { slots, maxCount, phaseTotals } = useMemo(() => {
    const slots = CMC_SLOTS.map((cmc) => ({
      cmc,
      label: cmc === 7 ? '7+' : String(cmc),
      count: manaCurve[cmc] ?? 0,
    }));
    const maxCount = slots.reduce((m, s) => Math.max(m, s.count), 0);
    const total = slots.reduce((sum, s) => sum + s.count, 0);
    const phaseTotals = PHASES.map((phase) => {
      const count = phase.cmcs.reduce((sum, cmc) => sum + (manaCurve[cmc] ?? 0), 0);
      const share = total > 0 ? count / total : 0;
      return { ...phase, count, share, grade: gradePhase(phase.key, share) };
    });
    return { slots, maxCount, phaseTotals };
  }, [manaCurve]);

  return (
    <section className="deck-curve-phases" aria-label="Mana curve and phases">
      <div className="deck-curve-phases-head">
        <h4 className="deck-curve-phases-heading">Mana curve</h4>
        <span className="deck-curve-phases-avg">Avg CMC {averageCmc.toFixed(2)}</span>
      </div>

      {/* ── CMC histogram ── */}
      <ul className="deck-curve-phases-bars" aria-label="Cards by mana value">
        {slots.map((slot) => {
          const heightPct = maxCount > 0 ? (slot.count / maxCount) * 100 : 0;
          return (
            <li key={slot.cmc} className="deck-curve-phases-bar-col">
              <span className="deck-curve-phases-bar-count">{slot.count}</span>
              <div className="deck-curve-phases-bar-track">
                <div className="deck-curve-phases-bar-fill" style={{ height: `${heightPct}%` }} />
              </div>
              <span className="deck-curve-phases-bar-label">{slot.label}</span>
            </li>
          );
        })}
      </ul>

      {/* ── Phase rollup with grades ── */}
      <ul className="deck-curve-phases-phases" aria-label="Curve phases">
        {phaseTotals.map((phase) => (
          <li key={phase.key} className="deck-curve-phases-phase">
            <span className="deck-curve-phases-phase-label">{phase.label}</span>
            <span className="deck-curve-phases-phase-count">{phase.count}</span>
            <span
              className={`deck-curve-phases-grade deck-curve-phases-grade-${phase.grade.toLowerCase()}`}
              aria-label={`${phase.label} grade ${phase.grade}`}
            >
              {phase.grade}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
