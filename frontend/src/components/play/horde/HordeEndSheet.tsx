import { Sheet } from '@/components/overlays/Sheet';
import { usePlayStore } from '@/store/play';
import { aggregateHordeRecords } from '@/lib/horde/horde-records';
import './horde-sheets.css';
import { Button } from '@/components/shared/Button';

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
  /** True when `onDone` asks first and can be declined (an online table's
   *  "Leave the table?"). Done then calls `onDone` with no exit, so a Cancel
   *  comes back to a live sheet. Otherwise Done plays the sheet's exit, like
   *  every other sheet, and `onDone` runs when it ends. */
  doneAsksFirst?: boolean;
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
  doneAsksFirst = false,
  playAgainLabel = 'Play again',
  doneLabel = 'Done',
  playAgainHint,
}: Props) {
  const history = usePlayStore((s) => s.history);
  const record = hideRecord
    ? undefined
    : aggregateHordeRecords(history).find((r) => r.hordeId === hordeId);

  const headline =
    outcome === 'won' ? 'The horde is gone' : `Overrun on turn ${endedOnTurn ?? hordeTurns}`;

  // Where Done ends the game outright (solo, the paper table), it plays the
  // exit and `onClose` runs `onDone` once the slide-out ends (at once under
  // reduced motion or on desktop). Where Done asks first (`doneAsksFirst`),
  // it calls `onDone` straight away: a Cancel there must come back to a live
  // sheet, and one routed through the exit was already half-closed by then,
  // its Done dead for good (#3260). That parent unmounts the sheet once the
  // leave really happens. Nothing else closes it: it isn't dismissable, so
  // Escape and Back are refused.
  return (
    <Sheet
      inPlace
      dismissable={false}
      onClose={onDone}
      className="horde-end-sheet"
      title={headline}
      footer={(close) => (
        <>
          <Button onClick={() => (doneAsksFirst ? onDone() : close())}>{doneLabel}</Button>
          {onPlayAgain ? (
            <Button variant="primary" onClick={onPlayAgain}>
              {playAgainLabel}
            </Button>
          ) : (
            playAgainHint && <p className="horde-end-hint">{playAgainHint}</p>
          )}
        </>
      )}
    >
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
    </Sheet>
  );
}
