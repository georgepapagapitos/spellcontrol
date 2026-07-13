import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { RESISTANCE_LEVEL_LABEL, type ResistanceLevel } from '../lib/resistance';

interface Props {
  turn: number;
  libraryCount: number;
  /** Fold the secondary actions into an overflow menu below the 1024px
   *  playtest breakpoint (matches `useNarrowViewport`). */
  isNarrow: boolean;
  onDraw(): void;
  onShuffle(): void;
  onMulligan(): void;
  onUntapAll(): void;
  onNextTurn(): void;
  onUndo(): void;
  onReset(): void;
  onScry(): void;
  onCreateToken(): void;
  onOpenStats(): void;
  onOpenLog(): void;
  onOpenDice(): void;
  /** Opens the Resistance difficulty picker sheet. */
  onOpenResistance(): void;
  canUndo: boolean;
  resistanceLevel: ResistanceLevel;
  /** Show a small dot on the Log button — a Resistance event landed since it was last opened. */
  hasUnreadLog: boolean;
}

export function ActionBar({
  turn,
  libraryCount,
  isNarrow,
  onDraw,
  onShuffle,
  onMulligan,
  onUntapAll,
  onNextTurn,
  onUndo,
  onReset,
  onScry,
  onCreateToken,
  onOpenStats,
  onOpenLog,
  onOpenDice,
  onOpenResistance,
  canUndo,
  resistanceLevel,
  hasUnreadLog,
}: Props) {
  // Secondary actions, folded into a shared OverflowMenu on narrow viewports.
  // Resistance's current level is encoded in its label so it's visible at a
  // glance without opening the picker.
  const overflowItems: OverflowMenuItem[] = [
    { label: 'Shuffle', onClick: onShuffle },
    { label: 'Mulligan', onClick: onMulligan },
    { label: 'Scry', onClick: onScry, disabled: libraryCount === 0 },
    { label: 'Create token', onClick: onCreateToken },
    { label: 'Roll dice', onClick: onOpenDice },
    { label: `Resistance: ${RESISTANCE_LEVEL_LABEL[resistanceLevel]}`, onClick: onOpenResistance },
    { label: 'Reset', onClick: onReset, danger: true },
  ];

  return (
    <div className="playtest-actionbar" role="toolbar" aria-label="Playtest actions">
      <span className="playtest-actionbar__turn">Turn {turn}</span>
      <button type="button" onClick={onOpenStats} className="playtest-actionbar__stats">
        Stats
      </button>
      <button
        type="button"
        onClick={onOpenLog}
        className="playtest-actionbar__log"
        aria-label={hasUnreadLog ? 'Log — new opponent events' : 'Log'}
      >
        Log
        {hasUnreadLog && <span className="playtest-actionbar__log-dot" aria-hidden />}
      </button>
      <button type="button" onClick={onDraw} disabled={libraryCount === 0} title="Draw (D)">
        Draw
      </button>
      <button type="button" onClick={onUntapAll} title="Untap all (U)">
        Untap all
      </button>
      <button type="button" onClick={onNextTurn} title="Next turn (N)">
        Next turn
      </button>
      <button type="button" onClick={onUndo} disabled={!canUndo} title="Undo (Z)">
        Undo
      </button>
      {isNarrow ? (
        <OverflowMenu
          items={overflowItems}
          ariaLabel="More playtest actions"
          panelClassName="playtest-zone-menu-popover"
        />
      ) : (
        <>
          <button type="button" onClick={onShuffle}>
            Shuffle
          </button>
          <button type="button" onClick={onMulligan}>
            Mulligan
          </button>
          <button type="button" onClick={onScry} disabled={libraryCount === 0}>
            Scry
          </button>
          <button type="button" onClick={onCreateToken}>
            Create token
          </button>
          <button type="button" onClick={onOpenDice}>
            Roll
          </button>
          <button
            type="button"
            onClick={onOpenResistance}
            aria-haspopup="dialog"
            className={`playtest-actionbar__resistance${resistanceLevel !== 'off' ? ' is-active' : ''}`}
            title="Simulated opponent: occasionally counters, removes, or wipes your plays"
          >
            Resistance
            {resistanceLevel !== 'off' && (
              <span className="playtest-actionbar__resistance-badge">
                {RESISTANCE_LEVEL_LABEL[resistanceLevel]}
              </span>
            )}
          </button>
          <button type="button" onClick={onReset} className="playtest-actionbar__reset">
            Reset
          </button>
        </>
      )}
    </div>
  );
}
