import type { PlaytestAction, PlaytestState } from '@/lib/playtest';
import type { GameLogEntry } from '@/lib/playtest/game-log';
import { haptics } from '@/lib/util/haptics';
import { usePlayStore } from '@/store/play';
import type { OnlineTable } from '../../hooks/use-online-table';
import { ZERO_MANA_POOL } from '../../lib/board-support';
import { LogDock } from '../LogDock';
import { ManaPool } from '../ManaPool';
import { TableTickerDock, tickerSeatName } from '../TableTicker';

interface BoardLeftDockProps {
  state: PlaytestState;
  dispatch: (action: PlaytestAction) => void;
  onlineTable: OnlineTable | null;
  manaOpen: boolean;
  setManaOpen: (open: boolean) => void;
  showLog: boolean;
  setShowLog: (open: boolean) => void;
  logOnTable: boolean;
  toggleTableLog: () => void;
  gameLog: GameLogEntry[];
  playtestDeckId: string | null | undefined;
}

/**
 * The table tier's bottom-left dock: the mana tracker, the log and the table
 * feed's button, stacked.
 */
export function BoardLeftDock({
  state,
  dispatch,
  onlineTable,
  manaOpen,
  setManaOpen,
  showLog,
  setShowLog,
  logOnTable,
  toggleTableLog,
  gameLog,
  playtestDeckId,
}: BoardLeftDockProps) {
  const onlineTicker = usePlayStore((s) => s.onlineTicker);
  // dock rather than inside the life panel — floating mana is something you
  // read while looking at your lands and your hand, not while looking at your
  // life total. Closed and empty it is nothing at all (six always-zero
  // steppers have no business sitting on the table all game); closed with
  // mana floating it is one "Mana · 3" chip; M or the chip opens the pool.
  const manaTotal = Object.values(state.manaPool ?? ZERO_MANA_POOL).reduce((a, b) => a + b, 0);
  const manaPool = (
    <ManaPool
      layout="column"
      pool={state.manaPool ?? ZERO_MANA_POOL}
      onAdjust={(color, delta) => {
        haptics.tap();
        dispatch({ type: 'ADJUST_MANA', color, delta });
      }}
      onEmpty={() => {
        haptics.tap();
        dispatch({ type: 'EMPTY_MANA_POOL' });
      }}
    />
  );
  const manaRow = manaOpen ? (
    manaPool
  ) : manaTotal > 0 ? (
    <button
      type="button"
      className="playtest-mana-collapsed"
      onClick={() => setManaOpen(true)}
      title="Floating mana (M)"
    >
      Mana <span className="playtest-mana-collapsed__count">{manaTotal}</span>
    </button>
  ) : null;

  return (
    <>
      {/* Bottom-left dock column (table tier; the narrow tier keeps the log
          sheet and puts mana in the trackers row). Mana sits above the log,
          above the table feed's button, and they stack with flexbox rather than
          arithmetic: the log's height is content-driven and capped at a MAX,
          and it is unmounted entirely when closed — any hand-computed offset
          is wrong in both directions (an early one put the mana column off
          the top of the screen). The dock mounts for an online table even
          with no mana and the log closed: the table log toggle (#2073) has
          to stay reachable, not appear only when something else is open. */}
      {(manaRow || showLog || onlineTable) && (
        <div className="playtest-left-dock">
          {manaRow && <div className="playtest-mana-dock">{manaRow}</div>}
          {showLog && (
            <LogDock
              log={gameLog}
              popoutHref={playtestDeckId ? `/decks/${playtestDeckId}/playtest/log` : undefined}
              table={
                onlineTable
                  ? { items: onlineTicker, nameFor: (seat) => tickerSeatName(onlineTable, seat) }
                  : undefined
              }
              phase={
                onlineTable
                  ? {
                      current: onlineTable.phase,
                      mine: onlineTable.activeSeat === onlineTable.mySeat,
                      onSet: (p) =>
                        onlineTable.dispatch({
                          type: 'phase',
                          phase: p,
                          actorSeat: onlineTable.mySeat,
                        }),
                    }
                  : undefined
              }
              startOnTable={logOnTable}
              onClose={() => setShowLog(false)}
            />
          )}
          {onlineTable && (
            <TableTickerDock onlineTable={onlineTable} open={showLog} onToggle={toggleTableLog} />
          )}
        </div>
      )}
    </>
  );
}
