import { Lock, Settings } from 'lucide-react';
import type { Designation } from '@/lib/playtest';
import type { GameAction, GamePhase } from '@/lib/game-state';
import { PhaseChip } from '@/components/play/PhaseChip';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { useNarrowViewport } from '../hooks/use-narrow-viewport';

/**
 * Below this viewport width the full bar no longer fits on one row and Reset
 * (margin-left: auto) wrapped alone onto a second line. Measured 2026-09-08:
 * 1321px natural, ~1750px worst case with every badge lit (designations,
 * resistance, select count, takeback) plus the online Hold button. So the
 * secondary actions fold into the overflow menu here exactly as they do in
 * the ≤1024 narrow tier — one bar shape per width, never a ragged wrap.
 */
const FULL_BAR_MIN_WIDTH = 1800;
import { RESISTANCE_LEVEL_LABEL, type ResistanceLevel } from '../lib/resistance';
import { TAKEBACK_MODE_LABEL, type TakebackMode } from '../lib/takeback';
import type { RewindVerdict } from '@/lib/playtest/rewind';
import { ReactionPicker } from './ReactionPicker';
import { HoldButton } from './HoldButton';
import { HoldBanner } from './HoldBanner';
import { TableSignals } from './TableSignals';

export interface TakebackBarProps {
  stepsAvailable: number;
  verdict: RewindVerdict | 'none';
  mode: TakebackMode;
  boundaryReason: string | null;
  /** A live outgoing request from THIS seat, in any status — badges the
   *  button so it stays glanceable even if the pending banner is missed. */
  isPending: boolean;
  /** Primary action — apply immediately, raise a request, or (when there's
   *  nothing to do) surface why via the caller's own feedback. */
  onClick(): void;
  onOpenSettings(): void;
}

/** The bar's online-table controls — phase clock + pass turn — present only
 *  while seated at an online game. `dispatch` is raw (for `PhaseChip`, which
 *  gates its own actions); `onPassTurn` is pre-wired by the parent (dispatch
 *  + haptics), matching every other no-arg action prop on this bar. */
export interface OnlineBarProps {
  phase: GamePhase | undefined;
  activeSeat: number | null;
  mySeat: number;
  /** Display name of the seat currently on turn, for the non-interactive
   *  "{Name}'s turn" chip shown to everyone but the active seat. */
  activeName: string | undefined;
  dispatch(action: GameAction): void;
  onPassTurn(): void;
}

const DESIGNATION_SHORT_LABEL: Record<Designation, string> = {
  monarch: 'Monarch',
  initiative: 'Initiative',
  citysBlessing: "City's Blessing",
};

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
  onReset(): void;
  /** Takeback control — replaces the old unconditional Undo button (see
   *  hooks/use-takeback.ts). */
  takeback: TakebackBarProps;
  /** Opens the scry/surveil/mill sheet for the top of the library. */
  onScry(): void;
  onCreateToken(): void;
  onOpenStats(): void;
  onOpenLog(): void;
  onOpenDice(): void;
  /** Opens the Resistance difficulty picker sheet. */
  onOpenResistance(): void;
  /** Opens the Designations (Monarch/Initiative/City's Blessing) sheet. */
  onOpenDesignations(): void;
  /** Select mode turns a plain tap on a battlefield card into a selection
   *  toggle — the only way to build a multi-card selection without the
   *  modifier keys a phone doesn't have. */
  selectMode: boolean;
  onToggleSelectMode(): void;
  /** How many cards are selected right now (badges the Select button). */
  selectionSize: number;
  resistanceLevel: ResistanceLevel;
  monarch: boolean;
  initiative: boolean;
  citysBlessing: boolean;
  /** Show a small dot on the Log button — a Resistance event landed since it was last opened. */
  hasUnreadLog: boolean;
  /** B6-04: folds `.playtest-page__header`'s back-navigation into this row,
   *  shown only in the short-landscape tier (CSS-gated) — see PlaytestBoard
   *  Props doc. Both optional so every other tier's markup is unaffected. */
  backLabel?: string;
  onBack?(): void;
  /** Set while seated at an online table — adds the phase clock + pass-turn
   *  controls and demotes local "Next turn" to a secondary action. Absent
   *  (or null) for solo play, where none of that applies. */
  online?: OnlineBarProps | null;
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
  onReset,
  takeback,
  onScry,
  onCreateToken,
  onOpenStats,
  onOpenLog,
  onOpenDice,
  onOpenResistance,
  onOpenDesignations,
  selectMode,
  onToggleSelectMode,
  selectionSize,
  resistanceLevel,
  monarch,
  initiative,
  citysBlessing,
  hasUnreadLog,
  backLabel,
  onBack,
  online,
}: Props) {
  // Designations held right now, short-labeled, for the button/menu badge —
  // mirrors how Resistance's own current level is always visible at a glance.
  const heldDesignations = [
    monarch && DESIGNATION_SHORT_LABEL.monarch,
    initiative && DESIGNATION_SHORT_LABEL.initiative,
    citysBlessing && DESIGNATION_SHORT_LABEL.citysBlessing,
  ].filter((label): label is string => Boolean(label));
  const anyDesignationHeld = heldDesignations.length > 0;

  // Takeback button copy — the "before they reach for it" info this whole
  // control exists for. Badge is glanceable (a count, a lock, or "Off");
  // `title` adds the reason on desktop hover. `locked` is deliberately NOT
  // `disabled` — tapping it still gives an answer (via the caller's
  // onClick, e.g. a toast naming the wall) instead of a dead control, per
  // the "locked must never present as a failure" rule.
  const takebackTitle =
    takeback.mode === 'off'
      ? 'Takebacks are off for this game.'
      : takeback.verdict === 'locked'
        ? (takeback.boundaryReason ?? undefined)
        : takeback.verdict === 'none'
          ? 'Nothing to take back yet.'
          : `Take back (${takeback.stepsAvailable} available) (Z)`;
  const takebackBadge =
    takeback.mode === 'off' ? (
      <span className="playtest-actionbar__takeback-badge">Off</span>
    ) : takeback.verdict === 'locked' ? (
      <Lock className="playtest-actionbar__takeback-lock" aria-hidden width={12} height={12} />
    ) : takeback.stepsAvailable > 0 ? (
      <span className="playtest-actionbar__takeback-badge">{takeback.stepsAvailable}</span>
    ) : null;

  // Secondary actions, folded into a shared OverflowMenu on narrow viewports.
  // Resistance's current level (and any held designation) is encoded in its
  // label so it's visible at a glance without opening the picker.
  // Select is deliberately absent here (B6-14) — its own standing button
  // (below) is never hidden by `isNarrow`, so listing it here too would
  // duplicate the identical toggle in both places.
  const foldSecondary = useNarrowViewport(FULL_BAR_MIN_WIDTH - 1) || isNarrow;
  const overflowItems: OverflowMenuItem[] = [
    { label: 'Shuffle', onClick: onShuffle },
    { label: 'Mulligan', onClick: onMulligan },
    { label: 'Roll dice', onClick: onOpenDice },
    {
      label: anyDesignationHeld ? `Designations: ${heldDesignations.join(', ')}` : 'Designations',
      onClick: onOpenDesignations,
    },
    { label: `Resistance: ${RESISTANCE_LEVEL_LABEL[resistanceLevel]}`, onClick: onOpenResistance },
    {
      label: `Takeback rule: ${TAKEBACK_MODE_LABEL[takeback.mode]}`,
      onClick: takeback.onOpenSettings,
    },
    { label: 'Reset', onClick: onReset, danger: true },
  ];

  return (
    <div className="playtest-actionbar" role="toolbar" aria-label="Playtest actions">
      {onBack && (
        <button type="button" className="playtest-actionbar__back" onClick={onBack}>
          ← {backLabel}
        </button>
      )}
      <span className="playtest-actionbar__turn">Turn {turn}</span>
      {online && (
        <>
          <PhaseChip
            phase={online.phase}
            activeSeat={online.activeSeat}
            mySeat={online.mySeat}
            dispatch={online.dispatch}
          />
          {online.activeSeat === online.mySeat || online.activeSeat === null ? (
            <button
              type="button"
              className="playtest-actionbar__pass-turn playtest-actionbar__primary"
              onClick={online.onPassTurn}
            >
              Pass turn
            </button>
          ) : (
            <span className="playtest-actionbar__pass-turn-waiting" aria-live="polite">
              {online.activeName ? `${online.activeName}'s turn` : 'Not your turn'}
            </span>
          )}
        </>
      )}
      <button type="button" onClick={onOpenStats} className="playtest-actionbar__stats">
        Stats
      </button>
      <button
        type="button"
        onClick={onOpenLog}
        className="playtest-actionbar__log"
        aria-label={hasUnreadLog ? 'Log: new opponent events' : 'Log'}
      >
        Log
        {hasUnreadLog && <span className="playtest-actionbar__log-dot" aria-hidden />}
      </button>
      <button
        type="button"
        onClick={onDraw}
        disabled={libraryCount === 0}
        title="Draw (D)"
        className="playtest-actionbar__primary"
      >
        Draw
      </button>
      <button type="button" onClick={onUntapAll} title="Untap all (U)">
        Untap all
      </button>
      <button
        type="button"
        onClick={onNextTurn}
        title={online ? 'Untap all and draw for your new turn' : 'Next turn (N)'}
        className={online ? undefined : 'playtest-actionbar__primary'}
      >
        Next turn
      </button>
      <button
        type="button"
        onClick={onScry}
        disabled={libraryCount === 0}
        title="Scry, surveil or mill"
      >
        Top cards
      </button>
      <button type="button" onClick={onCreateToken}>
        Create token
      </button>
      <button
        type="button"
        onClick={takeback.onClick}
        className={`playtest-actionbar__takeback${takeback.isPending ? ' is-pending' : ''}`}
        aria-label={takeback.isPending ? 'Take back: waiting for approval' : undefined}
        title={takebackTitle}
      >
        Take back
        {takebackBadge}
        {takeback.isPending && <span className="playtest-actionbar__takeback-dot" aria-hidden />}
      </button>
      <button
        type="button"
        onClick={onToggleSelectMode}
        aria-pressed={selectMode}
        className={`playtest-actionbar__select${selectMode ? ' is-active' : ''}`}
        title="Select several cards to act on together"
      >
        {selectMode ? 'Done' : 'Select'}
        {selectMode && selectionSize > 0 && (
          <span className="playtest-actionbar__select-badge">{selectionSize}</span>
        )}
      </button>
      <ReactionPicker />
      <HoldButton />
      <HoldBanner />
      {foldSecondary ? (
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
          <button type="button" onClick={onOpenDice}>
            Roll dice
          </button>
          <button
            type="button"
            onClick={onOpenDesignations}
            aria-haspopup="dialog"
            className={`playtest-actionbar__designations${anyDesignationHeld ? ' is-active' : ''}`}
            title="Track Monarch, Initiative, and City's Blessing"
          >
            Designations
            {anyDesignationHeld && (
              <span className="playtest-actionbar__designations-badge">
                {heldDesignations.join(', ')}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={onOpenResistance}
            aria-haspopup="dialog"
            className={`playtest-actionbar__resistance${resistanceLevel !== 'off' ? ' is-active' : ''}`}
            title="Simulated opponent that disrupts your plays"
          >
            Resistance
            {resistanceLevel !== 'off' && (
              <span className="playtest-actionbar__resistance-badge">
                {RESISTANCE_LEVEL_LABEL[resistanceLevel]}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={takeback.onOpenSettings}
            aria-haspopup="dialog"
            className="playtest-actionbar__takeback-settings"
            title="Takeback approval settings"
          >
            <Settings aria-hidden width={13} height={13} />
            Takeback: {TAKEBACK_MODE_LABEL[takeback.mode]}
          </button>
          <button type="button" onClick={onReset} className="playtest-actionbar__reset">
            Reset
          </button>
        </>
      )}
      <TableSignals />
    </div>
  );
}
