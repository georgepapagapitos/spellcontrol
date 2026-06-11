import './BracketBreakdown.css';
import type { JSX, ReactNode } from 'react';
import { InfoTip } from '../InfoTip';
import type { BracketEstimation } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { bracketLabel } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import type { ScryfallCard } from '@/deck-builder/types';
import { useCardCarousel } from './useCardCarousel';
import { MeterBar } from '../shared/MeterBar';

/** Actual deck `ScryfallCard`s by name. Passed so the card preview shows the
 *  printing in the deck instead of re-fetching the default printing by name. */
type DeckCardMap = ReadonlyMap<string, ScryfallCard>;

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

const HARD_FLOOR_TIP =
  'A hard floor is a deterministic signal — Game Changers, mass land denial, infinite combos, stax, or extra-turn cards — that forces a MINIMUM bracket. No amount of tuning can drop the deck below it; the only way down is to cut the offending cards.';
// One consolidated explainer for the whole soft score — intro + every signal —
// so the four rows don't each need their own info icon (which read as clutter).
const SOFT_SCORE_TIP: ReactNode = (
  <>
    <p className="info-tip-lead">
      The soft score (0–100) rates how tuned the deck is. It can only push the bracket{' '}
      <strong>up</strong> from the hard floor — never below it. Four signals feed it:
    </p>
    <ul className="info-tip-list">
      <li>
        <strong>Fast mana</strong> — rocks/rituals that make more mana than they cost (Sol Ring,
        Mana Crypt). 8 pts each, max 40.
      </li>
      <li>
        <strong>Tutors</strong> — cards that search your library for anything (Demonic Tutor). They
        make the deck consistent. 5 pts each, max 25.
      </li>
      <li>
        <strong>Low curve</strong> — a low average mana value does powerful things sooner; below 3.5
        earns up to 20 pts.
      </li>
      <li>
        <strong>Interaction</strong> — removal and board wipes; more answers = a more resilient
        deck. Up to 15 pts.
      </li>
    </ul>
  </>
);

function CardChips({ names, deckCardsByName }: { names: string[]; deckCardsByName?: DeckCardMap }) {
  const carousel = useCardCarousel('Bracket cards');
  if (names.length === 0) return null;
  const entries = names.map((name) => ({
    name,
    label: 'Contributing card',
    card: deckCardsByName?.get(name),
  }));
  return (
    <>
      <ul className="bracket-breakdown-chips">
        {names.map((name) => (
          <li key={name} className="bracket-breakdown-chip">
            <button
              type="button"
              className="bracket-breakdown-chip-btn"
              onClick={() => void carousel.open(entries, name)}
              aria-label={`Preview ${name}`}
            >
              {name}
            </button>
          </li>
        ))}
      </ul>
      {carousel.preview}
    </>
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
  deckCardsByName,
}: {
  label: string;
  value: number;
  max: number;
  detail: string;
  chips?: string[];
  deckCardsByName?: DeckCardMap;
}) {
  return (
    <div className="deck-bracket-row" role="row">
      <div className="deck-bracket-cell deck-bracket-cell-label" role="cell">
        <span className="bracket-breakdown-bar-label">{label}</span>
        <span className="bracket-breakdown-bar-value">
          {value}/{max}
        </span>
        <MeterBar className="bracket-breakdown-bar" value={value} max={max} />
      </div>
      <div className="deck-bracket-cell deck-bracket-cell-detail" role="cell">
        <p className="bracket-breakdown-bar-detail">{detail}</p>
        {chips && <CardChips names={chips} deckCardsByName={deckCardsByName} />}
      </div>
    </div>
  );
}

export function BracketBreakdown({
  estimation,
  deckCardsByName,
}: {
  estimation: BracketEstimation;
  deckCardsByName?: DeckCardMap;
}): JSX.Element {
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
        <h4 className="bracket-breakdown-heading">
          Hard floors
          <InfoTip label="a hard floor" text={HARD_FLOOR_TIP} />
        </h4>
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
                    <CardChips names={chips} deckCardsByName={deckCardsByName} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 2. Soft score ── the 0–100 tuning components. */}
      <div className="bracket-breakdown-section">
        <h4 className="bracket-breakdown-heading">
          Soft score
          <InfoTip label="the soft score" text={SOFT_SCORE_TIP} wide />
        </h4>
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
            deckCardsByName={deckCardsByName}
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
            deckCardsByName={deckCardsByName}
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
