import './BracketBreakdown.css';
import type { JSX, ReactNode } from 'react';
import { InfoTip } from '../InfoTip';
import type { BracketEstimation } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import {
  bracketLabel,
  floorOf,
  softScorePoints,
  SOFT_SCORE,
} from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { formatBracketLabel } from '@/lib/format-bracket-label';
import type { ScryfallCard } from '@/deck-builder/types';
import { useCardCarousel } from './useCardCarousel';
import { MeterBar } from '../shared/MeterBar';

/** Actual deck `ScryfallCard`s by name. Passed so the card preview shows the
 *  printing in the deck instead of re-fetching the default printing by name. */
type DeckCardMap = ReadonlyMap<string, ScryfallCard>;

// The soft-score weights come from the estimator package itself, so the bars
// can't drift from the score they explain.
const {
  fastManaCap: FAST_MANA_CAP,
  fastManaPer: FAST_MANA_PER,
  tutorCap: TUTOR_CAP,
  tutorPer: TUTOR_PER,
  curveCap: CMC_CAP,
  curveThreshold: CMC_THRESHOLD,
  interactionCap: INTERACTION_CAP,
  enginePer: ENGINE_PER,
  engineCap: ENGINE_CAP,
  bumpAt: ELEVATE_BUMP_THRESHOLD,
  cedhAt: ELEVATE_CEDH_THRESHOLD,
} = SOFT_SCORE;

const HARD_FLOOR_TIP =
  'A hard floor is a deterministic signal (Game Changers, mass land denial, infinite combos, stax, or extra-turn cards) that forces a MINIMUM bracket. No amount of tuning can drop the deck below it; the only way down is to cut the offending cards.';
// One consolidated explainer for the power signal — intro + every signal —
// so the four rows don't each need their own info icon (which read as clutter).
const SOFT_SCORE_TIP: ReactNode = (
  <>
    <p className="info-tip-lead">
      The power signal (0–100) can only push your bracket <strong>up</strong> from the hard floor,
      never below it. It's built from five signals:
    </p>
    <ul className="info-tip-list">
      <li>
        <strong>Fast mana</strong>: rocks/rituals that make more mana than they cost (Mana Vault,
        Chrome Mox). Sol Ring is exempt as a precon staple. 8 pts each, max 40.
      </li>
      <li>
        <strong>Tutors</strong>: cards that search your library for anything (Demonic Tutor). They
        make the deck consistent. 5 pts each, max 25.
      </li>
      <li>
        <strong>Low curve</strong>: a low average mana value gets your plan online sooner; below 3.5
        earns up to 20 pts.
      </li>
      <li>
        <strong>Interaction</strong>: removal, counterspells and board wipes; more answers = a more
        resilient deck. Up to 15 pts.
      </li>
      <li>
        <strong>Combo engines</strong>: complete loops that don't end the game on their own, like
        drawing your library. Loops through the same card count once. 10 pts each, max 20.
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
              <span className="card-name-chip-text" title={name}>
                {name}
              </span>
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
  if (r.includes('combo')) return breakdown.comboPieceNames ?? [];
  return [];
}

/** An estimation persisted before combo pieces were recorded: show counts instead. */
function comboFloorNote(reason: string, breakdown: BracketEstimation['breakdown']): string | null {
  const r = reason.toLowerCase();
  if (!r.includes('combo') || breakdown.comboPieceNames) return null;
  const { twoCardComboCount: two, multiCardComboCount: multi } = breakdown;
  // Byte-identical to the pre-E97 note when the floor is two-card-only.
  if (multi === 0) return `${two} two-card combo${two === 1 ? '' : 's'} detected`;
  if (two === 0) return `${multi} multi-card combo${multi === 1 ? '' : 's'} detected`;
  return `${two} two-card + ${multi} multi-card combo${two + multi === 1 ? '' : 's'} detected`;
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
  const { breakdown, hardFloors, softScore, bracket } = estimation;

  // Core (2) when nothing fires: the estimator never infers Exhibition.
  const floor = floorOf(hardFloors);
  const lowPowerCombos = breakdown.lowPowerComboCount ?? 0;
  const loops = breakdown.loopCombos ?? [];
  const engines = breakdown.loopEngineCount ?? 0;

  const pts = softScorePoints(breakdown);
  const fastManaPts = pts.fastMana;
  const tutorPts = pts.tutors;
  const lowCurvePts = Math.round(pts.curve);
  // Interaction is the residual: it needs the deck's non-land count, which the
  // breakdown doesn't carry, and softScore is rounded.
  const interactionPts = Math.max(
    0,
    Math.min(INTERACTION_CAP, softScore - fastManaPts - tutorPts - lowCurvePts - pts.engines)
  );

  const elevatedToCedh = floor >= 4 && softScore >= ELEVATE_CEDH_THRESHOLD && bracket === 5;
  const elevatedByBump = floor < 4 && softScore >= ELEVATE_BUMP_THRESHOLD && bracket > floor;

  // Distance to the next threshold the power signal can still cross. The
  // estimator only elevates two ways (bracketEstimator.ts): floor ≥ 4 reaches
  // cEDH at 80, floor < 4 bumps one bracket at 66. Once a deck has crossed its
  // applicable threshold there's no further score-driven move, so this is null
  // — the "elevated" notes below already say what happened.
  const nextThreshold: { need: number; at: number; target: string } | null =
    floor >= 4
      ? bracket < 5
        ? {
            need: ELEVATE_CEDH_THRESHOLD - softScore,
            at: ELEVATE_CEDH_THRESHOLD,
            target: formatBracketLabel(5),
          }
        : null
      : bracket === floor
        ? {
            need: ELEVATE_BUMP_THRESHOLD - softScore,
            at: ELEVATE_BUMP_THRESHOLD,
            target: formatBracketLabel(Math.min(floor + 1, 4)),
          }
        : null;

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
          <p className="bracket-breakdown-empty">
            No hard floors, so the deck starts at {formatBracketLabel(floor)}.
          </p>
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
        {loops.length > 0 ? (
          <div className="bracket-breakdown-loops">
            <p className="bracket-breakdown-footnote">
              {loops.length === 1
                ? 'This loop sets no floor: it draws cards or repeats without ending the game on its own, and the brackets only limit combos that do. It adds to the power signal as a combo engine.'
                : `These ${loops.length} loops set no floor: they draw cards or repeat without ending the game on their own, and the brackets only limit combos that do. They add to the power signal as combo engines.`}
            </p>
            <ul className="bracket-breakdown-loop-list">
              {loops.map((cards) => (
                <li key={cards.join('+')}>
                  <CardChips names={cards} deckCardsByName={deckCardsByName} />
                </li>
              ))}
            </ul>
          </div>
        ) : (
          lowPowerCombos > 0 && (
            <p className="bracket-breakdown-footnote">
              {lowPowerCombos === 1
                ? '1 more combo is in the deck, but'
                : `${lowPowerCombos} more combos are in the deck, but`}{' '}
              Commander Spellbook rates {lowPowerCombos === 1 ? 'it' : 'them'} fine at Bracket 2
              (they loop without ending the game, or finish it slowly), so no floor.
            </p>
          )
        )}
      </div>

      {/* ── 2 + 3. Power signal + calculation ── the 0–100 tuning components
          and the arithmetic that turns floor + signal into the bracket. Behind
          a disclosure: the verdict sentence ("because: …") up in the Power
          hero is the conclusion; this is the working, for anyone who wants to
          see how the number adds up. The summary carries the score so a closed
          disclosure still states the one figure that matters. */}
      <details className="bracket-breakdown-section bracket-breakdown-details">
        <summary className="bracket-breakdown-heading bracket-breakdown-summary-toggle">
          <span>Power signal</span>
          <span className="bracket-breakdown-summary-score">{softScore}/100</span>
        </summary>
        <p className="bracket-breakdown-signal-lede">
          Fast mana, tutors, a low curve, interaction and combo engines each add points.
          <InfoTip label="the power signal" text={SOFT_SCORE_TIP} wide />
        </p>
        <div className="deck-bracket-table" role="table" aria-label="Power signal">
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
            detail={`Avg mana value ${breakdown.averageCmc.toFixed(2)}${
              breakdown.averageCmc < CMC_THRESHOLD
                ? ` (${(CMC_THRESHOLD - breakdown.averageCmc).toFixed(2)} below ${CMC_THRESHOLD})`
                : ` (no bonus above ${CMC_THRESHOLD})`
            }`}
          />
          <SoftScoreRow
            label="Interaction"
            value={interactionPts}
            max={INTERACTION_CAP}
            detail={`${breakdown.interactionCount} removal, counters + boardwipes`}
          />
          <SoftScoreRow
            label="Combo engines"
            value={pts.engines}
            max={ENGINE_CAP}
            detail={
              engines > 0
                ? `${engines} engine${engines === 1 ? '' : 's'} × ${ENGINE_PER} pts${
                    loops.length > engines
                      ? ` (${loops.length} loops; loops through one card count once)`
                      : ''
                  }`
                : 'No loops that stop short of winning'
            }
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

        <div className="bracket-breakdown-summary">
          <p className="bracket-breakdown-summary-line">
            Floor Bracket <strong>{floor}</strong> + power signal <strong>{softScore}/100</strong> →{' '}
            {formatBracketLabel(bracket)}
          </p>
          {elevatedToCedh && (
            <p className="bracket-breakdown-summary-note">
              Power signal ≥ {ELEVATE_CEDH_THRESHOLD} with floor ≥ 4 elevated this to{' '}
              {bracketLabel(5)}.
            </p>
          )}
          {elevatedByBump && (
            <p className="bracket-breakdown-summary-note">
              Power signal ≥ {ELEVATE_BUMP_THRESHOLD} bumped the floor from Bracket {floor} up to
              Bracket {bracket}.
            </p>
          )}
          {nextThreshold && (
            <p className="bracket-breakdown-summary-note bracket-breakdown-distance">
              <strong>{nextThreshold.need}</strong> more power{' '}
              {nextThreshold.need === 1 ? 'point' : 'points'} ({softScore} → {nextThreshold.at})
              would move this to {nextThreshold.target}.
            </p>
          )}
        </div>
      </details>
      <p className="bracket-breakdown-footnote">
        Estimated from the card list alone. Pilot skill and what your table plays aren&rsquo;t in
        it, so treat it as the start of the Rule 0 talk.
      </p>
    </section>
  );
}
