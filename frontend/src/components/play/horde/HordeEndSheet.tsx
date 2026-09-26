import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { usePlayStore } from '@/store/play';
import { aggregateHordeRecords } from '@/lib/horde-records';
import './horde-sheets.css';

interface Props {
  outcome: 'won' | 'lost';
  hordeId: string;
  hordeTurns: number;
  damageTaken: number;
  cardsMilledByDamage: number;
  bossesBeaten: number;
  /** Solo (E387 PR 5): hides the "Record against this horde" line, which
   *  reads `usePlayStore` — a solo playtest game never touches Play history. */
  hideRecord?: boolean;
  /** Solo (E387 PR 5): the headline's "Overrun on turn N" prefers this over
   *  `hordeTurns` when present — solo, the turn that matters to the player
   *  is THEIRS (`state.turn`), not the horde's own round count, which can
   *  still read 0 on a loss before its first turn ever comes up. The paper
   *  table passes nothing and keeps reading `hordeTurns`, unchanged. */
  endedOnTurn?: number;
  /** Absent for a non-host seat at an online table (E387 online co-op): the
   *  server lets only the host rematch, so a joiner is offered no button
   *  that would bounce — `playAgainHint` explains why instead. */
  onPlayAgain?(): void;
  onDone(): void;
  /** Online co-op (E387): 'Rematch' host-side, 'Play again' everywhere else. */
  playAgainLabel?: string;
  /** Online co-op (E387): 'Leave table' at a table, 'Done' solo. */
  doneLabel?: string;
  /** Shown in place of the Play-again button when `onPlayAgain` is absent. */
  playAgainHint?: string;
}

/**
 * The horde table's end summary (design point 6): won/lost, the numbers that
 * made it so, then Play again / Done — the same terminal-moment shape as the
 * real local game's win recap.
 */
export function HordeEndSheet({
  outcome,
  hordeId,
  hordeTurns,
  damageTaken,
  cardsMilledByDamage,
  bossesBeaten,
  hideRecord = false,
  endedOnTurn,
  onPlayAgain,
  onDone,
  playAgainLabel = 'Play again',
  doneLabel = 'Done',
  playAgainHint,
}: Props) {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onDone);
  useLockBodyScroll();
  const history = usePlayStore((s) => s.history);
  const record = hideRecord
    ? undefined
    : aggregateHordeRecords(history).find((r) => r.hordeId === hordeId);

  const headline =
    outcome === 'won' ? 'The horde is gone' : `Overrun on turn ${endedOnTurn ?? hordeTurns}`;

  return (
    <div className="card-picker-root">
      <div
        className={`card-picker-sheet horde-end-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={headline}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">{headline}</h2>
        </div>
        <div className="card-picker-list horde-end-body">
          <ul className="horde-end-stats">
            <li>
              <span>Horde turns</span>
              <span>{hordeTurns}</span>
            </li>
            <li>
              <span>Damage taken</span>
              <span>{damageTaken}</span>
            </li>
            <li>
              <span>Cards milled by damage</span>
              <span>{cardsMilledByDamage}</span>
            </li>
            <li>
              <span>Bosses beaten</span>
              <span>{bossesBeaten}</span>
            </li>
            {record && (
              <li>
                <span>Record against this horde</span>
                <span>
                  {record.won}-{record.lost}
                </span>
              </li>
            )}
          </ul>
        </div>
        <div className="card-picker-footer">
          <button type="button" className="btn" onClick={() => beginClose()}>
            {doneLabel}
          </button>
          {onPlayAgain ? (
            <button type="button" className="btn btn-primary" onClick={onPlayAgain}>
              {playAgainLabel}
            </button>
          ) : (
            playAgainHint && <p className="horde-end-hint">{playAgainHint}</p>
          )}
        </div>
      </div>
    </div>
  );
}
