import { ChartLine, Flag, Lock, Minimize2, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { GameAction, GameState } from '@/lib/play/game-state';
import { isClockPaused, makePlayer } from '@/lib/play/game-state';
import { isCustomLayout, layoutName, resolveLayout, turnOrderOf } from '@/lib/play/board-layouts';
import { clockView, formatClock, msToNextSecond } from '@/lib/play/game-clock';
import { gameFormatLabel } from '@/lib/play/game-formats';
import { getFocusable } from '@/lib/overlays/overlay-layer';
import { paletteForSeat } from '@/lib/play/seat-palette';
import { useNow } from '@/lib/util/use-now';
import { useOverlayDismiss } from '@/lib/overlays/use-overlay-dismiss';
import { markBoardGesturesSeen } from '@/lib/play/board-gestures-seen';
import { usePlayStore } from '../../store/play';
import { Button, IconButton } from '@/components/shared/Button';
import { SwitchRow } from '../shared/form';
import { ViewModeToggle } from '../ViewModeToggle';
import { boardGestures, type BoardGestureId } from './BoardGestureHint';
import { GameHistory } from './GameHistory';
import { CustomLayoutEditor, LayoutPicker } from './LayoutEditor';
import { TurnTimes } from './TurnTimes';
import './BoardSheets.css';

/**
 * The hub's destination sheets (board T155). The catch-all game menu and its
 * Now / Game / Setup tabs are gone: every ring key and dock item opens ONE
 * focused sheet, and every sheet is the same shell. Dice lives in
 * DiceSheet.tsx on the same shell.
 */
export type BoardSheetId = 'dice' | 'players' | 'settings' | 'history' | 'help' | 'leave';

// ── The shell ──────────────────────────────────────────────────────────────

/**
 * Grabber, a title with one meta line, a 44px rect close, ONE scroll region,
 * and a footer only when there is something to commit (STYLE_GUIDE § Play
 * board: the hub ring's sheets).
 *
 * Renders in place inside `.game-board-rotator`, so it rotates with a board
 * kept still in landscape, and takes the overlay contract through
 * `useOverlayDismiss`: Escape, the Tab trap, and focus back to whatever had
 * it before (the hub, since a ring key hands focus back to the hub before it
 * opens a sheet). Focus lands on the first control that does something, the
 * `data-autofocus` one if the sheet names it, never on the ✕; a sheet with
 * nothing to act on focuses itself.
 */
export function BoardSheet({
  title,
  meta,
  onClose,
  footer,
  className,
  children,
}: {
  title: string;
  meta?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const metaId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlayDismiss(onClose, panelRef);
  // Runs after the trap's own effect (same component, declared later), so
  // the trap has already recorded the hub as the place focus returns to.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const named = panel.querySelector<HTMLElement>('[data-autofocus]');
    const content = [
      panel.querySelector('.board-sheet-body'),
      panel.querySelector('.board-sheet-foot'),
    ]
      .filter((el): el is HTMLElement => el instanceof HTMLElement)
      .flatMap((el) => getFocusable(el));
    // Nothing to act on (an empty History): the dialog itself, so its title
    // is read and Tab's next stop is the ✕.
    (named ?? content[0] ?? panel).focus({ preventScroll: true });
  }, []);

  return (
    <div
      className="board-sheet-backdrop"
      role="presentation"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`board-sheet${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={meta ? metaId : undefined}
        tabIndex={-1}
      >
        <span className="board-sheet-grabber" aria-hidden="true" />
        <header className="board-sheet-head">
          <div className="board-sheet-title">
            <h2 id={titleId} className="board-sheet-title-main">
              {title}
            </h2>
            {meta && (
              <p id={metaId} className="board-sheet-meta">
                {meta}
              </p>
            )}
          </div>
          <IconButton
            className="board-sheet-close"
            label="Close"
            icon={<X width={20} height={20} strokeWidth={1.8} />}
            onClick={onClose}
          />
        </header>
        <div className="board-sheet-body">{children}</div>
        {footer && <footer className="board-sheet-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/** A titled block inside a sheet: the kit's one uppercase role. */
export function SheetSection({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section
      className={`board-sheet-section${className ? ` ${className}` : ''}`}
      aria-labelledby={id}
    >
      <h3 id={id} className="form-section-heading">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** "Commander · 40 life · Commander damage · Poison": the rules this table
 *  plays by, stated once where they matter. */
function rulesLine(game: GameState): string {
  return [
    gameFormatLabel(game.format),
    `${game.startingLife} life`,
    game.commanderDamageEnabled ? 'Commander damage' : null,
    game.poisonEnabled ? 'Poison' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// ── Players ────────────────────────────────────────────────────────────────

const MAX_PLAYERS = 10;
const MIN_PLAYERS = 2;

/** Seats and layout. Picking a layout applies at once, so there is no
 *  primary and no footer. */
export function PlayersSheet({
  game,
  dispatch,
  onClose,
  onRestart,
}: {
  game: GameState;
  dispatch: (a: GameAction) => void;
  onClose: () => void;
  /** The lock note's fix: the board's own Restart confirm. */
  onRestart: () => void;
}) {
  const preferredLayouts = usePlayStore((s) => s.preferredLayouts);
  const setPreferredLayout = usePlayStore((s) => s.setPreferredLayout);
  const [editorOpen, setEditorOpen] = useState(false);
  const count = game.players.length;
  const turnOrder = turnOrderOf(game);
  const currentId = resolveLayout(count, game.layout, turnOrder).id;
  const layoutLabel = isCustomLayout(currentId) ? 'Custom' : layoutName(currentId);
  const isDefault = preferredLayouts[count] === currentId;

  return (
    <>
      <BoardSheet
        title="Players"
        meta={`${count} players · ${layoutLabel} layout`}
        onClose={onClose}
      >
        <SheetSection title="Seats">
          <PlayerRoster game={game} dispatch={dispatch} onRestart={onRestart} />
        </SheetSection>
        <SheetSection title="Layout">
          <LayoutPicker
            total={count}
            current={currentId}
            turnOrder={turnOrder}
            shared={game.mode === 'local'}
            onPick={(layout) => dispatch({ type: 'settings', patch: { layout } })}
            onCustomize={() => setEditorOpen(true)}
          />
          {game.mode === 'local' && (
            <SwitchRow
              label={`Default for ${count}-player games`}
              checked={isDefault}
              onChange={(next) => setPreferredLayout(count, next ? currentId : null)}
            />
          )}
        </SheetSection>
      </BoardSheet>
      {editorOpen && (
        <CustomLayoutEditor
          game={game}
          onApply={(layout) => {
            dispatch({ type: 'settings', patch: { layout } });
            setEditorOpen(false);
          }}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </>
  );
}

function PlayerRoster({
  game,
  dispatch,
  onRestart,
}: {
  game: GameState;
  dispatch: (a: GameAction) => void;
  onRestart: () => void;
}) {
  const players = game.players;
  // The roster locks once the game has actually been played: any life
  // change, poison, commander damage or elimination. Until then it is still
  // setup, and seats can come and go.
  const locked = players.some(
    (p) =>
      p.life !== game.startingLife ||
      p.poison > 0 ||
      p.eliminated ||
      Object.keys(p.commanderDamage).length > 0
  );
  const atMin = players.length <= MIN_PLAYERS;
  const canAdd = game.mode === 'local' && !locked && players.length < MAX_PLAYERS;

  const addPlayer = () => {
    const usedSeats = new Set(players.map((p) => p.seat));
    let nextSeat = 0;
    while (usedSeats.has(nextSeat)) nextSeat += 1;
    const player = makePlayer({
      id: `local_${nextSeat}_${Date.now()}`,
      userId: null,
      seat: nextSeat,
      name: `Player ${nextSeat + 1}`,
      startingLife: game.startingLife,
    });
    dispatch({ type: 'add-player', player });
  };

  return (
    <>
      <ul className="board-roster" aria-label="Seats">
        {players.map((p) => (
          <li key={p.id} className="board-roster-row">
            <span
              className="board-roster-dot"
              style={{ background: paletteForSeat(game.id, p.seat).base }}
              aria-hidden="true"
            />
            <span className="board-roster-name">{p.name}</span>
            {!locked && (
              <IconButton
                className="board-roster-remove"
                label={`Remove ${p.name}`}
                icon={<X width={18} height={18} strokeWidth={2} />}
                disabled={atMin}
                onClick={() => dispatch({ type: 'remove-player', seat: p.seat })}
              />
            )}
          </li>
        ))}
      </ul>
      {locked ? (
        <div className="board-sheet-note">
          <Lock width={18} height={18} strokeWidth={2} aria-hidden />
          <p>
            Seats lock once the game starts.{' '}
            <Button variant="link" className="board-sheet-note-fix" onClick={onRestart}>
              Restart…
            </Button>
          </p>
        </div>
      ) : (
        <>
          {atMin && <p className="board-sheet-hint">A game needs at least 2 players.</p>}
          {players.length >= MAX_PLAYERS && (
            <p className="board-sheet-hint">A table seats up to 10 players.</p>
          )}
          {canAdd && (
            <Button
              className="board-roster-add"
              icon={<Plus width={18} height={18} strokeWidth={2} />}
              onClick={addPlayer}
            >
              Add player
            </Button>
          )}
        </>
      )}
    </>
  );
}

// ── Settings ───────────────────────────────────────────────────────────────

/**
 * Everything from the old Setup tab that isn't players or layout, grouped by
 * what it is about, plus Full screen as a switch (it is a state, so a row
 * that reads On / Off says more than a button that flips its own label).
 * Changes land as you make them: no Save, no primary (§ Table settings).
 */
export function SettingsSheet({
  game,
  dispatch,
  onClose,
  fullscreenSupported,
  isFullscreen,
  onToggleFullscreen,
}: {
  game: GameState;
  dispatch: (a: GameAction) => void;
  onClose: () => void;
  /** The board's own `useFullscreen()` instance, threaded through rather
   *  than a second hook call here: GameBoard's `exitOnUnmount` ownership
   *  tracking only works as a single source of truth. */
  fullscreenSupported: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const hapticsEnabled = usePlayStore((s) => s.hapticsEnabled);
  const setHaptics = usePlayStore((s) => s.setHaptics);
  const gameTimerEnabled = usePlayStore((s) => s.gameTimerEnabled);
  const setGameTimerEnabled = usePlayStore((s) => s.setGameTimerEnabled);
  const turnTrackerEnabled = usePlayStore((s) => s.turnTrackerEnabled);
  const setTurnTrackerEnabled = usePlayStore((s) => s.setTurnTrackerEnabled);
  const lowLifeWarningEnabled = usePlayStore((s) => s.lowLifeWarningEnabled);
  const setLowLifeWarningEnabled = usePlayStore((s) => s.setLowLifeWarningEnabled);
  const underlineSixNine = usePlayStore((s) => s.underlineSixNine);
  const setUnderlineSixNine = usePlayStore((s) => s.setUnderlineSixNine);
  const minimalistMode = usePlayStore((s) => s.minimalistMode);
  const setMinimalistMode = usePlayStore((s) => s.setMinimalistMode);
  // Tap zones belong to a game being played; a finished table has none.
  const live = game.status !== 'finished';

  return (
    <BoardSheet title="Settings" meta="Changes apply as you make them" onClose={onClose}>
      {live && (
        <SheetSection title="Taps">
          <ViewModeToggle
            className="tap-orientation-toggle"
            ariaLabel="Tap zone orientation"
            value={game.tapOrientation ?? 'horizontal'}
            onChange={(next) => dispatch({ type: 'settings', patch: { tapOrientation: next } })}
            options={[
              {
                value: 'horizontal',
                label: 'Horizontal taps',
                icon: (
                  <>
                    <TapZoneIcon orientation="horizontal" />
                    <span>Horizontal taps</span>
                  </>
                ),
              },
              {
                value: 'vertical',
                label: 'Vertical taps',
                icon: (
                  <>
                    <TapZoneIcon orientation="vertical" />
                    <span>Vertical taps</span>
                  </>
                ),
              },
            ]}
          />
        </SheetSection>
      )}
      <SheetSection title="Clock strip">
        <div>
          <SwitchRow label="Game timer" checked={gameTimerEnabled} onChange={setGameTimerEnabled} />
          <SwitchRow
            label="Turn tracker"
            hint="Marks the active seat and who's next."
            checked={turnTrackerEnabled}
            onChange={setTurnTrackerEnabled}
          />
        </div>
      </SheetSection>
      <SheetSection title="Seats">
        <div>
          <SwitchRow
            label="Low life warning"
            hint="Pulses a seat's panel from 1 to 9 life."
            checked={lowLifeWarningEnabled}
            onChange={setLowLifeWarningEnabled}
          />
          <SwitchRow
            label="Underlined 6 and 9"
            hint="Keeps 6 and 9 readable upside down."
            checked={underlineSixNine}
            onChange={setUnderlineSixNine}
          />
          <SwitchRow
            label="Minimalist mode"
            hint="Hides the plus and minus buttons. The tap zones still work."
            checked={minimalistMode}
            onChange={setMinimalistMode}
          />
        </div>
      </SheetSection>
      <SheetSection title="This device">
        <div>
          {/* Hidden where the browser can't do it (iOS Safari, a mouse
              pointer): a switch that silently fails is worse than none. */}
          {fullscreenSupported && (
            <SwitchRow label="Full screen" checked={isFullscreen} onChange={onToggleFullscreen} />
          )}
          <SwitchRow label="Haptic feedback" checked={hapticsEnabled} onChange={setHaptics} />
        </div>
      </SheetSection>
    </BoardSheet>
  );
}

/** Small two-cell rectangle hinting at the split direction; tracks the
 *  toggle's currentColor. */
function TapZoneIcon({ orientation }: { orientation: 'horizontal' | 'vertical' }) {
  if (orientation === 'horizontal') {
    return (
      <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="7" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
        <rect x="10" y="1" width="7" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  return (
    <svg width="14" height="18" viewBox="0 0 14 18" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="12" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <rect x="1" y="10" width="12" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

// ── History ────────────────────────────────────────────────────────────────

/** Event kinds that set a table up rather than say anything happened. */
const SETUP_KINDS = new Set(['start', 'reset', 'settings', 'join', 'leave']);

/**
 * The old Game tab as its own sheet: time on turn, this game's stats, life
 * over time, and the log. The rules become the meta line. Before anything
 * has happened it is one two-part empty state, not four empty sections.
 */
export function HistorySheet({ game, onClose }: { game: GameState; onClose: () => void }) {
  const nothingYet = game.events.every((e) => e.undone || e.undo || SETUP_KINDS.has(e.kind));
  return (
    <BoardSheet title="History" meta={rulesLine(game)} onClose={onClose}>
      {nothingYet ? (
        <div className="board-sheet-empty">
          <ChartLine width={40} height={40} strokeWidth={1.6} aria-hidden />
          <p className="board-sheet-empty-title">Nothing to show yet.</p>
        </div>
      ) : (
        <>
          <TurnTimes game={game} />
          <GameHistory game={game} />
        </>
      )}
    </BoardSheet>
  );
}

// ── Help ───────────────────────────────────────────────────────────────────

/**
 * How the board works, on demand: the first-run card's rows (one list,
 * `boardGestures`), each with a small seat diagram so the row reads before
 * its words do. The diagrams are decoration; the words carry the meaning.
 */
export function HelpSheet({
  vertical,
  showTurnTracker,
  onClose,
}: {
  vertical: boolean;
  showTurnTracker: boolean;
  onClose: () => void;
}) {
  const close = () => {
    markBoardGesturesSeen();
    onClose();
  };
  return (
    <BoardSheet
      title="How the board works"
      onClose={close}
      footer={
        <Button variant="primary" onClick={close} data-autofocus>
          Got it
        </Button>
      }
    >
      <ul className="board-help-list">
        {boardGestures(vertical, showTurnTracker).map((g) => (
          <li key={g.id} className="board-help-row">
            <GestureDiagram kind={g.id} vertical={vertical} />
            <span>
              <strong>{g.lead}</strong> {g.rest}
            </span>
          </li>
        ))}
      </ul>
    </BoardSheet>
  );
}

function GestureDiagram({ kind, vertical }: { kind: BoardGestureId; vertical: boolean }) {
  const seat = <rect className="gd-seat" x="2" y="3" width="36" height="24" rx="4" />;
  const arrow = (d: string) => <path className="gd-arrow" d={d} />;
  const edge = <line className="gd-edge" x1="8" y1="27" x2="32" y2="27" />;
  const body: Record<BoardGestureId, ReactNode> = {
    tap: vertical ? (
      <>
        {seat}
        <line className="gd-split" x1="4" y1="15" x2="36" y2="15" />
        <circle className="gd-dot" cx="20" cy="9" r="4.5" />
      </>
    ) : (
      <>
        {seat}
        <line className="gd-split" x1="20" y1="5" x2="20" y2="25" />
        <circle className="gd-dot" cx="29" cy="15" r="5" />
      </>
    ),
    hold: (
      <>
        {seat}
        <circle className="gd-dot" cx="20" cy="15" r="4.5" />
        <circle className="gd-halo" cx="20" cy="15" r="8.5" />
      </>
    ),
    number: (
      <>
        {seat}
        <text className="gd-num" x="20" y="20" textAnchor="middle">
          40
        </text>
        <circle className="gd-dot" cx="27" cy="21" r="3" />
      </>
    ),
    toward: (
      <>
        {seat}
        {arrow('M20 7v13M15 16l5 5 5-5')}
        {edge}
      </>
    ),
    away: (
      <>
        {seat}
        {arrow('M20 22V9M15 13l5-5 5 5')}
        {edge}
      </>
    ),
    pass: (
      <>
        <rect className="gd-seat" x="2" y="9" width="36" height="12" rx="3" />
        {arrow('M24 12l4 3-4 3')}
      </>
    ),
  };
  return (
    <svg
      className="board-help-diagram"
      width="40"
      height="30"
      viewBox="0 0 40 30"
      aria-hidden="true"
    >
      {body[kind]}
    </svg>
  );
}

// ── Leave ──────────────────────────────────────────────────────────────────

/**
 * The ways off the board, ranked: End game… is the one primary (the way a
 * game is meant to end, and the ellipsis says the winner picker follows),
 * Minimize is secondary, and Discard sits in the danger tier below a divider
 * and still confirms (PlayPage's discard dialog).
 */
export function LeaveSheet({
  game,
  onClose,
  onEnd,
  onMinimize,
  onDiscard,
}: {
  game: GameState;
  onClose: () => void;
  onEnd?: () => void;
  onMinimize?: () => void;
  onDiscard?: () => void;
}) {
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  // The elapsed game time in the meta line keeps ticking while the sheet is
  // open, and freezes with a paused clock.
  const clockRunning = game.status === 'active' && !isClockPaused(game);
  const now = useNow(clockRunning, (t) => msToNextSecond(clockView(game, t).total ?? 0));
  const elapsed = clockView(game, now).total;
  const meta = [gameFormatLabel(game.format), elapsed != null ? formatClock(elapsed) : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <BoardSheet title="Leave the board" meta={meta} onClose={onClose}>
      {onEnd && (
        <div className="board-leave-item">
          <Button
            variant="primary"
            className="board-leave-btn"
            icon={<Flag width={18} height={18} strokeWidth={2} />}
            onClick={run(onEnd)}
          >
            End game…
          </Button>
          <p className="board-sheet-hint">Saves it to History.</p>
        </div>
      )}
      {onMinimize && (
        <div className="board-leave-item">
          <Button
            className="board-leave-btn"
            icon={<Minimize2 width={18} height={18} strokeWidth={2} />}
            onClick={run(onMinimize)}
          >
            Minimize
          </Button>
          <p className="board-sheet-hint">The game waits on the Play tab.</p>
        </div>
      )}
      {onDiscard && (
        <>
          <hr className="board-sheet-divider" />
          <div className="board-leave-item">
            <Button
              variant="danger"
              className="board-leave-btn"
              icon={<Trash2 width={18} height={18} strokeWidth={2} />}
              onClick={run(onDiscard)}
            >
              Discard game
            </Button>
            <p className="board-sheet-hint">Removes it without saving to History.</p>
          </div>
        </>
      )}
    </BoardSheet>
  );
}
