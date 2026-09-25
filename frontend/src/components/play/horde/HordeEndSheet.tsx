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
  onPlayAgain(): void;
  onDone(): void;
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
  onPlayAgain,
  onDone,
}: Props) {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onDone);
  useLockBodyScroll();
  const history = usePlayStore((s) => s.history);
  const record = hideRecord
    ? undefined
    : aggregateHordeRecords(history).find((r) => r.hordeId === hordeId);

  const headline = outcome === 'won' ? 'The horde is gone' : `Overrun on turn ${hordeTurns}`;

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
            Done
          </button>
          <button type="button" className="btn btn-primary" onClick={onPlayAgain}>
            Play again
          </button>
        </div>
      </div>
    </div>
  );
}
