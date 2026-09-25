import './BracketBreakdown.css';
import type { JSX, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { InfoTip } from '../InfoTip';
import { SegmentedControl } from '../shared/form';
import type {
  BracketEstimation,
  BracketFloor,
} from '@/deck-builder/services/deckBuilder/bracketEstimator';
import {
  bracketBorderline,
  bracketLabel,
  floorOf,
  ratingOnlyComboFloor,
  softScorePoints,
  SOFT_SCORE,
} from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { formatBracketLabel } from '@/lib/format-bracket-label';
import { bracketPodLine } from '@/lib/bracket-pod-line';
import { canShare, openShareSheet } from '@/lib/web-share';
import { toast } from '@/store/toasts';
import type { ScryfallCard } from '@/deck-builder/types';
import { useCardCarousel } from './useCardCarousel';
import { MeterBar } from '../shared/MeterBar';
import { imageFromCard } from '@/lib/card-thumbs';
import { scryfallArtCrop } from '@/lib/offline/slim-to-scryfall';

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
  cedhMinGameChangers: CEDH_MIN_GAME_CHANGERS,
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
        <strong>Combo engines</strong>: complete combos that set no floor, like a loop that draws
        your library. Combos through the same card count once. 10 pts each, max 20.
      </li>
    </ul>
  </>
);

function CardChips({
  names,
  deckCardsByName,
  joined = false,
}: {
  names: string[];
  deckCardsByName?: DeckCardMap;
  /** The cards form one combo: show "+" between them. */
  joined?: boolean;
}) {
  const carousel = useCardCarousel('Bracket cards');
  if (names.length === 0) return null;
  const entries = names.map((name) => ({
    name,
    label: 'Contributing card',
    card: deckCardsByName?.get(name),
  }));
  return (
    <>
      <ul className={`bracket-breakdown-chips${joined ? ' bracket-breakdown-chips--joined' : ''}`}>
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

/** A card's art crop from the deck's own copy, front face first. The swap
 *  mends an offline copy, whose "art_crop" is the full card (deck hero rule). */
function artCropOf(card: ScryfallCard | undefined): string | undefined {
  const art = card && imageFromCard(card, 'art_crop');
  return art && scryfallArtCrop(art);
}

/**
 * The cards that set a floor, shown as their art: a floor is a claim about
 * specific cards, and "4 Game Changers" reads faster as four pictures than as
 * four outlined names. A card with no art on hand falls back to its name.
 * Tapping one previews it, the same carousel the name chips open.
 */
function CardArtTiles({
  names,
  deckCardsByName,
}: {
  names: string[];
  deckCardsByName?: DeckCardMap;
}) {
  const carousel = useCardCarousel('Bracket cards');
  if (names.length === 0) return null;
  const entries = names.map((name) => ({
    name,
    label: 'Contributing card',
    card: deckCardsByName?.get(name),
  }));
  return (
    <>
      <ul className="bracket-breakdown-art">
        {names.map((name) => {
          const art = artCropOf(deckCardsByName?.get(name));
          return (
            <li key={name}>
              <button
                type="button"
                className="bracket-breakdown-art-btn"
                onClick={() => void carousel.open(entries, name)}
                aria-label={`Preview ${name}`}
              >
                {art ? (
                  <img className="bracket-breakdown-art-img" src={art} alt="" loading="lazy" />
                ) : (
                  <span className="bracket-breakdown-art-img bracket-breakdown-art-img--none" />
                )}
                <span className="bracket-breakdown-art-name">{name}</span>
              </button>
            </li>
          );
        })}
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

type Bracket = 1 | 2 | 3 | 4 | 5;

function counted(n: number, noun: string, none: string): string {
  return n === 0 ? none : `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** One side of a judgment call: the bracket it reads as and why. */
interface Side {
  bracket: number;
  why: string;
}

/**
 * The call the estimate hangs on, argued both ways, with ours marked. Rendered
 * only when the deck is borderline: a bracket the rules settle has nothing to
 * argue. Ends with the owner's answer, which is the deck's stated Bracket.
 */
function JudgmentCall({
  question,
  chips,
  sides,
  ours,
  verdict,
  deckCardsByName,
  answer,
}: {
  question: string;
  chips?: string[];
  sides: [Side, Side];
  ours: number;
  verdict: string;
  deckCardsByName?: DeckCardMap;
  answer: ReactNode;
}): JSX.Element {
  const [lo, hi] = [...sides].sort((a, b) => a.bracket - b.bracket);
  return (
    <div className="bracket-breakdown-section bracket-call">
      <h4 className="bracket-breakdown-heading">
        <span className="bracket-call-kind bracket-call-kind--judgment">Judgment</span>
        Bracket {lo.bracket} or {hi.bracket}
      </h4>
      <p className="bracket-call-question">{question}</p>
      {chips && <CardChips names={chips} deckCardsByName={deckCardsByName} joined />}
      <div className="bracket-call-sides">
        {[hi, lo].map((s) => (
          <div
            key={s.bracket}
            className={`bracket-call-side${s.bracket === ours ? ' is-ours' : ''}`}
          >
            <p className="bracket-call-side-head">
              Reads as <strong>{s.bracket}</strong>
              {s.bracket === ours && <span className="bracket-call-ours">Our call</span>}
            </p>
            <p className="bracket-call-side-why">{s.why}</p>
          </div>
        ))}
      </div>
      <p className="bracket-call-verdict">{verdict}</p>
      {answer}
    </div>
  );
}

/** "Which does your table play it at?" Picking one states the deck's Bracket. */
function BracketAnswer({
  choices,
  stated,
  onChoose,
}: {
  choices: number[];
  stated: number | null;
  onChoose: (bracket: Bracket) => void;
}): JSX.Element {
  return (
    <div className="bracket-call-answer">
      <p className="bracket-call-answer-q" aria-hidden="true">
        Which does your table play it at?
      </p>
      {/* 0 matches no option: nothing is picked until the owner answers. */}
      <SegmentedControl
        ariaLabel="Which bracket does your table play it at?"
        value={stated ?? 0}
        options={choices.map((b) => ({ value: b, label: formatBracketLabel(b) }))}
        onChange={(b) => onChoose(b as Bracket)}
      />
      <p className="bracket-breakdown-footnote">
        {stated == null
          ? "Your answer becomes this deck's Bracket. The estimate stays beside it."
          : `This deck's Bracket is now ${stated}.`}
      </p>
    </div>
  );
}

/** The sentence an owner reads out (or pastes) before a game. */
function PodLine({ text }: { text: string }): JSX.Element {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ message: 'Copied for your pod.', tone: 'success' });
    } catch {
      toast.show({ message: "Couldn't copy. Select and copy manually.", tone: 'warn' });
    }
  };
  return (
    <div className="bracket-breakdown-section">
      <h4 className="bracket-breakdown-heading">Tell your pod</h4>
      <div className="bracket-pod">
        <p className="bracket-pod-text">{text}</p>
        <div className="bracket-pod-actions">
          <button type="button" className="btn" onClick={() => void copy()}>
            Copy
          </button>
          {canShare() && (
            <button type="button" className="btn" onClick={() => void openShareSheet({ text })}>
              Share
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The judgment a borderline estimate hangs on, or null when the rules settle it. */
function judgmentFor(
  estimation: BracketEstimation,
  ratingFloor: BracketFloor | null,
  hasSolRing: boolean
): {
  question: string;
  chips?: string[];
  sides: [Side, Side];
  verdict: string;
} | null {
  const { breakdown, bracket, softScore, hardFloors } = estimation;
  if (ratingFloor?.ruthlessCombos) {
    const [first, ...rest] = ratingFloor.ruthlessCombos;
    const which =
      rest.length === 0
        ? 'this combo'
        : rest.length === 1
          ? `this combo and ${rest[0].join(' + ')}`
          : `this combo and ${rest.length} more`;
    return {
      question: 'It turns on one question: does the combo come together early?',
      chips: first,
      sides: [
        {
          bracket: 4,
          why: `Commander Spellbook rates ${which} Ruthless, its rating for combos that belong at Bracket 4 and up.`,
        },
        {
          bracket: 3,
          // Sol Ring is exempt from fast mana (a precon staple), but a player
          // who sees it in the list would read "no fast mana" as a mistake.
          why: `The list has ${counted(breakdown.tutorCount, 'tutor', 'no tutors')} and ${counted(
            breakdown.fastManaCount,
            'fast mana card',
            'no fast mana'
          )}${hasSolRing ? ' besides Sol Ring' : ''}, too few to call the combo fast.`,
        },
      ],
      verdict:
        "We go with Spellbook's rating, so the estimate is Bracket 4, borderline 3. If your table counts late combos as Bracket 3, say so before the game.",
    };
  }

  const neighbour = bracketBorderline(estimation);
  if (neighbour == null) return null;
  const floor = floorOf(hardFloors);
  const hi = Math.max(bracket, neighbour);
  const lo = Math.min(bracket, neighbour);
  const at = floor >= 4 ? SOFT_SCORE.cedhAt : SOFT_SCORE.bumpAt;
  const gap = Math.abs(softScore - at);
  const where =
    gap === 0
      ? `right on the Bracket ${hi} line`
      : `${gap} point${gap === 1 ? '' : 's'} ${softScore > at ? 'over' : 'under'} the Bracket ${hi} line`;
  return {
    question: 'It turns on how strong the cards are overall.',
    sides: [
      { bracket: hi, why: `Power signal ${softScore}/100, ${where}.` },
      {
        bracket: lo,
        why:
          lo >= 4
            ? 'Bracket 4 is the floor the rules set. cEDH is a call on power alone.'
            : `Nothing in the list sets a Bracket ${hi} floor.`,
      },
    ],
    verdict: `The power signal decides it, so the estimate is Bracket ${bracket}, borderline ${neighbour}.`,
  };
}

export function BracketBreakdown({
  estimation,
  deckCardsByName,
  combosUncounted = false,
  bracketOverride = null,
  onSetBracketOverride,
}: {
  estimation: BracketEstimation;
  deckCardsByName?: DeckCardMap;
  /** The estimate was made before the combo match answered. A combo is what
   *  most often sets a floor, so "no hard floors" can't be claimed yet. */
  combosUncounted?: boolean;
  /** The owner's stated bracket, or null on Auto. */
  bracketOverride?: Bracket | null;
  /** The owner's control. Without it (someone else's deck) there is no
   *  answer to give and no pod line to copy. */
  onSetBracketOverride?: (bracket: Bracket | null) => void;
}): JSX.Element {
  const { breakdown, hardFloors, softScore, bracket } = estimation;

  // Core (2) when nothing fires: the estimator never infers Exhibition.
  const floor = floorOf(hardFloors);

  // A Bracket 4 that rests on Spellbook's rating alone is a judgment call, not
  // a settled floor: the combo counts as settled at 3 (the rules allow it late)
  // and the question of whether it's early is argued below.
  const ratingFloor = combosUncounted ? null : ratingOnlyComboFloor(estimation);
  const settledFloors: BracketFloor[] = hardFloors.map((f) =>
    f === ratingFloor
      ? {
          bracket: 3,
          reason: 'Two-card infinite combos',
          detail: 'Bracket 3 allows them only when they come together late.',
        }
      : f
  );
  const settledFloor = floorOf(settledFloors);
  const judgment = combosUncounted
    ? null
    : judgmentFor(estimation, ratingFloor, !!deckCardsByName?.has('Sol Ring'));
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
  // cEDH also needs the Game Changers; points alone can't get a deck there.
  const cedhNeedsGameChangers =
    floor >= 4 && bracket < 5 && breakdown.gameChangerCount < CEDH_MIN_GAME_CHANGERS;
  const nextThreshold: { need: number; at: number; target: string } | null =
    floor >= 4
      ? bracket < 5 && !cedhNeedsGameChangers
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
  const sortedFloors = [...settledFloors].sort((a, b) => b.bracket - a.bracket);

  const isOwner = !!onSetBracketOverride;
  const answer =
    judgment && onSetBracketOverride ? (
      <BracketAnswer
        choices={judgment.sides.map((s) => s.bracket).sort((a, b) => a - b)}
        stated={bracketOverride}
        onChoose={onSetBracketOverride}
      />
    ) : null;

  return (
    <section className="bracket-breakdown" aria-label="Bracket breakdown">
      {/* ── 1. Settled ── what the rules fix: deterministic floors. A deck
          that could still read higher says "at least". */}
      <div className="bracket-breakdown-section">
        <h4 className="bracket-breakdown-heading">
          <span className="bracket-call-kind">Settled</span>
          {combosUncounted || judgment || bracket > settledFloor ? 'At least ' : ''}Bracket{' '}
          {settledFloor}
          <InfoTip label="a hard floor" text={HARD_FLOOR_TIP} />
        </h4>
        {sortedFloors.length === 0 ? (
          <p className="bracket-breakdown-empty">
            {combosUncounted
              ? "No hard floors yet. Combos aren't counted, and a combo can set one."
              : `No hard floors, so the deck starts at ${formatBracketLabel(floor)}.`}
          </p>
        ) : (
          // One row per floor: the bracket it sets, why, and the cards that
          // set it, as their art. It was a two-column table inside a bordered
          // box inside the panel, for what is usually one reason.
          <ul className="bracket-breakdown-floors" aria-label="Hard floors">
            {sortedFloors.map((f, i) => {
              // The rewritten combo row shows no art: the judgment below
              // names the deciding pair, and the Combos panel lists them all.
              const chips = hardFloors.includes(f) ? floorChips(f.reason, breakdown) : [];
              const comboNote = comboFloorNote(f.reason, breakdown);
              return (
                <li key={`${f.bracket}-${f.reason}-${i}`} className="bracket-breakdown-floor">
                  <span className="bracket-breakdown-floor-tag">Bracket {f.bracket}</span>
                  <div className="bracket-breakdown-floor-body">
                    <span className="bracket-breakdown-floor-reason">{f.reason}</span>
                    {f.detail && <span className="bracket-breakdown-floor-detail">{f.detail}</span>}
                    {comboNote && (
                      <span className="bracket-breakdown-floor-detail">{comboNote}</span>
                    )}
                    <CardArtTiles names={chips} deckCardsByName={deckCardsByName} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {loops.length > 0 ? (
          <div className="bracket-breakdown-loops">
            <p className="bracket-breakdown-footnote">
              {loops.length === 1
                ? 'This combo sets no floor: Commander Spellbook rates it fine at Bracket 2, or it takes more than two cards. It adds to the power signal as a combo engine.'
                : `These ${loops.length} combos set no floor: Commander Spellbook rates them fine at Bracket 2, or they take more than two cards. They add to the power signal as combo engines.`}
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

      {judgment && (
        <JudgmentCall
          {...judgment}
          ours={bracket}
          deckCardsByName={deckCardsByName}
          answer={answer}
        />
      )}

      {/* ── 2. Power signal ── the score on its 0–100 scale with the line it
          would have to reach to move the bracket ticked, so "how close is it"
          reads at a glance. The bare "51/100" never said what 51 meant. */}
      <div className="bracket-breakdown-section bracket-breakdown-signal">
        <div className="bracket-breakdown-signal-head">
          <h4 className="bracket-breakdown-heading">Power signal</h4>
          <span className="bracket-breakdown-summary-score">{softScore}/100</span>
        </div>
        <MeterBar
          className="bracket-breakdown-signal-meter"
          value={softScore}
          max={100}
          tick={nextThreshold?.at}
        />
        {/* The scale's ends, and the tick's number under the tick, so the
            notch reads as a line on a 0–100 scale, not a stray mark. */}
        <div className="bracket-breakdown-signal-scale" aria-hidden>
          <span>0</span>
          {nextThreshold && (
            <span className="bracket-breakdown-signal-at" style={{ left: `${nextThreshold.at}%` }}>
              {nextThreshold.at}
            </span>
          )}
          <span>100</span>
        </div>
        {nextThreshold && (
          <p className="bracket-breakdown-summary-note bracket-breakdown-distance">
            <strong>{nextThreshold.need}</strong> more power{' '}
            {nextThreshold.need === 1 ? 'point' : 'points'} ({softScore} → {nextThreshold.at}) would
            move this to <span className="bracket-breakdown-target">{nextThreshold.target}</span>.
          </p>
        )}
        {cedhNeedsGameChangers && (
          <p className="bracket-breakdown-summary-note bracket-breakdown-distance">
            {bracketLabel(5)} also needs at least {CEDH_MIN_GAME_CHANGERS} Game Changers; this deck
            runs {breakdown.gameChangerCount}.
          </p>
        )}
      </div>
      {/* ── 3. The working ── the 0–100 tuning components and the arithmetic
          that turns floor + signal into the bracket, behind a disclosure: the
          scale above states the figure, this shows how it adds up. */}
      <details className="bracket-breakdown-section bracket-breakdown-details">
        <summary className="bracket-breakdown-heading bracket-breakdown-summary-toggle">
          <span>How the points add up</span>
          <ChevronDown width={14} height={14} aria-hidden />
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
                      ? ` (${loops.length} combos; combos through one card count once)`
                      : ''
                  }`
                : 'No combos outside the floor'
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
        </div>
      </details>
      <p className="bracket-breakdown-footnote">
        Estimated from the card list alone. Pilot skill and what your table plays aren&rsquo;t in
        it, so treat it as the start of the Rule 0 talk.
      </p>
      {isOwner && !combosUncounted && (
        <PodLine
          text={bracketPodLine(
            estimation,
            bracketOverride,
            judgment ? (bracketBorderline(estimation) ?? null) : null
          )}
        />
      )}
    </section>
  );
}
