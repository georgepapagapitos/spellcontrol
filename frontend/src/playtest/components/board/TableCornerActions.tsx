import type { ShortcutId } from '../../lib/shortcuts';
import type { OnlineHordeResult } from '../../hooks/use-online-horde';
import type { OnlineTable } from '../../hooks/use-online-table';
import { Menu } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { PhaseChip } from '@/components/play/PhaseChip';
import { formatClock, msToNextSecond } from '@/lib/play/game-clock';
import { useNow } from '@/lib/util/use-now';
import { HoldBanner } from '../HoldBanner';
import { HoldButton } from '../HoldButton';
import { ReactionPicker } from '../ReactionPicker';
import { TableSignals } from '../TableSignals';

/**
 * How long the seat on turn has been on it, under the turn number. Shown only
 * when the table turned the timer on in the lobby — it is a readout, never a
 * limit: nothing expires and nobody is forced to pass. Ticks off the wall
 * clock (`useNow`) rather than game state, so a table thinking hard still
 * sees the number move.
 */
function TurnTimer({ startedAt }: { startedAt: number }) {
  const now = useNow(true, (t) => msToNextSecond(t - startedAt));
  return (
    <span className="playtest-turn-chip__clock" aria-label="Time on this turn" role="img">
      {formatClock(Math.max(0, now - startedAt))}
    </span>
  );
}

interface TableCornerActionsProps {
  onlineTable: OnlineTable | null;
  onlineHorde: OnlineHordeResult | null;
  onlineHordePhase: 'setup' | 'survivors' | 'reveal' | 'combat' | 'ended' | null;
  isOnlineHordeTable: boolean;
  hordeBlocksTurn: boolean;
  isNarrow: boolean;
  turn: number;
  /** Whether the turn count can be pressed: always solo, on your turn online. */
  canAdvanceTurn: boolean;
  advanceTurn: () => unknown;
  activeName: string | undefined;
  keyFor: (id: ShortcutId) => string | undefined;
  showGameMenu: boolean;
  onOpenGameMenu: () => void;
  hasUnreadLog: boolean;
  takebackPending: boolean;
  selectMode: boolean;
  selectedCount: number;
  onToggleSelectMode: () => void;
}

/** The top-right corner cluster: the game menu button, the turn chip (or the
 *  team-turn chip at a horde table), the phase chip and the table signals. */
export function TableCornerActions({
  onlineTable,
  onlineHorde,
  onlineHordePhase,
  isOnlineHordeTable,
  hordeBlocksTurn,
  isNarrow,
  turn,
  canAdvanceTurn,
  advanceTurn,
  activeName,
  keyFor,
  showGameMenu,
  onOpenGameMenu,
  hasUnreadLog,
  takebackPending,
  selectMode,
  selectedCount,
  onToggleSelectMode,
}: TableCornerActionsProps) {
  return (
    <div className="playtest-corner playtest-corner--tr">
      <button
        type="button"
        className="playtest-corner-btn"
        aria-label="Game menu"
        title="Game menu"
        aria-haspopup="dialog"
        aria-expanded={showGameMenu}
        onClick={() => onOpenGameMenu()}
      >
        <Menu width={20} height={20} strokeWidth={1.8} aria-hidden />
        {hasUnreadLog && <span className="playtest-corner__dot" aria-hidden />}
      </button>
      {/* The turn count IS the control: pressing it moves the game on, the
          same thing Space does. A "Next turn" button sitting beside a turn
          counter was two pieces of chrome saying one thing. When it is not
          your turn there is nothing to press, so it degrades to a readout
          that says whose turn it is instead. */}
      {onlineHorde ? (
        onlineHordePhase === 'setup' || onlineHordePhase === 'survivors' ? (
          onlineHorde.team.iAmDone ? (
            <div className="playtest-team-turn">
              <button
                type="button"
                className="playtest-turn-chip playtest-turn-chip--action"
                onClick={advanceTurn}
                aria-label={
                  onlineHorde.team.waitingOn.length > 0
                    ? `Not done. Waiting for ${onlineHorde.team.waitingOn.join(', ')}.`
                    : 'Not done'
                }
              >
                <span className="playtest-turn-chip__label" aria-hidden>
                  {isNarrow ? (
                    <>
                      <span aria-hidden>Waiting</span>
                      <span className="sr-only">
                        {onlineHorde.team.waitingOn.length > 0
                          ? `Waiting for ${onlineHorde.team.waitingOn.join(', ')}`
                          : 'Team done'}
                      </span>
                    </>
                  ) : onlineHorde.team.waitingOn.length > 0 ? (
                    `Waiting for ${onlineHorde.team.waitingOn.join(', ')}`
                  ) : (
                    'Team done'
                  )}
                </span>
                <span className="playtest-turn-chip__value" aria-hidden>
                  ✓
                </span>
              </button>
              {!isNarrow && onlineHorde.team.waitingOn.length > 0 && (
                <Button
                  className="playtest-team-turn__go"
                  onClick={() => onlineHorde.startWithout()}
                >
                  {`Start without ${onlineHorde.team.waitingOn.join(', ')}`}
                </Button>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="playtest-turn-chip playtest-turn-chip--action"
              onClick={advanceTurn}
              aria-label={[
                `Done with team turn ${onlineHorde.team.survivorTurn}`,
                keyFor('pass-turn'),
              ]
                .filter(Boolean)
                .join(', ')}
            >
              {/* A phone's corner holds a number, not the word: "Done" as the
                  big value clipped at the edge on a phone held sideways. The
                  label carries the word there instead, over the team turn. */}
              <span className="playtest-turn-chip__label" aria-hidden>
                {isNarrow ? 'Done' : `Team turn ${onlineHorde.team.survivorTurn}`}
              </span>
              <span className="playtest-turn-chip__value" aria-hidden>
                {isNarrow ? onlineHorde.team.survivorTurn : 'Done'}
              </span>
            </button>
          )
        ) : (
          <div className="playtest-turn-chip" aria-live="polite">
            <span className="playtest-turn-chip__label">
              {isNarrow ? (
                <>
                  <span aria-hidden>Horde</span>
                  <span className="sr-only">The horde&apos;s turn</span>
                </>
              ) : (
                "The horde's turn"
              )}
            </span>
            <span className="playtest-turn-chip__value">{onlineHorde.team.survivorTurn}</span>
          </div>
        )
      ) : canAdvanceTurn ? (
        <button
          type="button"
          className="playtest-turn-chip playtest-turn-chip--action"
          onClick={advanceTurn}
          aria-label={[
            onlineTable ? 'Pass the turn' : 'Next turn',
            `turn ${turn}`,
            keyFor('pass-turn'),
          ]
            .filter(Boolean)
            .join(', ')}
        >
          <span className="playtest-turn-chip__label" aria-hidden>
            Turn
          </span>
          <span className="playtest-turn-chip__value" aria-hidden>
            {turn}
          </span>
          {onlineTable?.turnTimerEnabled && onlineTable.turnStartedAt != null && (
            <TurnTimer startedAt={onlineTable.turnStartedAt} />
          )}
        </button>
      ) : (
        <div className="playtest-turn-chip" aria-live="polite">
          <span className="playtest-turn-chip__label">
            {hordeBlocksTurn ? (
              isNarrow ? (
                // The phone corner is a quarter of the desktop pill's width
                // (playtest.css), and "THE HORDE'S TURN" doesn't fit it and
                // clipped mid-word. Short visible text; the full sentence
                // still reaches the live region via the sr-only span, so an
                // announcement reads the same as before.
                <>
                  <span aria-hidden>Horde</span>
                  <span className="sr-only">The horde&apos;s turn</span>
                </>
              ) : (
                "The horde's turn"
              )
            ) : activeName ? (
              `${activeName}'s turn`
            ) : (
              'Turn'
            )}
          </span>
          <span className="playtest-turn-chip__value">{turn}</span>
          {onlineTable?.turnTimerEnabled && onlineTable.turnStartedAt != null && (
            <TurnTimer startedAt={onlineTable.turnStartedAt} />
          )}
        </div>
      )}
      {onlineTable && !isOnlineHordeTable && (
        <PhaseChip
          phase={onlineTable.phase}
          activeSeat={onlineTable.activeSeat}
          mySeat={onlineTable.mySeat}
          dispatch={onlineTable.dispatch}
        />
      )}
      {/* Both self-gate on an online, seated game (see their own docs). */}
      <ReactionPicker />
      <HoldButton />
      <HoldBanner />
      {/* Take back and Select used to sit here too. Both are in the table
          menu (right-click) and on their own keys, and neither is reached
          often enough to hold a permanent button over the felt — the corner
          keeps the one control you press every turn. A pending takeback is
          the exception: while the table is deciding, it is the only thing
          you want to see. */}
      {takebackPending && (
        <span className="playtest-corner-waiting" aria-live="polite">
          Take back: waiting for the table
        </span>
      )}
      {selectMode && (
        <button
          type="button"
          className="playtest-corner-btn is-active"
          onClick={onToggleSelectMode}
          aria-pressed
          title="Stop selecting"
        >
          Done
          {selectedCount > 0 && <span className="playtest-corner-btn__badge">{selectedCount}</span>}
        </button>
      )}
      <TableSignals />
    </div>
  );
}
