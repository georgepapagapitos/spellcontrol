import { type JSX, useMemo } from 'react';
import { TURN_EXPECTATIONS } from '@spellcontrol/deck-metrics';
import type { GameRecord } from '@spellcontrol/game-core';
import { effectiveBracket, type Deck } from '@/store/decks';
import { deckVersionOf, versionCardCount } from '@/lib/deck/deck-version';
import {
  deckOutcomes,
  lowerMedian,
  OUTCOME_MIN_GAMES,
  type VersionOutcomes,
} from '@/lib/play/deck-outcomes';
import { turnLabel } from '@/lib/mana-sim/turn-distribution';
import type { ClockCard } from '@/lib/mana-sim/opening-hand-sim';
import type { SpeedPath } from '@/lib/mana-sim/speed-path';
import { useAssemblyClock } from '@/lib/mana-sim/use-assembly-clock';

interface DeckOutcomeReadProps {
  deck: Deck;
  history: readonly GameRecord[];
  userId: string | null;
  /** The deck as the clock reads it, and its win path (`speedPathOf`), the
   *  same inputs the Bracket panel's Speed section times. */
  clockLibrary: readonly ClockCard[];
  speedPath: SpeedPath | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function range(values: readonly number[]): string {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return lo === hi ? `turn ${lo}` : `turns ${lo} to ${hi}`;
}

/**
 * The forecast against what happened: the assembly clock for the list the deck
 * holds now, beside the tracked games played with that same list. Evidence
 * only. The clock is a goldfish estimate of when the win path is in place; a
 * game's length is when the table ended, so a win by combat can sit on either
 * side of it. Games before versions were recorded can't be matched to a list
 * and are counted out loud, not folded in.
 */
export function DeckOutcomeRead({
  deck,
  history,
  userId,
  clockLibrary,
  speedPath,
}: DeckOutcomeReadProps): JSX.Element {
  const version = useMemo(() => deckVersionOf(deck), [deck]);
  const out = useMemo(
    () => deckOutcomes(history, userId, deck.id, version),
    [history, userId, deck.id, version]
  );
  const { clock, pending } = useAssemblyClock(clockLibrary, speedPath?.assembly ?? null, {
    iterations: 1000,
    wildcards: speedPath?.tutors ? [...speedPath.tutors] : undefined,
  });
  const bracket = effectiveBracket(deck);
  const { current, otherVersions, unversioned } = out;

  return (
    <section className="table-record-outcome" aria-labelledby={`outcome-h-${deck.id}`}>
      <h4 className="table-record-subhead" id={`outcome-h-${deck.id}`}>
        Forecast against the table
      </h4>
      <p className="table-record-outcome-version">
        This list: {plural(versionCardCount(version) ?? 0, 'card')}
        {current.games > 0 ? `, ${plural(current.games, 'game')} tracked` : ''}. Turn N is the
        deck's own Nth turn, the table's round N.
      </p>
      <dl className="table-record-outcome-rows" aria-busy={pending}>
        <div className="table-record-outcome-row">
          <dt>Forecast</dt>
          <dd>
            {pending ? (
              'Running the forecast'
            ) : clock ? (
              <>
                Win path in place by turn {turnLabel(clock, clock.typicalTurn)} in half of games, by
                turn {turnLabel(clock, clock.p90Turn)} in nine of ten
                <span className="table-record-outcome-n">
                  from {clock.runs.toLocaleString()} simulated games
                </span>
              </>
            ) : (
              'No win path to time for this deck, so there is no forecast to compare.'
            )}
          </dd>
        </div>
        <div className="table-record-outcome-row">
          <dt>Games won</dt>
          <dd>{wonRead(current)}</dd>
        </div>
        <div className="table-record-outcome-row">
          <dt>Game length</dt>
          <dd>{lengthRead(current, bracket)}</dd>
        </div>
      </dl>
      {(unversioned > 0 || otherVersions > 0 || current.games > current.lengths.length) && (
        <p className="table-record-outcome-note">
          {[
            current.games > current.lengths.length
              ? `${plural(current.games - current.lengths.length, 'game')} with this list passed no turns, so ${current.games - current.lengths.length === 1 ? 'it has' : 'they have'} no length.`
              : null,
            otherVersions > 0
              ? `${plural(otherVersions, 'game')} used an earlier list and ${otherVersions === 1 ? 'is' : 'are'} not counted here.`
              : null,
            unversioned > 0
              ? `${plural(unversioned, 'game')} ${unversioned === 1 ? 'was' : 'were'} tracked before lists were recorded, so ${unversioned === 1 ? 'it' : 'they'} can't be matched to this one.`
              : null,
          ]
            .filter(Boolean)
            .join(' ')}
        </p>
      )}
    </section>
  );
}

function wonRead(v: VersionOutcomes): JSX.Element | string {
  const n = v.winLengths.length;
  if (v.games === 0) return 'No tracked games with this list yet.';
  if (n < OUTCOME_MIN_GAMES) {
    return `${plural(n, 'win')} with turns tracked so far. ${OUTCOME_MIN_GAMES} are needed before the turns can be compared.`;
  }
  return (
    <>
      Won by turn {lowerMedian(v.winLengths)} in half of them, {range(v.winLengths)} in all
      <span className="table-record-outcome-n">from {plural(n, 'win')}</span>
    </>
  );
}

function lengthRead(v: VersionOutcomes, bracket: number | undefined): JSX.Element | string {
  const n = v.lengths.length;
  if (v.games === 0) return 'No tracked games with this list yet.';
  if (n < OUTCOME_MIN_GAMES) {
    return `${plural(n, 'game')} with turns tracked so far. ${OUTCOME_MIN_GAMES} are needed before a length can be read.`;
  }
  const median = lowerMedian(v.lengths) as number;
  const expected =
    bracket !== undefined && bracket >= 1 && bracket <= 4
      ? TURN_EXPECTATIONS[bracket as 1 | 2 | 3 | 4]
      : null;
  return (
    <>
      Half ended by turn {median}, {range(v.lengths)} in all
      <span className="table-record-outcome-n">from {plural(n, 'game')}</span>
      {expected !== null ? (
        <span className="table-record-outcome-vs">
          Bracket {bracket} expects games to last to turn {expected} or later;{' '}
          {median >= expected
            ? `half of these lasted to turn ${median}.`
            : `half of these ended by turn ${median}.`}
        </span>
      ) : (
        <span className="table-record-outcome-vs">
          {bracket === 5
            ? 'Bracket 5 sets no minimum turn.'
            : 'This deck has no bracket yet, so there is no turn to hold it to.'}
        </span>
      )}
    </>
  );
}
