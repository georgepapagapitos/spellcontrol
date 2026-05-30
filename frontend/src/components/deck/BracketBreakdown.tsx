import './BracketBreakdown.css';
import type { BracketEstimation } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { bracketLabel } from '@/deck-builder/services/deckBuilder/bracketEstimator';

// Mirror the soft-score formula in estimateBracket() so the bars reflect the
// actual per-component contributions. Keep these in lockstep with
// bracketEstimator.ts (the source of truth).
const FAST_MANA_CAP = 40;
const FAST_MANA_PER = 8;
const TUTOR_CAP = 25;
const TUTOR_PER = 5;
const CMC_CAP = 20;
const CMC_THRESHOLD = 3.5;
const CMC_PER = 15;
// Interaction is the residual: softScore is rounded, so we derive the
// interaction points from what the other three components didn't cover.
const INTERACTION_CAP = 15;

const ELEVATE_BUMP_THRESHOLD = 66;
const ELEVATE_CEDH_THRESHOLD = 80;

function CardChips({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <ul className="bracket-breakdown-chips">
      {names.map((name) => (
        <li key={name} className="bracket-breakdown-chip">
          {name}
        </li>
      ))}
    </ul>
  );
}

/** Which contributing card names a given hard floor should surface. */
function floorChips(reason: string, breakdown: BracketEstimation['breakdown']): string[] {
  const r = reason.toLowerCase();
  if (r.includes('game changer')) return breakdown.gameChangerNames;
  if (r.includes('land denial')) return breakdown.massLandDenialNames;
  if (r.includes('extra turn')) return breakdown.extraTurnNames;
  if (r.includes('stax')) return breakdown.staxPieceNames;
  return [];
}

/** Combo floors have no card names in the breakdown — show counts instead. */
function comboFloorNote(reason: string, breakdown: BracketEstimation['breakdown']): string | null {
  const r = reason.toLowerCase();
  if (!r.includes('combo')) return null;
  if (r.includes('early')) {
    return `${breakdown.earlyComboCount} early-game combo${breakdown.earlyComboCount === 1 ? '' : 's'} detected`;
  }
  return `${breakdown.lateComboCount} late-game combo${breakdown.lateComboCount === 1 ? '' : 's'} detected`;
}

/** One row in the soft-score table: component name, value/max, detail, chips. */
function SoftScoreRow({
  label,
  value,
  max,
  detail,
  chips,
}: {
  label: string;
  value: number;
  max: number;
  detail: string;
  chips?: string[];
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="deck-bracket-row" role="row">
      <div className="deck-bracket-cell deck-bracket-cell-label" role="cell">
        <span className="bracket-breakdown-bar-label">{label}</span>
        <span className="bracket-breakdown-bar-value">
          {value}/{max}
        </span>
        <div className="bracket-breakdown-bar-track">
          <div className="bracket-breakdown-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="deck-bracket-cell deck-bracket-cell-detail" role="cell">
        <p className="bracket-breakdown-bar-detail">{detail}</p>
        {chips && <CardChips names={chips} />}
      </div>
    </div>
  );
}

export function BracketBreakdown({ estimation }: { estimation: BracketEstimation }): JSX.Element {
  const { breakdown, hardFloors, softScore, bracket, label } = estimation;

  const floor = hardFloors.length > 0 ? Math.max(...hardFloors.map((f) => f.bracket)) : 1;

  // Per-component soft-score points (mirrors estimateBracket).
  const fastManaPts = Math.min(FAST_MANA_CAP, breakdown.fastManaCount * FAST_MANA_PER);
  const tutorPts = Math.min(TUTOR_CAP, breakdown.tutorCount * TUTOR_PER);
  const lowCurvePts = Math.round(
    Math.min(CMC_CAP, Math.max(0, (CMC_THRESHOLD - breakdown.averageCmc) * CMC_PER))
  );
  // Interaction bonus = total soft score minus the three computable parts.
  const interactionPts = Math.max(
    0,
    Math.min(INTERACTION_CAP, softScore - fastManaPts - tutorPts - lowCurvePts)
  );

  const elevatedToCedh = floor >= 4 && softScore >= ELEVATE_CEDH_THRESHOLD && bracket === 5;
  const elevatedByBump = floor < 4 && softScore >= ELEVATE_BUMP_THRESHOLD && bracket > floor;

  // Sort hard floors strongest-first for display.
  const sortedFloors = [...hardFloors].sort((a, b) => b.bracket - a.bracket);

  return (
    <section className="bracket-breakdown" aria-label="Bracket breakdown">
      {/* ── 1. Hard floors ── deterministic signals that force a minimum bracket. */}
      <div className="bracket-breakdown-section">
        <h4 className="bracket-breakdown-heading">Hard floors</h4>
        {sortedFloors.length === 0 ? (
          <p className="bracket-breakdown-empty">No hard floors — bracket set by soft score.</p>
        ) : (
          <div className="deck-bracket-table" role="table" aria-label="Hard floors">
            <div className="deck-bracket-row deck-bracket-head" role="row">
              <span className="deck-bracket-cell deck-bracket-col-head" role="columnheader">
                Floor
              </span>
              <span className="deck-bracket-cell deck-bracket-col-head" role="columnheader">
                Reason
              </span>
            </div>
            {sortedFloors.map((f, i) => {
              const chips = floorChips(f.reason, breakdown);
              const comboNote = comboFloorNote(f.reason, breakdown);
              return (
                <div
                  key={`${f.bracket}-${f.reason}-${i}`}
                  className="deck-bracket-row deck-bracket-floor-row"
                  role="row"
                >
                  <span
                    className="deck-bracket-cell deck-bracket-cell-floor bracket-breakdown-floor-tag"
                    role="cell"
                  >
                    Floor: Bracket {f.bracket}
                  </span>
                  <div className="deck-bracket-cell deck-bracket-cell-reason" role="cell">
                    <span className="bracket-breakdown-floor-reason">{f.reason}</span>
                    {f.detail && <span className="bracket-breakdown-floor-detail">{f.detail}</span>}
                    {comboNote && (
                      <span className="bracket-breakdown-floor-detail">{comboNote}</span>
                    )}
                    <CardChips names={chips} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 2. Soft score ── the 0–100 tuning components. */}
      <div className="bracket-breakdown-section">
        <h4 className="bracket-breakdown-heading">Soft score</h4>
        <div className="deck-bracket-table" role="table" aria-label="Soft score">
          <div className="deck-bracket-row deck-bracket-head" role="row">
            <span className="deck-bracket-cell deck-bracket-col-head" role="columnheader">
              Signal
            </span>
            <span className="deck-bracket-cell deck-bracket-col-head" role="columnheader">
              Detail
            </span>
          </div>
          <SoftScoreRow
            label="Fast mana"
            value={fastManaPts}
            max={FAST_MANA_CAP}
            detail={
              breakdown.fastManaCount > 0
                ? `${breakdown.fastManaCount} source${breakdown.fastManaCount === 1 ? '' : 's'} × ${FAST_MANA_PER} pts`
                : 'No fast mana sources'
            }
            chips={breakdown.fastManaNames}
          />
          <SoftScoreRow
            label="Tutors"
            value={tutorPts}
            max={TUTOR_CAP}
            detail={
              breakdown.tutorCount > 0
                ? `${breakdown.tutorCount} tutor${breakdown.tutorCount === 1 ? '' : 's'} × ${TUTOR_PER} pts`
                : 'No tutors detected'
            }
            chips={breakdown.tutorNames}
          />
          <SoftScoreRow
            label="Low curve"
            value={lowCurvePts}
            max={CMC_CAP}
            detail={`Avg CMC ${breakdown.averageCmc.toFixed(2)}${
              breakdown.averageCmc < CMC_THRESHOLD
                ? ` (${(CMC_THRESHOLD - breakdown.averageCmc).toFixed(2)} below ${CMC_THRESHOLD})`
                : ` (no bonus above ${CMC_THRESHOLD})`
            }`}
          />
          <SoftScoreRow
            label="Interaction"
            value={interactionPts}
            max={INTERACTION_CAP}
            detail={`${breakdown.interactionCount} removal + boardwipes`}
          />
          <div className="deck-bracket-row deck-bracket-total-row" role="row">
            <span className="deck-bracket-cell deck-bracket-total-label" role="cell">
              Total
            </span>
            <span className="deck-bracket-cell deck-bracket-total-value" role="cell">
              {softScore}/100
            </span>
          </div>
        </div>
      </div>

      {/* ── 3. Calculation summary ── */}
      <div className="bracket-breakdown-section bracket-breakdown-summary">
        <p className="bracket-breakdown-summary-line">
          Floor Bracket <strong>{floor}</strong> + soft score <strong>{softScore}/100</strong> →
          Bracket <strong>{bracket}</strong> ({label})
        </p>
        {elevatedToCedh && (
          <p className="bracket-breakdown-summary-note">
            Soft score ≥ {ELEVATE_CEDH_THRESHOLD} with floor ≥ 4 elevated this to {bracketLabel(5)}.
          </p>
        )}
        {elevatedByBump && (
          <p className="bracket-breakdown-summary-note">
            Soft score ≥ {ELEVATE_BUMP_THRESHOLD} bumped the floor from Bracket {floor} up to
            Bracket {bracket}.
          </p>
        )}
      </div>
    </section>
  );
}
