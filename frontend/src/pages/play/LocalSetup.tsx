import { Count } from '@/components/shared/Count';
import { Swords, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/store/auth';
import { type Deck } from '@/store/decks';
import { usePlayStore, type LocalGameSetup } from '@/store/play';
import { listFriends, type Friend } from '@/lib/social/friends-client';
import { getPod, listPods, type Pod } from '@/lib/social/pods-client';
import { formatIdentity } from '@/lib/social/display-name';
import { toast } from '@/store/toasts';
import { SelectMenu } from '@/components/overlays/SelectMenu';
import { FORMAT_OPTIONS, MAX_LOCAL_PLAYERS, MIN_LOCAL_PLAYERS } from '@/lib/play/game-formats';
import { MAX_COUNTERS_PER_SCOPE, MAX_COUNTER_NAME_LENGTH } from '@spellcontrol/game-core';
import { SeatPips, Stepper } from '@/components/play/SetupControls';
import { SwitchRow } from '@/components/shared/form';
import { starterFileName } from '@/lib/play/starter-decks';
import { TableProfiles } from '@/components/play/TableProfiles';
import type { GameFormat } from '@spellcontrol/game-core';
import { userMessage } from '@/lib/util/user-error';
import { HordeSetupFields } from '@/components/play/horde/HordeSetupFields';
import { findBannedCards } from '@/lib/horde/ban-list';
import { useStarterDeckCardNames } from '@/lib/horde/starter-deck-cards';
import { HORDE_CATALOG, type HordeLevel, type HordeSettings } from '@/lib/horde';
import { useHordeGameStore, type HordeSurvivor } from '@/store/horde-game';
import { Button, IconButton } from '@/components/shared/Button';
import { Chip } from '@/components/shared/Chip';
import { SeatDeck, SeatWho, type SeatPerson } from './SeatControls';
import { blankPlayer, seededPlayer } from './seat-players';

export function LocalSetup({
  decks,
  onStart,
  hasActive,
}: {
  decks: Deck[];
  onStart: (setup: LocalGameSetup) => void;
  hasActive: boolean;
}) {
  // A game night's "Start game" captures a one-shot seed (players + format) in
  // the store before navigating here. Read it once at mount — via a lazy
  // useState initializer rather than an effect, so seeding the form's initial
  // values never needs a setState call inside a useEffect body — then clear it
  // so switching tabs and back doesn't reseed over the user's edits.
  const [seed] = useState(() => usePlayStore.getState().gameNightSeed);
  useEffect(() => {
    if (seed) usePlayStore.getState().clearGameSeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Computed once, ahead of both `count` and `startingLife` below, so the
  // starting-life bracket memory (see those state hooks) can pick the right
  // bracket for the form's very first render without duplicating this in two
  // places or fighting hook declaration order.
  const initialCount =
    seed && seed.players.length > 0
      ? Math.max(MIN_LOCAL_PLAYERS, Math.min(seed.players.length, MAX_LOCAL_PLAYERS))
      : MIN_LOCAL_PLAYERS;

  const [format, setFormat] = useState<GameFormat>(seed?.format ?? 'commander');
  const formatCfg = FORMAT_OPTIONS.find((f) => f.value === format) ?? FORMAT_OPTIONS[0];
  // Starting life remembers the last value chosen for a 2-player table and
  // for a 3+ player table SEPARATELY (Lotus splits these the same way) —
  // see `bracketOf` / the count-crossing effect below for the full
  // precedence. `null` means "no override for this bracket yet", so a fresh
  // device (or a bracket nobody has touched) falls back to the picked
  // format's own default, exactly as before this existed.
  const startingLifeTwoPlayer = usePlayStore((s) => s.startingLifeTwoPlayer);
  const startingLifeMultiplayer = usePlayStore((s) => s.startingLifeMultiplayer);
  const setStartingLifeForBracket = usePlayStore((s) => s.setStartingLifeForBracket);
  const bracketOf = (n: number): 'two' | 'multi' => (n === 2 ? 'two' : 'multi');
  const rememberedStartingLife = (bracket: 'two' | 'multi'): number | null =>
    bracket === 'two' ? startingLifeTwoPlayer : startingLifeMultiplayer;
  const [startingLife, setStartingLife] = useState<number>(
    () => rememberedStartingLife(bracketOf(initialCount)) ?? formatCfg.defaultLife
  );
  // Turn order is a fact about the TABLE this game plays at, not this
  // device — it travels with the game (GameState.turnOrder, set once at
  // start), unlike the device-level board display prefs in the game menu's
  // Setup tab. Clockwise is the MTG default and needs no override.
  const [turnOrder, setTurnOrder] = useState<'clockwise' | 'counterclockwise'>('clockwise');
  const [commanderDamageEnabled, setCmdDmg] = useState<boolean>(formatCfg.cmdDmg);
  const [poisonEnabled, setPoison] = useState<boolean>(false);

  // Horde (co-op) — a UI-level fork of this same form, not a real
  // `GameFormat`: picking it swaps the Game/Rules sections and Start begins a
  // game in the horde's own store instead of a normal local game (see
  // `store/horde-game.ts`).
  const [isHorde, setIsHorde] = useState(false);
  const [hordeId, setHordeId] = useState<string>(HORDE_CATALOG[0].id);
  const [hordeLevel, setHordeLevel] = useState<HordeLevel>('standard');
  const [hordeCustomiseOpen, setHordeCustomiseOpen] = useState(false);
  const [hordeOverrides, setHordeOverrides] = useState<Partial<HordeSettings>>({});
  const hordeStatus = useHordeGameStore((s) => s.status);
  const hordeLoadError = useHordeGameStore((s) => s.loadError);
  const minSeats = isHorde ? 1 : MIN_LOCAL_PLAYERS;
  const maxSeats = isHorde ? 4 : MAX_LOCAL_PLAYERS;

  // The board clock is a device preference (persisted in the play store), not
  // a game rule saved with the table's setup — it applies to whichever game
  // this device shows next, local or online, so it's read/written straight
  // from the store rather than through buildSetup/applySetup.
  const gameTimerEnabled = usePlayStore((s) => s.gameTimerEnabled);
  const setGameTimerEnabled = usePlayStore((s) => s.setGameTimerEnabled);
  const turnTrackerEnabled = usePlayStore((s) => s.turnTrackerEnabled);
  const setTurnTrackerEnabled = usePlayStore((s) => s.setTurnTrackerEnabled);
  const [count, setCount] = useState<number>(initialCount);
  // Tracks which starting-life bracket `count` was in last, so the effect
  // below only fires on an actual 2↔3+ crossing (not every add/remove-player
  // click within the same bracket). `suppressBracketSaveRef` skips the
  // save-on-change effect for exactly one `startingLife` update: the one
  // that effect itself makes when a crossing applies the OTHER bracket's
  // remembered (or default) value, and the one a loaded table profile makes
  // (profiles are a full reset — see `applySetup` — and aren't remembered
  // here as if the user had dialed the stepper to that number).
  const prevBracketRef = useRef<'two' | 'multi'>(bracketOf(initialCount));
  const suppressBracketSaveRef = useRef(false);
  useEffect(() => {
    if (isHorde) return;
    const bracket = bracketOf(count);
    if (bracket === prevBracketRef.current) return;
    prevBracketRef.current = bracket;
    suppressBracketSaveRef.current = true;
    setStartingLife(rememberedStartingLife(bracket) ?? formatCfg.defaultLife);
    // Only `count` should trigger a bracket switch; re-running this because
    // `formatCfg`/`rememberedStartingLife` changed identity would re-apply
    // the bracket's remembered life over a starting-life edit the user just
    // made in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, isHorde]);
  useEffect(() => {
    if (isHorde) return;
    if (suppressBracketSaveRef.current) {
      suppressBracketSaveRef.current = false;
      return;
    }
    setStartingLifeForBracket(bracketOf(count), startingLife);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startingLife]);
  // Empty, not a live "Player N" value — the placeholder already shows that
  // suggestion, and a real seeded value (only `name` matters is used
  // instead) means typing over it can't concatenate into "Player 1Alice"
  // (B7-05).
  const [players, setPlayers] = useState<LocalGameSetup['players']>(() =>
    Array.from({ length: MAX_LOCAL_PLAYERS }, (_, i) => seededPlayer(seed?.players[i]))
  );

  // Seats are people. Signed in, the form knows who "you" are and can seat
  // friends and whole pods; a guest's table is names only, as before.
  const user = useAuth((s) => s.user);
  const profile = useAuth((s) => s.profile);
  const me: SeatPerson | null = user
    ? { id: user.id, username: user.username, displayName: profile?.displayName ?? null }
    : null;
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [pods, setPods] = useState<Pod[]>([]);
  const [seatingPod, setSeatingPod] = useState<string | null>(null);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listFriends()
      .then((list) => {
        if (cancelled) return;
        setFriends(list);
        // A game night seeds handles, not ids (its RSVPs never carry account
        // ids). Now that the list is here, seat the account behind each
        // handle so the game credits them; a handle nobody recognizes stays
        // a guest.
        setPlayers((prev) =>
          prev.map((p) => {
            if (p.userId || !p.username) return p;
            const who =
              p.username === user.username ? user : list.find((f) => f.username === p.username);
            return who ? { ...p, userId: who.id } : p;
          })
        );
      })
      .catch(() => {
        // No friends list ≠ no form: seats stay guests until it loads.
        if (!cancelled) setFriends([]);
      });
    listPods()
      .then((list) => {
        if (!cancelled) setPods(list.filter((p) => p.myStatus === 'member'));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  /** Fill the roster with a pod's members — you first, then the rest. */
  async function seatPod(pod: Pod) {
    if (!me || seatingPod) return;
    setSeatingPod(pod.id);
    try {
      const detail = await getPod(pod.id);
      const members = detail.members.filter((m) => m.status === 'member');
      const ordered = [
        ...members.filter((m) => m.userId === me.id),
        ...members.filter((m) => m.userId !== me.id),
      ];
      const seated = ordered.slice(0, maxSeats);
      const next = Array.from({ length: MAX_LOCAL_PLAYERS }, (_, i) => {
        const m = seated[i];
        if (!m) return blankPlayer('');
        const person: SeatPerson =
          m.userId === me.id
            ? me
            : (friends?.find((f) => f.id === m.userId) ?? {
                id: m.userId,
                username: m.username,
                displayName: null,
              });
        return {
          ...blankPlayer(formatIdentity(person).primary),
          userId: person.id,
          username: person.username,
        };
      });
      setPlayers(next);
      setCount(Math.max(minSeats, seated.length));
      if (ordered.length > seated.length) {
        toast.show({
          message: `Seated the first ${maxSeats} of ${pod.name}. The rest need a second table.`,
        });
      }
    } catch (err) {
      toast.show({
        message: userMessage(err, "Couldn't load that pod's roster. Try again in a moment."),
        tone: 'error',
      });
    } finally {
      setSeatingPod(null);
    }
  }
  // Free-form counter names every seat starts with. Empty for most tables;
  // a pod that always tracks energy sets it once and saves it in a profile.
  const [counters, setCounters] = useState<string[]>([]);
  const [counterDraft, setCounterDraft] = useState('');

  /** The form's current values as a startable setup. Shared by submit and by
   *  "save as profile", so a saved profile is exactly what would have run. */
  function buildSetup(): LocalGameSetup {
    return {
      format,
      startingLife,
      commanderDamageEnabled,
      poisonEnabled,
      turnOrder,
      counters,
      players: players
        .slice(0, count)
        .map((p, i) => ({ ...p, name: p.name.trim() || `Player ${i + 1}` })),
    };
  }

  // A starter seat (never in the decks store) checks against its own
  // lazily-resolved card list instead — see `useStarterDeckCardNames`. Until
  // that resolves the seat is silently clean, same as any other soft warning.
  const hordeStarterFiles = useMemo(
    () =>
      isHorde
        ? Array.from(
            new Set(
              players
                .slice(0, count)
                .map((p) => (p.deckId ? starterFileName(p.deckId) : null))
                .filter((f): f is string => Boolean(f))
            )
          )
        : [],
    [isHorde, players, count]
  );
  const hordeStarterCardNames = useStarterDeckCardNames(hordeStarterFiles);

  /** Named seats + their deck's card names, for the Horde ban-list check. */
  const hordeBanWarnings = useMemo(() => {
    if (!isHorde) return [];
    const seats = players.slice(0, count).map((p, i) => {
      const deck = p.deckId ? decks.find((d) => d.id === p.deckId) : null;
      const file = p.deckId ? starterFileName(p.deckId) : null;
      const cardNames = deck
        ? [
            deck.commander?.name,
            deck.partnerCommander?.name,
            ...deck.cards.map((c) => c.card.name),
          ].filter((n): n is string => Boolean(n))
        : ((file ? hordeStarterCardNames.get(file) : undefined) ?? []);
      return { name: p.name.trim() || `Player ${i + 1}`, cardNames };
    });
    return findBannedCards(seats);
  }, [isHorde, players, count, decks, hordeStarterCardNames]);

  function submitHorde() {
    const survivors: HordeSurvivor[] = players.slice(0, count).map((p, i) => ({
      name: p.name.trim() || `Player ${i + 1}`,
      deckId: p.deckId,
      deckName: p.deckName,
      commander: p.commander,
      partner: p.partner,
      colorIdentity: p.colorIdentity,
    }));
    const overrides = Object.keys(hordeOverrides).length > 0 ? hordeOverrides : undefined;
    void useHordeGameStore.getState().startHorde(hordeId, hordeLevel, overrides, survivors);
  }

  /** Load a profile over the form. A genuine reset: every field is replaced,
   *  including the seats beyond the profile's own count, so nothing from the
   *  previous setup survives underneath. */
  function applySetup(setup: LocalGameSetup) {
    // A saved table profile is always a real game — loading one over an
    // in-progress Horde pick returns the form to the normal Format/Rules.
    setIsHorde(false);
    setFormat(setup.format);
    // A profile's starting life wins outright — it's an explicit reset, not
    // a bracket-memory candidate (see the two effects above `count`), so
    // both refs are primed to make them no-ops for this update.
    suppressBracketSaveRef.current = true;
    setStartingLife(setup.startingLife);
    setCmdDmg(setup.commanderDamageEnabled);
    setPoison(setup.poisonEnabled);
    setTurnOrder(setup.turnOrder ?? 'clockwise');
    setCounters(setup.counters ?? []);
    setCounterDraft('');
    const next = Math.max(MIN_LOCAL_PLAYERS, Math.min(setup.players.length, MAX_LOCAL_PLAYERS));
    prevBracketRef.current = bracketOf(next);
    setCount(next);
    setPlayers(
      Array.from({ length: MAX_LOCAL_PLAYERS }, (_, i) => setup.players[i] ?? blankPlayer(''))
    );
  }

  function addCounter() {
    const name = counterDraft.replace(/\s+/g, ' ').trim().slice(0, MAX_COUNTER_NAME_LENGTH);
    if (!name) return;
    setCounters((prev) =>
      prev.some((c) => c.toLowerCase() === name.toLowerCase()) ? prev : [...prev, name]
    );
    setCounterDraft('');
  }

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
    if (count >= maxSeats) return;
    setCount((c) => Math.min(c + 1, maxSeats));
  }

  function removePlayer(index: number) {
    if (count <= minSeats) return;
    // Shift names down so the visible seats stay 1..N after the splice,
    // then drop the last seat.
    setPlayers((prev) => {
      const next = [...prev];
      next.splice(index, 1);
      next.push(blankPlayer(''));
      return next;
    });
    setCount((c) => Math.max(c - 1, minSeats));
  }

  return (
    <form
      className="play-setup play-setup-form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        if (isHorde) submitHorde();
        else onStart(buildSetup());
      }}
    >
      <header className="play-setup-header">
        <h2 className="play-setup-title">
          {hasActive ? 'Start a different game' : 'New local game'}
        </h2>
      </header>

      {!isHorde && <TableProfiles current={buildSetup} onLoad={applySetup} />}

      <section className="play-setup-game" aria-labelledby="play-setup-game-label">
        <h3 id="play-setup-game-label" className="play-setup-section-title">
          Game
        </h3>
        <div className="play-setup-row" style={{ marginTop: '0.5rem' }}>
          <div className="play-field play-field-inline">
            <span>Format</span>
            <SelectMenu<GameFormat>
              ariaLabel="Format"
              value={isHorde ? 'horde' : format}
              onChange={(next) => {
                if (next === 'horde') {
                  // Horde allows only 1-4 survivors — a 5-6 player real-game
                  // roster shrinks to fit the moment the format flips.
                  setIsHorde(true);
                  setCount((c) => Math.min(c, 4));
                  return;
                }
                setIsHorde(false);
                setCount((c) => Math.max(c, MIN_LOCAL_PLAYERS));
                applyFormat(next);
              }}
              options={[
                ...FORMAT_OPTIONS.map((f) => ({ value: f.value, label: f.label })),
                { value: 'horde' as const, label: 'Horde (co-op)' },
              ]}
            />
          </div>

          {!isHorde && (
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
          )}
        </div>
      </section>

      <section className="play-setup-rules" aria-labelledby="play-setup-rules-label">
        <h3 id="play-setup-rules-label" className="play-setup-section-title">
          {isHorde ? 'The horde' : 'Rules'}
        </h3>
        {isHorde ? (
          <HordeSetupFields
            hordeId={hordeId}
            onHordeChange={setHordeId}
            level={hordeLevel}
            onLevelChange={setHordeLevel}
            survivorCount={count}
            customiseOpen={hordeCustomiseOpen}
            onToggleCustomise={() => setHordeCustomiseOpen((v) => !v)}
            overrides={hordeOverrides}
            onOverridesChange={setHordeOverrides}
            warnings={hordeBanWarnings}
          />
        ) : (
          <div className="play-setup-switches">
            <SwitchRow
              label="Commander damage"
              checked={commanderDamageEnabled}
              onChange={setCmdDmg}
            />
            <SwitchRow
              label="Game timer"
              checked={gameTimerEnabled}
              onChange={setGameTimerEnabled}
            />
            <SwitchRow
              label="Turn tracker"
              hint="Marks the active seat and who's next."
              checked={turnTrackerEnabled}
              onChange={setTurnTrackerEnabled}
            />
            <SwitchRow
              label="Counterclockwise seating"
              checked={turnOrder === 'counterclockwise'}
              onChange={(on) => setTurnOrder(on ? 'counterclockwise' : 'clockwise')}
            />
            <SwitchRow label="Poison counters" checked={poisonEnabled} onChange={setPoison} />
          </div>
        )}

        {/* Free-form counters every seat starts with. Nothing here is a rule:
            these never cause a loss, they are just what this table counts. */}
        {!isHorde && (
          <div className="play-setup-counters">
            <span id="setup-counters-label" className="play-setup-counters-label">
              Counters on every seat
            </span>
            {counters.length > 0 && (
              <ul className="play-setup-counter-chips" aria-labelledby="setup-counters-label">
                {counters.map((name) => (
                  <li key={name}>
                    <Chip
                      className="play-setup-counter-chip"
                      aria-label={`Remove ${name}`}
                      onClick={() => setCounters((prev) => prev.filter((c) => c !== name))}
                      trailing={<span aria-hidden="true">✕</span>}
                    >
                      {name}
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
            {counters.length < MAX_COUNTERS_PER_SCOPE && (
              <div className="play-setup-counter-add">
                <input
                  className="play-setup-counter-input"
                  value={counterDraft}
                  onChange={(e) => setCounterDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter inside a form submits it, which would start the
                    // game instead of adding the counter.
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    addCounter();
                  }}
                  maxLength={MAX_COUNTER_NAME_LENGTH}
                  placeholder="Energy"
                  aria-label="New counter name"
                />
                <button
                  type="button"
                  className="play-setup-counter-btn"
                  disabled={!counterDraft.trim()}
                  onClick={addCounter}
                >
                  Add
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="play-setup-roster" aria-label="Players">
        <header className="play-setup-roster-head">
          <h3 className="play-setup-section-title">Players</h3>
          <Count
            className="play-setup-roster-count"
            value={count}
            placement="inline"
            label={`${count} players`}
          />
        </header>
        {me && pods.length > 0 && (
          <div className="play-setup-pods" role="group" aria-label="Seat a pod">
            <span className="play-setup-pods-label">Seat a pod</span>
            {pods.map((pod) => (
              <Button
                placement="row"
                key={pod.id}
                disabled={seatingPod !== null}
                aria-busy={seatingPod === pod.id}
                onClick={() => void seatPod(pod)}
              >
                {pod.name}
              </Button>
            ))}
          </div>
        )}
        <ul className="play-setup-roster-list">
          {players.slice(0, count).map((p, i) => (
            <li key={i} className="play-setup-seat">
              <span className="play-setup-seat-num" aria-hidden="true">
                {i + 1}
              </span>
              {me && (
                <SeatWho
                  seatIndex={i}
                  value={p.userId ?? null}
                  me={me}
                  friends={friends ?? []}
                  taken={
                    new Set(
                      players
                        .slice(0, count)
                        .filter((q, idx) => idx !== i && q.userId)
                        .map((q) => q.userId as string)
                    )
                  }
                  onChange={(person) =>
                    setPlayer(
                      i,
                      person
                        ? {
                            userId: person.id,
                            username: person.username,
                            name: formatIdentity(person).primary,
                          }
                        : { userId: null, username: null }
                    )
                  }
                />
              )}
              <input
                className="play-setup-seat-name"
                value={p.name}
                onChange={(e) => setPlayer(i, { name: e.target.value })}
                maxLength={40}
                aria-label={`Player ${i + 1} name`}
                placeholder={`Player ${i + 1}`}
              />
              <SeatPips ci={p.colorIdentity} />
              <SeatDeck
                decks={decks}
                value={p.deckId}
                deckName={p.deckName}
                onChange={(picked) =>
                  setPlayer(i, {
                    deckId: picked?.id ?? null,
                    deckName: picked?.name ?? null,
                    commander: picked?.commander ?? null,
                    // Decks already model the second commander, so a Partner
                    // seat splits its damage counter with no setup step —
                    // nobody stops mid-game to type in a commander name.
                    partner: picked?.partner ?? null,
                    colorIdentity: picked?.colorIdentity ?? [],
                  })
                }
              />
              {count > minSeats && (
                <IconButton
                  className="play-setup-seat-remove"
                  label={`Remove ${p.name || `Player ${i + 1}`}`}
                  onClick={() => removePlayer(i)}
                  icon={<X width={14} height={14} strokeWidth={1.8} />}
                />
              )}
            </li>
          ))}
        </ul>
        {count < maxSeats && (
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

      {isHorde && hordeStatus === 'error' && (
        <div className="discover-decks-error" role="alert">
          <span>{hordeLoadError ?? "Couldn't load that horde."}</span>
          <Button
            onClick={() => useHordeGameStore.getState().retryLoad()}
            className="discover-decks-error-retry"
          >
            Retry
          </Button>
        </div>
      )}

      <Button
        variant="primary"
        type="submit"
        disabled={isHorde && hordeStatus === 'loading'}
        className="play-setup-start"
        icon={<Swords width={16} height={16} strokeWidth={2} />}
      >
        {isHorde && hordeStatus === 'loading' ? 'Loading the horde…' : 'Start game'}
      </Button>
    </form>
  );
}
