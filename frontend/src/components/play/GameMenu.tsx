import { BookOpen } from 'lucide-react';
import { useState } from 'react';
import type { GameAction, GameState } from '../../lib/game-state';
import { makePlayer } from '../../lib/game-state';
import { resolveLayout } from '../../lib/board-layouts';
import { usePlayStore } from '../../store/play';
import { useRulesReferenceStore } from '../../store/rules-reference';
import { GameHistory } from './GameHistory';
import { GameTools } from './GameTools';
import { ViewModeToggle } from '../ViewModeToggle';
import { Tabs } from '../Tabs';
import { CustomLayoutEditor, LayoutPicker } from './LayoutEditor';

// ── Center game menu (actions / log + stats / board setup) ─────────────────

type MenuTab = 'now' | 'game' | 'setup';

export function GameMenu({
  game,
  canControlAll,
  dispatch,
  onClose,
  onMinimize,
  onLeave,
  onEnd,
  onRematch,
  onUndo,
  undoLabel,
  onShare,
}: {
  game: GameState;
  canControlAll: boolean;
  dispatch: (a: GameAction) => void;
  onClose: () => void;
  onMinimize?: () => void;
  onLeave?: () => void;
  onEnd?: () => void;
  onRematch?: () => void;
  onUndo: () => void;
  undoLabel: string | null;
  /** Opens the ShareDialog for this (finished, online) game's recap. */
  onShare: () => void;
}) {
  const isFinished = game.status === 'finished';
  const hapticsEnabled = usePlayStore((s) => s.hapticsEnabled);
  const setHaptics = usePlayStore((s) => s.setHaptics);
  const preferredLayouts = usePlayStore((s) => s.preferredLayouts);
  const setPreferredLayout = usePlayStore((s) => s.setPreferredLayout);
  const openRules = useRulesReferenceStore((s) => s.open);
  const [editorOpen, setEditorOpen] = useState(false);
  const [tab, setTab] = useState<MenuTab>('now');
  // Setup is host-only and meaningless once the game is over — dropping the
  // tab beats showing an empty one.
  const canSetup = canControlAll && !isFinished;
  const activeTab: MenuTab = tab === 'setup' && !canSetup ? 'now' : tab;

  return (
    <div className="game-menu-backdrop" onClick={onClose}>
      <div className="game-menu" role="dialog" onClick={(e) => e.stopPropagation()}>
        <span className="game-menu-grabber" aria-hidden="true" />
        <header className="game-menu-head">
          <div className="game-menu-title">
            <span className="game-menu-title-main">
              {game.mode === 'online' ? `Game ${game.code}` : 'Local game'}
            </span>
            <span className="game-menu-title-sub">{game.format}</span>
          </div>
          <button type="button" className="game-menu-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        {/* Split by when you reach for it: `now` is the mid-game surface,
            `game` is the log + derived stats, `setup` is set-and-forget board
            config. Only the active tab mounts, which is also what makes
            opening the menu instant — the log walk, the life chart replay and
            every layout preview used to run just because the sheet opened. */}
        <Tabs<MenuTab>
          ariaLabel="Game menu section"
          variant="fitted"
          className="game-menu-tabs"
          value={activeTab}
          onChange={setTab}
          tabs={[
            { id: 'now', label: 'Now', controls: 'game-menu-panel' },
            { id: 'game', label: 'Game', controls: 'game-menu-panel' },
            ...(canSetup
              ? [{ id: 'setup' as const, label: 'Setup', controls: 'game-menu-panel' }]
              : []),
          ]}
        />

        <div
          className="game-menu-body"
          id="game-menu-panel"
          role="tabpanel"
          aria-labelledby={`sc-tab-${activeTab}`}
        >
          {activeTab === 'now' && (
            <>
              {/* ── Primary actions — immediately visible without scrolling ── */}
              <section className="game-menu-section">
                <div className="game-menu-actions">
                  {isFinished ? (
                    <>
                      {onRematch && (
                        <button
                          type="button"
                          className="game-menu-btn is-primary is-wide"
                          onClick={() => {
                            onRematch();
                            onClose();
                          }}
                        >
                          Rematch — same players
                        </button>
                      )}
                      {game.mode === 'online' && (
                        <button
                          type="button"
                          className="game-menu-btn is-wide"
                          onClick={() => onShare()}
                        >
                          Share recap
                        </button>
                      )}
                      {onLeave && (
                        <button
                          type="button"
                          className="game-menu-btn is-wide"
                          onClick={() => {
                            onLeave();
                            onClose();
                          }}
                        >
                          Close
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      {onMinimize && (
                        <button
                          type="button"
                          className="game-menu-btn is-primary is-wide"
                          onClick={() => {
                            onMinimize();
                            onClose();
                          }}
                        >
                          Minimize
                        </button>
                      )}
                      {undoLabel && (
                        <button
                          type="button"
                          className="game-menu-btn is-wide"
                          onClick={() => {
                            onUndo();
                            onClose();
                          }}
                        >
                          ↶ Undo {undoLabel}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </section>

              <GameTools game={game} dispatch={dispatch} />

              <section className="game-menu-section">
                <button
                  type="button"
                  className="game-menu-btn is-wide"
                  onClick={() => {
                    openRules();
                    onClose();
                  }}
                >
                  <BookOpen width={16} height={16} strokeWidth={1.8} aria-hidden /> Rules reference
                </button>
              </section>

              {/* ── Destructive actions — anchored at the bottom ── */}
              {!isFinished && (
                <section className="game-menu-section">
                  <div className="game-menu-actions">
                    <div className="game-menu-actions-row">
                      <button
                        type="button"
                        className="game-menu-btn"
                        onClick={() => {
                          onEnd?.();
                          onClose();
                        }}
                      >
                        End game
                      </button>
                      {canControlAll && (
                        <button
                          type="button"
                          className="game-menu-btn"
                          onClick={() => {
                            dispatch({ type: 'reset' });
                            onClose();
                          }}
                        >
                          Reset
                        </button>
                      )}
                    </div>
                    {onLeave && (
                      <button
                        type="button"
                        className="game-menu-btn is-danger is-wide"
                        onClick={() => {
                          onLeave();
                          onClose();
                        }}
                      >
                        Discard game
                      </button>
                    )}
                  </div>
                </section>
              )}
            </>
          )}

          {activeTab === 'game' && (
            <>
              <div className="game-menu-meta" aria-label="Game settings">
                <span className="game-menu-chip">{game.startingLife} starting life</span>
                {game.commanderDamageEnabled && (
                  <span className="game-menu-chip">Commander damage</span>
                )}
                {game.poisonEnabled && <span className="game-menu-chip">Poison</span>}
                <span className="game-menu-chip is-mode">{game.mode}</span>
              </div>
              <GameHistory game={game} />
            </>
          )}

          {activeTab === 'setup' && (
            <>
              <section className="game-menu-section">
                <ViewModeToggle
                  className="tap-orientation-toggle"
                  ariaLabel="Tap zone orientation"
                  value={game.tapOrientation ?? 'horizontal'}
                  onChange={(next) =>
                    dispatch({ type: 'settings', patch: { tapOrientation: next } })
                  }
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
                <button
                  type="button"
                  role="switch"
                  aria-checked={hapticsEnabled}
                  className={`game-menu-setting ${hapticsEnabled ? 'is-on' : ''}`}
                  onClick={() => setHaptics(!hapticsEnabled)}
                >
                  <span className="game-menu-setting-label">Haptic feedback</span>
                  <span className="game-menu-setting-state" aria-hidden="true">
                    {hapticsEnabled ? 'On' : 'Off'}
                  </span>
                </button>
              </section>

              <section className="game-menu-section">
                <PlayerRoster game={game} dispatch={dispatch} />
              </section>

              <section className="game-menu-section">
                <LayoutPicker
                  total={game.players.length}
                  current={resolveLayout(game.players.length, game.layout).id}
                  shared={game.mode === 'local'}
                  onPick={(layout) => dispatch({ type: 'settings', patch: { layout } })}
                  onCustomize={() => setEditorOpen(true)}
                />
                {game.mode === 'local' &&
                  (() => {
                    const count = game.players.length;
                    const currentId = resolveLayout(count, game.layout).id;
                    const isDefault = preferredLayouts[count] === currentId;
                    return (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isDefault}
                        className={`game-menu-setting ${isDefault ? 'is-on' : ''}`}
                        onClick={() => setPreferredLayout(count, isDefault ? null : currentId)}
                      >
                        <span className="game-menu-setting-label">
                          Default for {count}-player games
                        </span>
                        <span className="game-menu-setting-state" aria-hidden="true">
                          {isDefault ? 'On' : 'Off'}
                        </span>
                      </button>
                    );
                  })()}
              </section>
            </>
          )}
        </div>
      </div>
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
    </div>
  );
}

// ── Tap-zone orientation icon (mini board split) ─────────────────────────

function TapZoneIcon({ orientation }: { orientation: 'horizontal' | 'vertical' }) {
  // Small two-cell rectangle hinting at the split direction. Tracks the
  // segmented-toggle's currentColor so it inherits hover / active state.
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

// ── Player roster (add / remove players mid-game) ────────────────────────

const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;

function PlayerRoster({ game, dispatch }: { game: GameState; dispatch: (a: GameAction) => void }) {
  const players = game.players;
  const isOnline = game.mode === 'online';
  // Roster locks once the game has actually been played — any life
  // adjustment, poison tick, commander-damage hit, or elimination flips
  // it in-progress. Until then it's effectively still in setup and seats
  // can be added or removed.
  const inProgress = players.some(
    (p) =>
      p.life !== game.startingLife ||
      p.poison > 0 ||
      p.eliminated ||
      Object.keys(p.commanderDamage).length > 0
  );
  const canRemove = !inProgress && players.length > MIN_PLAYERS;
  // Add-player is local-only — online seats are claimed by remote players
  // joining via the game code from their own device.
  const canAdd = !isOnline && !inProgress && players.length < MAX_PLAYERS;

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
    <div className="game-menu-roster" role="group" aria-label="Players">
      <div className="game-menu-roster-grid">
        {players.map((p) => (
          <div key={p.id} className="game-menu-roster-chip">
            <span className="game-menu-roster-name" title={p.name}>
              {p.name}
            </span>
            <button
              type="button"
              className="game-menu-roster-remove"
              aria-label={`Remove ${p.name}`}
              disabled={!canRemove}
              onClick={() => dispatch({ type: 'remove-player', seat: p.seat })}
            >
              ✕
            </button>
          </div>
        ))}
        {!inProgress && canAdd && (
          <button
            type="button"
            className="game-menu-roster-add"
            onClick={addPlayer}
            aria-label="Add player"
          >
            + Add player
          </button>
        )}
      </div>
      {inProgress && (
        <span className="game-menu-roster-locked">
          Roster locks once the game starts. Reset to change seats.
        </span>
      )}
    </div>
  );
}
