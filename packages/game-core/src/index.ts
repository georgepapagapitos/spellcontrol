/**
 * Authoritative game-state reducer. The same shape and apply() logic runs on
 * the server (for online sessions) and on the client (for local games and
 * optimistic updates). Keeping the reducer pure means a client can replay an
 * action locally for instant feedback and reconcile with the server's
 * canonical result on the next poll.
 *
 * Loss conditions are auto-applied at action time so the UI doesn't need to
 * notice — set life to 0 and the player flips to eliminated.
 */

/**
 * Visual arrangement of player panels on the board. Affects only how seats
 * are rendered — the game logic is layout-agnostic.
 *
 * Each layout id maps (per-count) to a CSS-grid template plus an array of
 * per-seat rotations (0° or 180°, never 90°). The mapping lives in the
 * client-side layout registry — the server only persists the id.
 *
 *  - `pod`     — across-the-table. Panels split between two sides of the
 *    device; the "far" side reads upside-down so a passed phone faces
 *    each player. The default for every count.
 *  - `pod-alt` — the asymmetric inverse of `pod`, used by odd counts
 *    (3p, 5p) where 1v2 and 2v1 are genuinely different seatings.
 * Layout ids are opaque strings — the frontend's board-layouts registry
 * defines the actual seat placements, and the server treats the field as
 * a free-form persistence token. Unknown ids fall back to a default at
 * render time, so adding/removing layouts on the client never invalidates
 * persisted games.
 */
export type GameLayout = string;

// Runtime dependency runs one way only: this module imports from `./summary`,
// which imports nothing but *types* back from here (erased at compile time).
import { summarizeGame, type GameSummary } from './summary';

export type TapOrientation = 'horizontal' | 'vertical';

/**
 * Coarse turn-structure phase for the advisory phase clock. Deliberately
 * coarse — this is a life pad, not a rules engine, so untap/upkeep/draw all
 * collapse into `beginning`. Advisory only: the reducer never validates that
 * phases advance in order, and nothing here ever blocks an action.
 */
export type GamePhase = 'beginning' | 'main1' | 'combat' | 'main2' | 'end';

/** Canonical phase order, for UI that renders/advances the clock. */
export const GAME_PHASES: readonly GamePhase[] = ['beginning', 'main1', 'combat', 'main2', 'end'];

export type GameFormat =
  | 'commander'
  | 'standard'
  | 'modern'
  | 'pioneer'
  | 'legacy'
  | 'vintage'
  | 'pauper'
  | 'brawl'
  | 'casual';

export interface GamePlayer {
  /** Stable id; for online games this is the user id when authed, else a guest token. */
  id: string;
  /** Authenticated user id, or null for an anonymous local/guest seat. */
  userId: string | null;
  seat: number;
  name: string;
  deckId: string | null;
  deckName: string | null;
  /** Commander name (display only). */
  commander: string | null;
  /**
   * Second commander for a Partner / Friends Forever / Doctor's Companion
   * pair; null for the overwhelmingly common single-commander seat. Display
   * only, like `commander` — but its presence is what splits this seat's
   * commander-damage counter in two, because rule 903.10a counts to 21 per
   * *commander*, not per player. A Background is an enchantment and never
   * deals combat damage, so a commander+Background seat correctly leaves this
   * null. Legacy players read undefined → null.
   */
  partner: string | null;
  /** Commander color identity (W/U/B/R/G); drives the *default* panel color. */
  colorIdentity: string[];
  /** Player-chosen panel color override (W/U/B/R/G/M/C) or null to auto. */
  panelColorKey: string | null;
  life: number;
  poison: number;
  /**
   * Commander damage taken, keyed per *dealing commander* via `cmdDamageKey`:
   * `"3"` is seat 3's primary commander, `"3#p"` is seat 3's partner.
   *
   * The keys were always strings on the wire (JSON object keys are), so every
   * row written before partners existed keys as `"3"` and keeps meaning
   * exactly what it meant — seat 3's primary. That is why this needed no
   * migration. Never sum two keys to test lethality: 11 from one commander
   * plus 10 from its partner is 21 total and kills nobody.
   */
  commanderDamage: Record<string, number>;
  eliminated: boolean;
  isHost: boolean;
  /** Server-set presence flag for online games. Local games leave this true. */
  connected: boolean;
}

export interface GameEvent {
  id: string;
  ts: number;
  kind:
    | 'life'
    | 'set-life'
    | 'poison'
    | 'cmd-dmg'
    | 'eliminate'
    | 'revive'
    | 'note'
    | 'join'
    | 'leave'
    | 'start'
    | 'end'
    | 'reset'
    | 'settings'
    | 'turn'
    | 'designation'
    | 'phase';
  actorSeat: number | null;
  targetSeat: number | null;
  delta?: number;
  fromSeat?: number;
  /** cmd-dmg only: the damage came from that seat's partner, not its primary. */
  fromPartner?: boolean;
  message?: string;
}

export type GameStatus = 'lobby' | 'active' | 'finished';

/**
 * Table designations: each can be held by at most one player at a time.
 * - `monarch`: the Monarch, drawn from the Monarch mechanic.
 * - `initiative`: holder of The Initiative (Undercity mechanic).
 * A null value means the designation is currently unclaimed.
 * Persisted per game; legacy games that predate this field read it as
 * `{ monarch: null, initiative: null }` via the default in resolvers.
 */
export interface GameDesignations {
  monarch: number | null;
  initiative: number | null;
}

export type DesignationKind = keyof GameDesignations;

export interface GameState {
  id: string;
  /** Short join code (online). Empty string for local games. */
  code: string;
  mode: 'local' | 'online';
  status: GameStatus;
  hostUserId: string | null;
  format: GameFormat;
  startingLife: number;
  commanderDamageEnabled: boolean;
  poisonEnabled: boolean;
  /** Visual arrangement of player panels. Defaults to 'pod'. */
  layout: GameLayout;
  /**
   * Tap-zone orientation per panel.
   * - `horizontal` (default): left half = −1, right half = +1.
   * - `vertical`: top half = +1, bottom half = −1.
   * Persisted per game; persisted games from before this field default to
   * `horizontal` via the resolver.
   */
  tapOrientation: TapOrientation;
  /**
   * The seat number of the player whose turn it currently is, or null when
   * turn tracking has not yet started. Games that never call `pass-turn` keep
   * this null and behave exactly as before — no change in existing behaviour.
   * Persisted per game; legacy states read this as null via the resolver.
   */
  activeSeat: number | null;
  /**
   * The seat that took the first turn ("on the play"), or null when nobody
   * recorded it. Set by the random-first-player table tool, which used to
   * announce its pick into the log and throw the fact away — the log line is
   * prose nothing can aggregate, so the pick is now state.
   *
   * Deliberately NOT inferred from `activeSeat` at start: a pod that never
   * passes turns leaves activeSeat null forever, and a pod that does pass
   * turns has already moved it by the time anyone reads it. Absent means
   * "nobody recorded who went first", which every consumer must render as
   * "—" rather than folding into seat 0. Legacy states read null.
   */
  startingSeat: number | null;
  /**
   * Table designations (Monarch, Initiative). Each is a seat number or null
   * (unclaimed). One holder at most per designation; claiming transfers it.
   * Persisted per game; legacy states default to both null via the resolver.
   */
  designations: GameDesignations;
  /**
   * Advisory phase clock. OPTIONAL: persisted JSONB rows predate this field,
   * and absent means "the clock hasn't been started" — the UI shows nothing
   * rather than defaulting to `beginning`. Once set, `pass-turn` resets it to
   * `beginning` on every turn advance; it never reverts to absent on its own.
   * Purely advisory — never validated, never blocks an action.
   */
  phase?: GamePhase;
  players: GamePlayer[];
  events: GameEvent[];
  winnerSeat: number | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  version: number;
}

export type GameAction =
  | { type: 'start'; ts?: number }
  | { type: 'end'; winnerSeat: number | null; ts?: number }
  | { type: 'reset'; ts?: number }
  | { type: 'add-player'; player: GamePlayer; ts?: number }
  | { type: 'remove-player'; seat: number; ts?: number }
  | {
      type: 'update-player';
      seat: number;
      patch: Partial<
        Pick<
          GamePlayer,
          | 'name'
          | 'deckId'
          | 'deckName'
          | 'commander'
          | 'partner'
          | 'colorIdentity'
          | 'panelColorKey'
          | 'connected'
        >
      >;
      ts?: number;
    }
  | { type: 'life'; seat: number; delta: number; actorSeat: number | null; ts?: number }
  | { type: 'set-life'; seat: number; value: number; actorSeat: number | null; ts?: number }
  | { type: 'poison'; seat: number; delta: number; actorSeat: number | null; ts?: number }
  | {
      type: 'cmd-dmg';
      seat: number;
      fromSeat: number;
      /**
       * True when the damage came from that seat's PARTNER rather than its
       * primary commander. Optional and false-by-default so every existing
       * dispatch (and every persisted online action) keeps its meaning.
       */
      fromPartner?: boolean;
      delta: number;
      actorSeat: number | null;
      ts?: number;
    }
  | { type: 'eliminate'; seat: number; eliminated: boolean; ts?: number }
  | { type: 'note'; actorSeat: number | null; message: string; ts?: number }
  | {
      type: 'settings';
      patch: Partial<
        Pick<
          GameState,
          | 'startingLife'
          | 'commanderDamageEnabled'
          | 'poisonEnabled'
          | 'format'
          | 'layout'
          | 'tapOrientation'
          | 'startingSeat'
        >
      >;
      ts?: number;
    }
  /**
   * Move the turn marker. Without `toSeat`: advance the active seat to the
   * next non-eliminated player in seat order (wraps; from null starts at the
   * lowest-seat non-eliminated player). With `toSeat`: set the marker
   * directly to that seat ("start/take the turn here") — ignored if that
   * seat is eliminated/unknown, falling back to the advance behaviour.
   * Safe to call at any game status — the UI gates it to active games.
   */
  | { type: 'pass-turn'; actorSeat: number | null; toSeat?: number | null; ts?: number }
  /**
   * Claim or clear a table designation (Monarch / Initiative).
   * Setting `seat` to null explicitly clears the designation.
   * Claiming automatically removes it from the previous holder.
   */
  | {
      type: 'set-designation';
      designation: DesignationKind;
      seat: number | null;
      actorSeat: number | null;
      ts?: number;
    }
  /**
   * Set the advisory phase clock verbatim. No "must advance in order"
   * validation — a table correcting itself (combat back to main1) is a
   * normal use, and advisory means the reducer never says no.
   */
  | { type: 'phase'; phase: GamePhase; actorSeat: number | null; ts?: number };

const MAX_EVENTS = 500;

/**
 * The `settings` fields that change how the game *plays*, as opposed to how the
 * board *looks*. Only a change to one of these pushes a log event — see the
 * `settings` case in `applyAction`.
 */
const RULES_SETTINGS_KEYS = [
  'startingLife',
  'commanderDamageEnabled',
  'poisonEnabled',
  'format',
] as const;

function makeEventId(ts: number): string {
  // Crypto.randomUUID is everywhere we care (Node 18+, modern browsers).
  if (typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto) {
    return `evt_${globalThis.crypto.randomUUID()}`;
  }
  return `evt_${ts}_${Math.random().toString(36).slice(2, 10)}`;
}

function pushEvent(
  state: GameState,
  ev: Omit<GameEvent, 'id' | 'ts'> & { ts?: number }
): GameEvent[] {
  const ts = ev.ts ?? Date.now();
  const full: GameEvent = { id: makeEventId(ts), ts, ...ev };
  const next = [...state.events, full];
  // Keep the log bounded so a long online session can't bloat the DB row.
  return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
}

function updatePlayer(
  state: GameState,
  seat: number,
  patch: (p: GamePlayer) => GamePlayer
): GamePlayer[] {
  return state.players.map((p) => (p.seat === seat ? patch(p) : p));
}

/**
 * Find the next non-eliminated seat after `currentSeat` in sorted seat order,
 * wrapping. Returns `null` if no eligible seat exists (everyone is eliminated).
 * When `currentSeat` is null, returns the first non-eliminated seat.
 */
function nextActiveSeat(players: GamePlayer[], currentSeat: number | null): number | null {
  const alive = players.filter((p) => !p.eliminated).sort((a, b) => a.seat - b.seat);
  if (alive.length === 0) return null;
  if (currentSeat === null) return alive[0].seat;
  const idx = alive.findIndex((p) => p.seat === currentSeat);
  // If the current active seat is no longer alive, start at the first alive seat.
  if (idx === -1) return alive[0].seat;
  return alive[(idx + 1) % alive.length].seat;
}

/**
 * Resolve the designations field tolerantly — legacy persisted states that
 * were created before UX-324 won't have this field.
 */
function resolveDesignations(raw: GameDesignations | undefined | null): GameDesignations {
  return {
    monarch: raw?.monarch ?? null,
    initiative: raw?.initiative ?? null,
  };
}

/**
 * Look up a player by seat; throws with a standard message if the seat is
 * unknown. Use this in action handlers that require the seat to exist.
 */
function requireSeat(players: GamePlayer[], seat: number): GamePlayer {
  const p = players.find((p) => p.seat === seat);
  if (!p) throw new Error(`No player at seat ${seat}.`);
  return p;
}

/**
 * Key into `GamePlayer.commanderDamage` for damage dealt BY one commander.
 * `"3"` is seat 3's primary commander; `"3#p"` is seat 3's partner.
 *
 * The primary key is the bare seat number precisely so that every row written
 * before partners existed still resolves to the right bucket — no migration.
 * Shared with the client so the board and the reducer can never disagree on
 * which counter a tap belongs to.
 */
export function cmdDamageKey(fromSeat: number, fromPartner = false): string {
  return fromPartner ? `${fromSeat}#p` : `${fromSeat}`;
}

function checkLossConditions(player: GamePlayer, state: GameState): boolean {
  if (player.eliminated) return true;
  if (player.life <= 0) return true;
  if (state.poisonEnabled && player.poison >= 10) return true;
  if (state.commanderDamageEnabled) {
    // Per-VALUE, never a sum: rule 903.10a is 21 from *the same commander*, so
    // 11 from one partner plus 10 from the other kills nobody. This loop was
    // already per-value, which is why re-keying the map per commander made the
    // rule correct here with no change to this function.
    for (const dmg of Object.values(player.commanderDamage)) {
      if (dmg >= 21) return true;
    }
  }
  return false;
}

function maybeAutoEliminate(state: GameState): { state: GameState; auto: number[] } {
  const auto: number[] = [];
  const players = state.players.map((p) => {
    if (!p.eliminated && checkLossConditions(p, state)) {
      auto.push(p.seat);
      return { ...p, eliminated: true };
    }
    return p;
  });
  return { state: { ...state, players }, auto };
}

function maybeAutoWin(state: GameState): GameState {
  if (state.status !== 'active') return state;
  const alive = state.players.filter((p) => !p.eliminated);
  if (alive.length === 1 && state.players.length > 1) {
    return {
      ...state,
      status: 'finished',
      winnerSeat: alive[0].seat,
      endedAt: state.endedAt ?? Date.now(),
    };
  }
  if (alive.length === 0 && state.players.length > 0) {
    return {
      ...state,
      status: 'finished',
      winnerSeat: null,
      endedAt: state.endedAt ?? Date.now(),
    };
  }
  return state;
}

export function createGameState(input: {
  id: string;
  code: string;
  mode: 'local' | 'online';
  hostUserId: string | null;
  format: GameFormat;
  startingLife: number;
  commanderDamageEnabled: boolean;
  poisonEnabled: boolean;
  layout?: GameLayout;
  tapOrientation?: TapOrientation;
  players: GamePlayer[];
  ts?: number;
}): GameState {
  const now = input.ts ?? Date.now();
  return {
    id: input.id,
    code: input.code,
    mode: input.mode,
    status: 'lobby',
    hostUserId: input.hostUserId,
    format: input.format,
    startingLife: input.startingLife,
    commanderDamageEnabled: input.commanderDamageEnabled,
    poisonEnabled: input.poisonEnabled,
    layout: input.layout ?? 'pod',
    tapOrientation: input.tapOrientation ?? 'horizontal',
    activeSeat: null,
    startingSeat: null,
    designations: { monarch: null, initiative: null },
    players: input.players,
    events: [],
    winnerSeat: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    endedAt: null,
    version: 0,
  };
}

export function makePlayer(input: {
  id: string;
  userId: string | null;
  seat: number;
  name: string;
  deckId?: string | null;
  deckName?: string | null;
  commander?: string | null;
  partner?: string | null;
  colorIdentity?: string[];
  startingLife: number;
  isHost?: boolean;
  connected?: boolean;
}): GamePlayer {
  return {
    id: input.id,
    userId: input.userId,
    seat: input.seat,
    name: input.name,
    deckId: input.deckId ?? null,
    deckName: input.deckName ?? null,
    commander: input.commander ?? null,
    partner: input.partner ?? null,
    colorIdentity: input.colorIdentity ?? [],
    panelColorKey: null,
    life: input.startingLife,
    poison: 0,
    commanderDamage: {},
    eliminated: false,
    isHost: input.isHost ?? false,
    connected: input.connected ?? true,
  };
}

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}

/**
 * Pure reducer. Throws on invalid actions (unknown seats, etc) so the caller
 * can map the error to a 400 — clients should never reach those branches in
 * normal use.
 */
export function applyAction(prev: GameState, action: GameAction): GameState {
  const ts = action.ts ?? Date.now();
  // Legacy tolerance: old persisted states won't have activeSeat / designations.
  // Normalize them once at the top so all action cases see consistent fields.
  let next: GameState = {
    ...prev,
    activeSeat: prev.activeSeat ?? null,
    startingSeat: prev.startingSeat ?? null,
    designations: resolveDesignations(prev.designations),
  };

  switch (action.type) {
    case 'start': {
      if (prev.status !== 'lobby') return prev;
      next = {
        ...next,
        status: 'active',
        startedAt: ts,
        events: pushEvent(next, { kind: 'start', actorSeat: null, targetSeat: null, ts }),
      };
      break;
    }
    case 'end': {
      if (prev.status === 'finished') return prev;
      // A player who is eliminated (or a seat that doesn't exist) can never be
      // the winner — coerce any such client-supplied winnerSeat to null rather
      // than trusting it, so a losing participant can't forge a self-win into
      // the permanent game_results stats.
      const winnerSeat =
        action.winnerSeat != null &&
        prev.players.some((p) => p.seat === action.winnerSeat && !p.eliminated)
          ? action.winnerSeat
          : null;
      next = {
        ...next,
        status: 'finished',
        winnerSeat,
        endedAt: ts,
        events: pushEvent(next, {
          kind: 'end',
          actorSeat: null,
          targetSeat: winnerSeat,
          ts,
        }),
      };
      break;
    }
    case 'reset': {
      next = {
        ...next,
        status: 'lobby',
        winnerSeat: null,
        startedAt: null,
        endedAt: null,
        // Reset turn tracking, the on-the-play seat, and designations when the
        // game resets — a reset is a fresh game at the same table, so last
        // game's first player is stale, not inherited.
        activeSeat: null,
        startingSeat: null,
        designations: { monarch: null, initiative: null },
        players: prev.players.map((p) => ({
          ...p,
          life: prev.startingLife,
          poison: 0,
          commanderDamage: {},
          eliminated: false,
        })),
        events: pushEvent(next, { kind: 'reset', actorSeat: null, targetSeat: null, ts }),
      };
      break;
    }
    case 'add-player': {
      if (prev.players.some((p) => p.seat === action.player.seat)) {
        throw new Error(`Seat ${action.player.seat} is taken.`);
      }
      next = {
        ...next,
        players: [...prev.players, action.player].sort((a, b) => a.seat - b.seat),
        events: pushEvent(next, {
          kind: 'join',
          actorSeat: null,
          targetSeat: action.player.seat,
          message: action.player.name,
          ts,
        }),
      };
      break;
    }
    case 'remove-player': {
      const target = requireSeat(prev.players, action.seat);
      next = {
        ...next,
        players: prev.players.filter((p) => p.seat !== action.seat),
        // Drop the on-the-play mark if its holder left: seats are reusable by
        // a later joiner, and a stale seat number would credit "went first"
        // to whoever sits there next.
        startingSeat: next.startingSeat === action.seat ? null : next.startingSeat,
        events: pushEvent(next, {
          kind: 'leave',
          actorSeat: null,
          targetSeat: action.seat,
          message: target.name,
          ts,
        }),
      };
      break;
    }
    case 'update-player': {
      requireSeat(prev.players, action.seat);
      next = {
        ...next,
        players: updatePlayer(next, action.seat, (p) => ({ ...p, ...action.patch })),
      };
      break;
    }
    case 'life': {
      requireSeat(prev.players, action.seat);
      next = {
        ...next,
        players: updatePlayer(next, action.seat, (p) => ({ ...p, life: p.life + action.delta })),
        events: pushEvent(next, {
          kind: 'life',
          actorSeat: action.actorSeat,
          targetSeat: action.seat,
          delta: action.delta,
          ts,
        }),
      };
      break;
    }
    case 'set-life': {
      requireSeat(prev.players, action.seat);
      next = {
        ...next,
        players: updatePlayer(next, action.seat, (p) => ({ ...p, life: action.value })),
        events: pushEvent(next, {
          kind: 'set-life',
          actorSeat: action.actorSeat,
          targetSeat: action.seat,
          delta: action.value,
          ts,
        }),
      };
      break;
    }
    case 'poison': {
      requireSeat(prev.players, action.seat);
      next = {
        ...next,
        players: updatePlayer(next, action.seat, (p) => ({
          ...p,
          poison: Math.max(0, p.poison + action.delta),
        })),
        events: pushEvent(next, {
          kind: 'poison',
          actorSeat: action.actorSeat,
          targetSeat: action.seat,
          delta: action.delta,
          ts,
        }),
      };
      break;
    }
    case 'cmd-dmg': {
      requireSeat(prev.players, action.seat);
      next = {
        ...next,
        players: updatePlayer(next, action.seat, (p) => {
          const key = cmdDamageKey(action.fromSeat, action.fromPartner);
          const cur = p.commanderDamage[key] ?? 0;
          const nextDmg = Math.max(0, cur + action.delta);
          // Life moves by the damage actually applied, not the requested
          // delta — decrementing at 0 is clamped, so it must not hand out
          // free life. (Reachable from the board's ± controls.)
          const applied = nextDmg - cur;
          return {
            ...p,
            commanderDamage: { ...p.commanderDamage, [key]: nextDmg },
            // Commander damage also reduces life by the same amount.
            life: p.life - applied,
          };
        }),
        events: pushEvent(next, {
          kind: 'cmd-dmg',
          actorSeat: action.actorSeat,
          targetSeat: action.seat,
          fromSeat: action.fromSeat,
          fromPartner: action.fromPartner || undefined,
          delta: action.delta,
          ts,
        }),
      };
      break;
    }
    case 'eliminate': {
      requireSeat(prev.players, action.seat);
      next = {
        ...next,
        players: updatePlayer(next, action.seat, (p) => ({ ...p, eliminated: action.eliminated })),
        events: pushEvent(next, {
          kind: action.eliminated ? 'eliminate' : 'revive',
          actorSeat: null,
          targetSeat: action.seat,
          ts,
        }),
      };
      break;
    }
    case 'note': {
      next = {
        ...next,
        events: pushEvent(next, {
          kind: 'note',
          actorSeat: action.actorSeat,
          targetSeat: null,
          message: action.message,
          ts,
        }),
      };
      break;
    }
    case 'settings': {
      const patch = action.patch;
      const startingLifeChanged =
        typeof patch.startingLife === 'number' && patch.startingLife !== prev.startingLife;
      // Only *rules* changes earn a log row. `layout` / `tapOrientation` are
      // pure presentation, and logging them meant every board rearrangement or
      // tap-zone flip pushed a "Settings changed" row — burying real moments
      // and, at MAX_EVENTS, evicting them from a long game entirely.
      const rulesChanged = RULES_SETTINGS_KEYS.some(
        (k) => patch[k] !== undefined && patch[k] !== prev[k]
      );
      next = {
        ...next,
        ...patch,
        // Re-base life only in lobby. Once active, settings tweaks don't retro-edit life.
        players:
          startingLifeChanged && prev.status === 'lobby'
            ? prev.players.map((p) => ({ ...p, life: patch.startingLife! }))
            : prev.players,
        events: rulesChanged
          ? pushEvent(next, {
              kind: 'settings',
              actorSeat: null,
              targetSeat: null,
              ts,
            })
          : next.events,
      };
      break;
    }
    case 'pass-turn': {
      // Resolve legacy states: activeSeat may be absent on old persisted games.
      const currentActive = (prev as GameState).activeSeat ?? null;
      // A targeted move ("start the turn here") sets the marker directly when
      // the target seat is a live player; otherwise advance from current.
      const target =
        action.toSeat != null && prev.players.some((p) => p.seat === action.toSeat && !p.eliminated)
          ? action.toSeat
          : null;
      const newActive = target ?? nextActiveSeat(prev.players, currentActive);
      next = {
        ...next,
        activeSeat: newActive,
        // Reset the phase clock to 'beginning' on every turn advance — but
        // only if it's already running. Absent stays absent: a table that
        // never started the clock shouldn't have pass-turn start it for them.
        ...(prev.phase !== undefined ? { phase: 'beginning' as GamePhase } : {}),
        events: pushEvent(next, {
          kind: 'turn',
          actorSeat: action.actorSeat,
          targetSeat: newActive,
          ts,
        }),
      };
      break;
    }
    case 'set-designation': {
      // Validate the target seat exists (unless clearing with null).
      if (action.seat !== null) requireSeat(prev.players, action.seat);
      next = {
        ...next,
        designations: {
          ...next.designations,
          [action.designation]: action.seat,
        },
        events: pushEvent(next, {
          kind: 'designation',
          actorSeat: action.actorSeat,
          // targetSeat = new holder (or null if cleared)
          targetSeat: action.seat,
          // fromSeat = previous holder (null if unclaimed)
          fromSeat: next.designations[action.designation] ?? undefined,
          message: action.designation,
          ts,
        }),
      };
      break;
    }
    case 'phase': {
      next = {
        ...next,
        phase: action.phase,
        events: pushEvent(next, {
          kind: 'phase',
          actorSeat: action.actorSeat,
          targetSeat: null,
          message: action.phase,
          ts,
        }),
      };
      break;
    }
  }

  // Apply auto-elimination + auto-win only while the game is in progress so
  // that a 'reset' or a lobby tweak doesn't immediately flip the game to
  // finished. The reducer leaves elimination flags as the user (or the player
  // themselves) set them; loss conditions are *additive*, never reviving.
  if (next.status === 'active') {
    const elim = maybeAutoEliminate(next);
    if (elim.auto.length > 0) {
      let withEvents = elim.state;
      for (const seat of elim.auto) {
        withEvents = {
          ...withEvents,
          events: pushEvent(withEvents, {
            kind: 'eliminate',
            actorSeat: null,
            targetSeat: seat,
            message: 'auto',
            ts,
          }),
        };
      }
      next = withEvents;
    }
    next = maybeAutoWin(next);
  }

  return {
    ...next,
    updatedAt: ts,
    version: prev.version + 1,
  };
}

/**
 * Convert a finished game into a compact record for per-user history.
 * Keeps just enough to render history rows and aggregate per-deck W/L.
 */
export interface GameRecord {
  id: string;
  code: string;
  format: GameFormat;
  startingLife: number;
  players: {
    seat: number;
    userId: string | null;
    name: string;
    deckId: string | null;
    deckName: string | null;
    commander: string | null;
    finalLife: number;
    eliminated: boolean;
  }[];
  winnerSeat: number | null;
  startedAt: number | null;
  endedAt: number;
  durationMs: number;
  mode: 'local' | 'online';
  /**
   * Derived stats, computed once here so history rollups never re-walk a log
   * the record doesn't even carry. **Optional by design**: records written
   * before this field read as `undefined` — "no data captured" — and must
   * never be coerced to a zeroed summary, which is indistinguishable from a
   * genuinely uneventful game. Same discipline as `game_results.notable_events`.
   */
  summary?: GameSummary;
}

export function gameToRecord(state: GameState, endedAt: number = Date.now()): GameRecord {
  return {
    id: state.id,
    code: state.code,
    format: state.format,
    startingLife: state.startingLife,
    players: state.players.map((p) => ({
      seat: p.seat,
      userId: p.userId,
      name: p.name,
      deckId: p.deckId,
      deckName: p.deckName,
      commander: p.commander,
      finalLife: p.life,
      eliminated: p.eliminated,
    })),
    winnerSeat: state.winnerSeat,
    startedAt: state.startedAt,
    endedAt,
    durationMs: state.startedAt ? endedAt - state.startedAt : 0,
    mode: state.mode,
    summary: summarizeGame(state, endedAt),
  };
}

const MAX_NOTABLE_EVENTS = 20;
const NOTABLE_KINDS: ReadonlySet<GameEvent['kind']> = new Set(['eliminate', 'end', 'designation']);

/** Categorical, deterministic filter over a finished game's log — the events
 *  worth surfacing in a public recap. No free-text kinds (see 'note'
 *  exclusion). Preserves chronological order; keeps the most recent
 *  MAX_NOTABLE_EVENTS if more qualify, so a pathological game with hundreds
 *  of eliminations/designation-flips doesn't bloat the persisted row. */
export function selectNotableEvents(events: GameEvent[]): GameEvent[] {
  const notable = events.filter((e) => NOTABLE_KINDS.has(e.kind));
  return notable.length > MAX_NOTABLE_EVENTS ? notable.slice(-MAX_NOTABLE_EVENTS) : notable;
}

// Derived per-game statistics (first blood, placements, damage, KO credit).
// One-directional at runtime: `summary.ts` imports only *types* from here, so
// nothing requires back into this module.
export * from './summary';
