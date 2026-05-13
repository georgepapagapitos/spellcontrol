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
  life: number;
  poison: number;
  /** Commander damage taken from each opponent seat. */
  commanderDamage: Record<number, number>;
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
    | 'settings';
  actorSeat: number | null;
  targetSeat: number | null;
  delta?: number;
  fromSeat?: number;
  message?: string;
}

export type GameStatus = 'lobby' | 'active' | 'finished';

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
      patch: Partial<Pick<GamePlayer, 'name' | 'deckId' | 'deckName' | 'commander' | 'connected'>>;
      ts?: number;
    }
  | { type: 'life'; seat: number; delta: number; actorSeat: number | null; ts?: number }
  | { type: 'set-life'; seat: number; value: number; actorSeat: number | null; ts?: number }
  | { type: 'poison'; seat: number; delta: number; actorSeat: number | null; ts?: number }
  | {
      type: 'cmd-dmg';
      seat: number;
      fromSeat: number;
      delta: number;
      actorSeat: number | null;
      ts?: number;
    }
  | { type: 'eliminate'; seat: number; eliminated: boolean; ts?: number }
  | { type: 'note'; actorSeat: number | null; message: string; ts?: number }
  | {
      type: 'settings';
      patch: Partial<
        Pick<GameState, 'startingLife' | 'commanderDamageEnabled' | 'poisonEnabled' | 'format'>
      >;
      ts?: number;
    };

const MAX_EVENTS = 500;

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

function checkLossConditions(player: GamePlayer, state: GameState): boolean {
  if (player.eliminated) return true;
  if (player.life <= 0) return true;
  if (state.poisonEnabled && player.poison >= 10) return true;
  if (state.commanderDamageEnabled) {
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
  let next: GameState = { ...prev };

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
      next = {
        ...next,
        status: 'finished',
        winnerSeat: action.winnerSeat,
        endedAt: ts,
        events: pushEvent(next, {
          kind: 'end',
          actorSeat: null,
          targetSeat: action.winnerSeat,
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
      const target = prev.players.find((p) => p.seat === action.seat);
      if (!target) throw new Error(`No player at seat ${action.seat}.`);
      next = {
        ...next,
        players: prev.players.filter((p) => p.seat !== action.seat),
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
      const target = prev.players.find((p) => p.seat === action.seat);
      if (!target) throw new Error(`No player at seat ${action.seat}.`);
      next = {
        ...next,
        players: updatePlayer(next, action.seat, (p) => ({ ...p, ...action.patch })),
      };
      break;
    }
    case 'life': {
      if (!prev.players.some((p) => p.seat === action.seat)) {
        throw new Error(`No player at seat ${action.seat}.`);
      }
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
      if (!prev.players.some((p) => p.seat === action.seat)) {
        throw new Error(`No player at seat ${action.seat}.`);
      }
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
      if (!prev.players.some((p) => p.seat === action.seat)) {
        throw new Error(`No player at seat ${action.seat}.`);
      }
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
      if (!prev.players.some((p) => p.seat === action.seat)) {
        throw new Error(`No player at seat ${action.seat}.`);
      }
      next = {
        ...next,
        players: updatePlayer(next, action.seat, (p) => {
          const cur = p.commanderDamage[action.fromSeat] ?? 0;
          const nextDmg = Math.max(0, cur + action.delta);
          return {
            ...p,
            commanderDamage: { ...p.commanderDamage, [action.fromSeat]: nextDmg },
            // Commander damage also reduces life by the same amount.
            life: p.life - action.delta,
          };
        }),
        events: pushEvent(next, {
          kind: 'cmd-dmg',
          actorSeat: action.actorSeat,
          targetSeat: action.seat,
          fromSeat: action.fromSeat,
          delta: action.delta,
          ts,
        }),
      };
      break;
    }
    case 'eliminate': {
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
      next = {
        ...next,
        ...patch,
        // Re-base life only in lobby. Once active, settings tweaks don't retro-edit life.
        players:
          startingLifeChanged && prev.status === 'lobby'
            ? prev.players.map((p) => ({ ...p, life: patch.startingLife! }))
            : prev.players,
        events: pushEvent(next, {
          kind: 'settings',
          actorSeat: null,
          targetSeat: null,
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
  };
}
