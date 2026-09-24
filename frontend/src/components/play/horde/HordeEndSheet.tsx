import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { usePlayStore } from '@/store/play';
import { aggregateHordeRecords } from '@/lib/horde-records';

interface Props {
  outcome: 'won' | 'lost';
  hordeId: string;
  hordeTurns: number;
  damageTaken: number;
  cardsMilledByDamage: number;
  bossesBeaten: number;
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
  onPlayAgain,
  onDone,
}: Props) {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onDone);
  useLockBodyScroll();
  const history = usePlayStore((s) => s.history);
  const record = aggregateHordeRecords(history).find((r) => r.hordeId === hordeId);

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
            <li>Horde turns: {hordeTurns}</li>
            <li>Damage taken: {damageTaken}</li>
            <li>Cards milled by damage: {cardsMilledByDamage}</li>
            <li>Bosses beaten: {bossesBeaten}</li>
            {record && (
              <li>
                Record against this horde: {record.won}-{record.lost}
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
