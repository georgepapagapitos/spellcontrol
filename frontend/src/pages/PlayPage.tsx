import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useDecksStore, type Deck } from '../store/decks';
import { aggregateDeckRecords, usePlayStore, type LocalGameSetup } from '../store/play';
import { GameBoard } from '../components/play/GameBoard';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { SelectMenu } from '../components/SelectMenu';
import type { GameFormat, GamePlayer, GameRecord } from '../lib/game-state';

type Tab = 'local' | 'online' | 'history';

const FORMAT_OPTIONS: { value: GameFormat; label: string; defaultLife: number; cmdDmg: boolean }[] =
  [
    { value: 'commander', label: 'Commander', defaultLife: 40, cmdDmg: true },
    { value: 'brawl', label: 'Brawl', defaultLife: 25, cmdDmg: false },
    { value: 'standard', label: 'Standard', defaultLife: 20, cmdDmg: false },
    { value: 'modern', label: 'Modern', defaultLife: 20, cmdDmg: false },
    { value: 'pioneer', label: 'Pioneer', defaultLife: 20, cmdDmg: false },
    { value: 'legacy', label: 'Legacy', defaultLife: 20, cmdDmg: false },
    { value: 'vintage', label: 'Vintage', defaultLife: 20, cmdDmg: false },
    { value: 'pauper', label: 'Pauper', defaultLife: 20, cmdDmg: false },
    { value: 'casual', label: 'Casual', defaultLife: 20, cmdDmg: false },
  ];

export function PlayPage() {
  const [params, setParams] = useSearchParams();
  const user = useAuth((s) => s.user);
  const decks = useDecksStore((s) => s.decks);

  const local = usePlayStore((s) => s.local);
  const online = usePlayStore((s) => s.online);
  const history = usePlayStore((s) => s.history);
  const onlineError = usePlayStore((s) => s.onlineError);
  const boardVisible = usePlayStore((s) => s.boardVisible);

  const startLocal = usePlayStore((s) => s.startLocal);
  const dispatchLocal = usePlayStore((s) => s.dispatchLocal);
  const endLocal = usePlayStore((s) => s.endLocal);
  const discardLocal = usePlayStore((s) => s.discardLocal);

  const hostOnline = usePlayStore((s) => s.hostOnline);
  const joinOnline = usePlayStore((s) => s.joinOnline);
  const dispatchOnline = usePlayStore((s) => s.dispatchOnline);
  const leaveOnline = usePlayStore((s) => s.leaveOnline);
  const refreshOnline = usePlayStore((s) => s.refreshOnline);

  const hideBoard = usePlayStore((s) => s.hideBoard);
  const showBoard = usePlayStore((s) => s.showBoard);

  const initialTab = (params.get('tab') as Tab) || (local ? 'local' : online ? 'online' : 'local');
  const [tab, setTabRaw] = useState<Tab>(initialTab);
  const setTab = (t: Tab) => {
    setTabRaw(t);
    setParams((p) => {
      p.set('tab', t);
      return p;
    });
  };

  // Re-attach polling on mount if we have an active online game in store.
  useEffect(() => {
    if (online) {
      usePlayStore.getState().startPolling();
      void refreshOnline();
    }
    return () => usePlayStore.getState().stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [pendingEnd, setPendingEnd] = useState<'local' | 'online' | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState(false);

  return (
    <div className="play-page">
      <header className="binder-hero play-page-hero">
        <div className="play-page-hero-text">
          <h1 className="binder-hero-name">Play</h1>
        </div>
        <nav className="play-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'local'}
            className={`play-tab ${tab === 'local' ? 'is-active' : ''}`}
            onClick={() => setTab('local')}
          >
            Local
            {local && <span className="play-tab-dot" aria-label="in progress" />}
          </button>
          <button
            role="tab"
            aria-selected={tab === 'online'}
            className={`play-tab ${tab === 'online' ? 'is-active' : ''}`}
            onClick={() => setTab('online')}
          >
            Online
            {online && <span className="play-tab-dot" aria-label="in progress" />}
          </button>
          <button
            role="tab"
            aria-selected={tab === 'history'}
            className={`play-tab ${tab === 'history' ? 'is-active' : ''}`}
            onClick={() => setTab('history')}
          >
            History
            {history.length > 0 && <span className="play-tab-count">{history.length}</span>}
          </button>
        </nav>
      </header>

      {tab === 'local' && (
        <>
          {local && boardVisible ? (
            <GameBoard
              game={local}
              dispatch={dispatchLocal}
              canControlAll
              onMinimize={hideBoard}
              onEnd={() => setPendingEnd('local')}
              onLeave={() => setPendingDiscard(true)}
            />
          ) : (
            <>
              {local && (
                <ResumeBanner
                  game={local}
                  onResume={showBoard}
                  onDiscard={() => setPendingDiscard(true)}
                />
              )}
              <LocalSetup
                decks={decks}
                onStart={(setup) => startLocal(setup)}
                hasActive={!!local}
              />
            </>
          )}
        </>
      )}

      {tab === 'online' && (
        <>
          {online && boardVisible ? (
            <GameBoard
              game={online}
              dispatch={(action) => void dispatchOnline(action)}
              canControlAll={user?.id === online.hostUserId}
              viewerUserId={user?.id ?? null}
              onMinimize={hideBoard}
              onEnd={() => setPendingEnd('online')}
              onLeave={() => void leaveOnline()}
              errorMessage={onlineError}
              banner={
                <div className="play-code-banner">
                  <span className="play-code-label">Join code</span>
                  <span className="play-code-value">{online.code}</span>
                  <span className="play-code-hint">
                    Players go to Play → Online → Join, then enter this code.
                  </span>
                </div>
              }
            />
          ) : (
            <>
              {online && (
                <ResumeBanner
                  game={online}
                  onResume={showBoard}
                  onDiscard={() => void leaveOnline()}
                />
              )}
              <OnlineSetup
                decks={decks}
                onHost={(opts) => void hostOnline(opts)}
                onJoin={(code, opts) => void joinOnline(code, opts)}
                defaultName={user?.username ?? ''}
                hasActive={!!online}
              />
            </>
          )}
        </>
      )}

      {tab === 'history' && <HistoryTab history={history} userId={user?.id ?? null} />}

      {pendingEnd && (
        <EndGameDialog
          game={pendingEnd === 'local' ? local : online}
          onConfirm={(winnerSeat) => {
            if (pendingEnd === 'local') endLocal(winnerSeat);
            else void dispatchOnline({ type: 'end', winnerSeat });
            setPendingEnd(null);
          }}
          onCancel={() => setPendingEnd(null)}
        />
      )}

      {pendingDiscard && (
        <ConfirmDialog
          title="Discard this game?"
          body="The current game will be removed without saving to history."
          confirmLabel="Discard"
          danger
          onConfirm={() => {
            discardLocal();
            setPendingDiscard(false);
          }}
          onCancel={() => setPendingDiscard(false)}
        />
      )}
    </div>
  );
}

// ── Local setup ─────────────────────────────────────────────────────────────

const MIN_LOCAL_PLAYERS = 2;
const MAX_LOCAL_PLAYERS = 6;

function LocalSetup({
  decks,
  onStart,
  hasActive,
}: {
  decks: Deck[];
  onStart: (setup: LocalGameSetup) => void;
  hasActive: boolean;
}) {
  const [format, setFormat] = useState<GameFormat>('commander');
  const formatCfg = FORMAT_OPTIONS.find((f) => f.value === format) ?? FORMAT_OPTIONS[0];
  const [startingLife, setStartingLife] = useState<number>(formatCfg.defaultLife);
  const [commanderDamageEnabled, setCmdDmg] = useState<boolean>(formatCfg.cmdDmg);
  const [poisonEnabled, setPoison] = useState<boolean>(false);
  const [count, setCount] = useState<number>(MIN_LOCAL_PLAYERS);
  const [players, setPlayers] = useState<LocalGameSetup['players']>(() =>
    Array.from({ length: MAX_LOCAL_PLAYERS }, (_, i) => blankPlayer(`Player ${i + 1}`))
  );

  function applyFormat(next: GameFormat) {
    const cfg = FORMAT_OPTIONS.find((f) => f.value === next) ?? FORMAT_OPTIONS[0];
    setFormat(next);
    setStartingLife(cfg.defaultLife);
    setCmdDmg(cfg.cmdDmg);
  }

  function setPlayer(i: number, patch: Partial<LocalGameSetup['players'][number]>) {
    setPlayers((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  function addPlayer() {
    if (count >= MAX_LOCAL_PLAYERS) return;
    setCount((c) => Math.min(c + 1, MAX_LOCAL_PLAYERS));
  }

  function removePlayer(index: number) {
    if (count <= MIN_LOCAL_PLAYERS) return;
    // Shift names down so the visible seats stay 1..N after the splice,
    // then drop the last seat.
    setPlayers((prev) => {
      const next = [...prev];
      next.splice(index, 1);
      next.push(blankPlayer(`Player ${next.length + 1}`));
      // Re-number the placeholder names that the user hasn't customized so
      // the visible list reads Player 1 / Player 2 / … sequentially.
      return next.map((p, i) =>
        /^Player \d+$/.test(p.name) ? { ...p, name: `Player ${i + 1}` } : p
      );
    });
    setCount((c) => Math.max(c - 1, MIN_LOCAL_PLAYERS));
  }

  return (
    <form
      className="play-setup"
      onSubmit={(e) => {
        e.preventDefault();
        onStart({
          format,
          startingLife,
          commanderDamageEnabled,
          poisonEnabled,
          players: players.slice(0, count),
        });
      }}
    >
      <header className="play-setup-header">
        <h2 className="play-setup-title">
          {hasActive ? 'Start a different game' : 'New local game'}
        </h2>
      </header>

      <section className="play-setup-row">
        <div className="play-field play-field-inline">
          <span>Format</span>
          <SelectMenu<GameFormat>
            ariaLabel="Format"
            value={format}
            onChange={applyFormat}
            options={FORMAT_OPTIONS.map((f) => ({ value: f.value, label: f.label }))}
          />
        </div>

        <div className="play-field play-field-inline">
          <span id="starting-life-label">Starting life</span>
          <Stepper
            value={startingLife}
            min={1}
            max={200}
            step={5}
            ariaLabelledBy="starting-life-label"
            onChange={setStartingLife}
          />
        </div>
      </section>

      <section className="play-setup-rules" aria-label="Game rules">
        <RulePill
          on={commanderDamageEnabled}
          onChange={setCmdDmg}
          label="Commander damage"
          hint="Lose at 21 combat damage from a single commander."
        />
        <RulePill
          on={poisonEnabled}
          onChange={setPoison}
          label="Poison counters"
          hint="Lose at 10 poison counters."
        />
      </section>

      <section className="play-setup-roster" aria-label="Players">
        <header className="play-setup-roster-head">
          <h3 className="play-setup-section-title">Players</h3>
          <span className="play-setup-roster-count">{count}</span>
        </header>
        <ul className="play-setup-roster-list">
          {players.slice(0, count).map((p, i) => (
            <li key={i} className="play-setup-seat">
              <span className="play-setup-seat-num" aria-hidden="true">
                {i + 1}
              </span>
              <input
                className="play-setup-seat-name"
                value={p.name}
                onChange={(e) => setPlayer(i, { name: e.target.value })}
                maxLength={40}
                aria-label={`Player ${i + 1} name`}
                placeholder={`Player ${i + 1}`}
              />
              <SeatDeck
                decks={decks}
                value={p.deckId}
                deckName={p.deckName}
                onChange={(deck) =>
                  setPlayer(i, {
                    deckId: deck?.id ?? null,
                    deckName: deck?.name ?? null,
                    commander: deck?.commander?.name ?? null,
                    colorIdentity: deck?.commander?.color_identity ?? [],
                  })
                }
              />
              {count > MIN_LOCAL_PLAYERS && (
                <button
                  type="button"
                  className="play-setup-seat-remove"
                  aria-label={`Remove ${p.name || `Player ${i + 1}`}`}
                  onClick={() => removePlayer(i)}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
        {count < MAX_LOCAL_PLAYERS && (
          <button
            type="button"
            className="play-setup-roster-add"
            onClick={addPlayer}
            aria-label="Add player"
          >
            + Add player
          </button>
        )}
      </section>

      <button type="submit" className="pill-btn pill-btn-primary play-setup-start">
        Start game
      </button>
    </form>
  );
}

// ── Sub-components: stepper, rule pill, per-seat deck affordance ──────────

function Stepper({
  value,
  min,
  max,
  step = 1,
  ariaLabelledBy,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  ariaLabelledBy?: string;
  onChange: (next: number) => void;
}) {
  const dec = () => onChange(Math.max(min, value - step));
  const inc = () => onChange(Math.min(max, value + step));
  return (
    <div className="play-stepper" role="group" aria-labelledby={ariaLabelledBy}>
      <button
        type="button"
        className="play-stepper-btn"
        onClick={dec}
        aria-label="Decrease"
        disabled={value <= min}
      >
        −
      </button>
      <span className="play-stepper-value" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="play-stepper-btn"
        onClick={inc}
        aria-label="Increase"
        disabled={value >= max}
      >
        +
      </button>
    </div>
  );
}

function RulePill({
  on,
  onChange,
  label,
  hint,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`play-rule-pill ${on ? 'is-on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span className="play-rule-pill-label">{label}</span>
      <span className="play-rule-pill-hint">{hint}</span>
      <span className="play-rule-pill-state" aria-hidden="true">
        {on ? 'On' : 'Off'}
      </span>
    </button>
  );
}

function SeatDeck({
  decks,
  value,
  deckName,
  onChange,
}: {
  decks: Deck[];
  value: string | null;
  deckName: string | null;
  onChange: (deck: Deck | null) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!open && !value) {
    return (
      <button
        type="button"
        className="play-setup-seat-deck-add"
        onClick={() => setOpen(true)}
        aria-label="Add deck"
      >
        + Deck
      </button>
    );
  }
  return (
    <div className="play-setup-seat-deck">
      <DeckPicker decks={decks} value={value} onChange={onChange} />
      {value && deckName && (
        <button
          type="button"
          className="play-setup-seat-deck-clear"
          aria-label="Clear deck"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

function blankPlayer(name: string): LocalGameSetup['players'][number] {
  return { name, deckId: null, deckName: null, commander: null, colorIdentity: [] };
}

const DECK_PICKER_NONE = '__none__';

function DeckPicker({
  decks,
  value,
  onChange,
}: {
  decks: Deck[];
  value: string | null;
  onChange: (deck: Deck | null) => void;
}) {
  return (
    <SelectMenu<string>
      ariaLabel="Deck"
      value={value ?? DECK_PICKER_NONE}
      onChange={(next) =>
        onChange(next === DECK_PICKER_NONE ? null : (decks.find((d) => d.id === next) ?? null))
      }
      options={[
        { value: DECK_PICKER_NONE, label: '— None —' },
        ...decks.map((d) => ({
          value: d.id,
          label: d.commander ? `${d.name} · ${d.commander.name}` : d.name,
        })),
      ]}
    />
  );
}

// ── Online setup ────────────────────────────────────────────────────────────

function OnlineSetup({
  decks,
  onHost,
  onJoin,
  defaultName,
  hasActive,
}: {
  decks: Deck[];
  onHost: (opts: {
    format: GameFormat;
    startingLife: number;
    commanderDamageEnabled: boolean;
    poisonEnabled: boolean;
    hostName: string;
    hostDeckId: string | null;
    hostDeckName: string | null;
    hostCommander: string | null;
    hostColorIdentity: string[];
  }) => void;
  onJoin: (
    code: string,
    opts: {
      name: string;
      deckId: string | null;
      deckName: string | null;
      commander: string | null;
      colorIdentity: string[];
    }
  ) => void;
  defaultName: string;
  hasActive: boolean;
}) {
  const [mode, setMode] = useState<'host' | 'join'>('host');
  const [format, setFormat] = useState<GameFormat>('commander');
  const cfg = FORMAT_OPTIONS.find((f) => f.value === format) ?? FORMAT_OPTIONS[0];
  const [startingLife, setStartingLife] = useState(cfg.defaultLife);
  const [commanderDamageEnabled, setCmdDmg] = useState(cfg.cmdDmg);
  const [poisonEnabled, setPoison] = useState(false);
  const [name, setName] = useState(defaultName);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [code, setCode] = useState('');

  function applyFormat(next: GameFormat) {
    const c = FORMAT_OPTIONS.find((f) => f.value === next) ?? FORMAT_OPTIONS[0];
    setFormat(next);
    setStartingLife(c.defaultLife);
    setCmdDmg(c.cmdDmg);
  }

  return (
    <div className="play-setup">
      <div className="play-online-modes" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'host'}
          className={`play-online-mode ${mode === 'host' ? 'is-active' : ''}`}
          onClick={() => setMode('host')}
        >
          Host
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'join'}
          className={`play-online-mode ${mode === 'join' ? 'is-active' : ''}`}
          onClick={() => setMode('join')}
        >
          Join
        </button>
      </div>

      {mode === 'host' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onHost({
              format,
              startingLife,
              commanderDamageEnabled,
              poisonEnabled,
              hostName: name || defaultName,
              hostColorIdentity: deck?.commander?.color_identity ?? [],
              hostDeckId: deck?.id ?? null,
              hostDeckName: deck?.name ?? null,
              hostCommander: deck?.commander?.name ?? null,
            });
          }}
        >
          <header className="play-setup-header">
            <h2 className="play-setup-title">
              {hasActive ? 'Host a different game' : 'Host a game'}
            </h2>
            <p className="play-setup-help">
              You will get a 4-character code. Share it with friends so they can join from their own
              devices.
              {hasActive && ' Hosting a new game will leave the one you have minimized.'}
            </p>
          </header>

          <section className="play-setup-row">
            <div className="play-field play-field-inline">
              <span>Format</span>
              <SelectMenu<GameFormat>
                ariaLabel="Format"
                value={format}
                onChange={applyFormat}
                options={FORMAT_OPTIONS.map((f) => ({ value: f.value, label: f.label }))}
              />
            </div>
            <div className="play-field play-field-inline">
              <span id="online-host-life-label">Starting life</span>
              <Stepper
                value={startingLife}
                min={1}
                max={200}
                step={5}
                ariaLabelledBy="online-host-life-label"
                onChange={setStartingLife}
              />
            </div>
          </section>

          <section className="play-setup-rules" aria-label="Game rules">
            <RulePill
              on={commanderDamageEnabled}
              onChange={setCmdDmg}
              label="Commander damage"
              hint="Lose at 21 combat damage from a single commander."
            />
            <RulePill
              on={poisonEnabled}
              onChange={setPoison}
              label="Poison counters"
              hint="Lose at 10 poison counters."
            />
          </section>

          <section className="play-setup-roster" aria-label="You">
            <header className="play-setup-roster-head">
              <h3 className="play-setup-section-title">You</h3>
            </header>
            <ul className="play-setup-roster-list">
              <li className="play-setup-seat">
                <span className="play-setup-seat-num" aria-hidden="true">
                  1
                </span>
                <input
                  className="play-setup-seat-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  aria-label="Your name"
                  placeholder={defaultName}
                />
                <SeatDeck
                  decks={decks}
                  value={deck?.id ?? null}
                  deckName={deck?.name ?? null}
                  onChange={setDeck}
                />
              </li>
            </ul>
          </section>

          <button type="submit" className="pill-btn pill-btn-primary play-setup-start">
            Create game
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onJoin(code.trim().toUpperCase(), {
              name: name || defaultName,
              deckId: deck?.id ?? null,
              deckName: deck?.name ?? null,
              commander: deck?.commander?.name ?? null,
              colorIdentity: deck?.commander?.color_identity ?? [],
            });
          }}
        >
          <header className="play-setup-header">
            <h2 className="play-setup-title">Join a game</h2>
            <p className="play-setup-help">
              Enter the 4-character code shared by the host, then pick your name and deck.
            </p>
          </header>

          <section className="play-setup-row">
            <label className="play-field play-field-inline">
              <span>Join code</span>
              <input
                className="play-join-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
                placeholder="ABCD"
                maxLength={6}
                inputMode="text"
                autoCapitalize="characters"
                spellCheck={false}
              />
            </label>
          </section>

          <section className="play-setup-roster" aria-label="You">
            <header className="play-setup-roster-head">
              <h3 className="play-setup-section-title">You</h3>
            </header>
            <ul className="play-setup-roster-list">
              <li className="play-setup-seat">
                <span className="play-setup-seat-num" aria-hidden="true">
                  1
                </span>
                <input
                  className="play-setup-seat-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  aria-label="Your name"
                  placeholder={defaultName}
                />
                <SeatDeck
                  decks={decks}
                  value={deck?.id ?? null}
                  deckName={deck?.name ?? null}
                  onChange={setDeck}
                />
              </li>
            </ul>
          </section>

          <button
            type="submit"
            className="pill-btn pill-btn-primary play-setup-start"
            disabled={code.trim().length < 3}
          >
            Join game
          </button>
        </form>
      )}
    </div>
  );
}

// ── History ─────────────────────────────────────────────────────────────────

function HistoryTab({ history, userId }: { history: GameRecord[]; userId: string | null }) {
  const removeHistory = usePlayStore((s) => s.removeHistory);
  const deckRows = useMemo(() => aggregateDeckRecords(history, userId), [history, userId]);

  if (history.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state-tagline">No games yet. Play one!</p>
      </div>
    );
  }

  return (
    <div className="play-history">
      {deckRows.length > 0 && (
        <section className="play-records">
          <h2 className="play-records-title">Deck win-loss</h2>
          <table className="play-records-table">
            <thead>
              <tr>
                <th>Deck</th>
                <th>Played</th>
                <th>W</th>
                <th>L</th>
                <th>Win %</th>
                <th>Last played</th>
              </tr>
            </thead>
            <tbody>
              {deckRows.map((row) => (
                <tr key={row.deckId}>
                  <td>{row.deckName}</td>
                  <td>{row.played}</td>
                  <td>{row.wins}</td>
                  <td>{row.losses}</td>
                  <td>{(row.winRate * 100).toFixed(0)}%</td>
                  <td>{new Date(row.lastPlayedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <section className="play-records">
        <h2 className="play-records-title">Games</h2>
        <ul className="play-history-list">
          {history.map((rec) => {
            const winner =
              rec.winnerSeat != null ? rec.players.find((p) => p.seat === rec.winnerSeat) : null;
            return (
              <li key={rec.id} className="play-history-item">
                <div className="play-history-head">
                  <span className="play-history-format">{rec.format}</span>
                  <span className="play-history-mode">{rec.mode}</span>
                  <span className="play-history-date">
                    {new Date(rec.endedAt).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    className="play-history-remove"
                    aria-label="Remove game"
                    onClick={() => removeHistory(rec.id)}
                  >
                    ×
                  </button>
                </div>
                <div className="play-history-winner">
                  {winner ? `Winner: ${winner.name}` : 'No winner recorded'}
                  {rec.durationMs > 0 && (
                    <span className="play-history-duration">
                      {' '}
                      · {Math.round(rec.durationMs / 60000)} min
                    </span>
                  )}
                </div>
                <ol className="play-history-players">
                  {rec.players.map((p) => (
                    <li key={p.seat} className={p.seat === rec.winnerSeat ? 'is-winner' : ''}>
                      <span className="play-history-player-name">{p.name}</span>
                      {p.deckName && <span className="play-history-player-deck">{p.deckName}</span>}
                      <span className="play-history-player-life">
                        {p.finalLife} life {p.eliminated ? '· eliminated' : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/**
 * Banner shown on the Play tab when there's an active game but the board is
 * minimized. Lets the user resume into the fullscreen view or discard.
 */
function ResumeBanner({
  game,
  onResume,
  onDiscard,
}: {
  game: { players: GamePlayer[]; status: string; mode: 'local' | 'online'; code: string };
  onResume: () => void;
  onDiscard: () => void;
}) {
  const summary = game.players.map((p) => p.name).join(' · ');
  return (
    <section className="play-resume-banner" aria-label="Active game">
      <div className="play-resume-banner-body">
        <span className="play-resume-banner-label">
          {game.mode === 'online' ? `Online game ${game.code}` : 'Local game'}
          <span className="play-resume-banner-status"> · {game.status}</span>
        </span>
        <span className="play-resume-banner-players">{summary}</span>
      </div>
      <div className="play-resume-banner-actions">
        <button type="button" className="pill-btn pill-btn-primary" onClick={onResume}>
          Resume
        </button>
        <button type="button" className="pill-btn" onClick={onDiscard}>
          Discard
        </button>
      </div>
    </section>
  );
}

/**
 * End-game dialog with a real winner picker. If exactly one player is alive
 * it's pre-selected; the user can still pick "No winner" or override. The
 * picker is rendered on top of the game-board overlay (the body:has(.game-board)
 * z-index rule in play.css handles the layering).
 */
function EndGameDialog({
  game,
  onConfirm,
  onCancel,
}: {
  game: { players: GamePlayer[] } | null;
  onConfirm: (winnerSeat: number | null) => void;
  onCancel: () => void;
}) {
  const alive = game?.players.filter((p) => !p.eliminated) ?? [];
  const defaultWinner = alive.length === 1 ? alive[0].seat : null;
  const [winnerSeat, setWinnerSeat] = useState<number | null>(defaultWinner);

  if (!game) return null;
  return (
    <Modal onClose={onCancel} label="End game">
      <h2 className="choice-dialog-title">End the game?</h2>
      <p className="choice-dialog-body">Pick the winner — or end without one.</p>
      <div className="play-end-winners" role="radiogroup" aria-label="Winner">
        {game.players.map((p) => (
          <label
            key={p.seat}
            className={`play-end-winner ${winnerSeat === p.seat ? 'is-selected' : ''}`}
          >
            <input
              type="radio"
              name="winner"
              checked={winnerSeat === p.seat}
              onChange={() => setWinnerSeat(p.seat)}
            />
            <span>{p.name}</span>
          </label>
        ))}
        <label className={`play-end-winner ${winnerSeat === null ? 'is-selected' : ''}`}>
          <input
            type="radio"
            name="winner"
            checked={winnerSeat === null}
            onChange={() => setWinnerSeat(null)}
          />
          <span>No winner</span>
        </label>
      </div>
      <div className="choice-dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onConfirm(winnerSeat)}
          autoFocus
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
