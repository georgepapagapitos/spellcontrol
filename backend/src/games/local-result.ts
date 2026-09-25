import { createGameState, makePlayer } from './state';
import type { GameEvent, GameFormat, GamePlayer, GameState, TurnOrder } from './state';
import { VALID_FORMATS } from '../routes/games';

/**
 * Rebuild a finished LOCAL game from an untrusted POST body into a `GameState`
 * the shared row builder can consume.
 *
 * A local game is tracked on one device and the server never saw it happen,
 * so the recorder's device is the only witness — the same trust Mythic-style
 * trackers extend. What the server does enforce is *shape* and *size*: every
 * field the row builder or `summarizeGame` reads is typed and capped here,
 * nothing is spread through verbatim, and the whole body is bounded so a
 * single result can't carry an unbounded log. Which accounts may be credited
 * is checked by the route (recorder + accepted friends), not here.
 */

export const MAX_LOCAL_RESULT_BYTES = 256 * 1024;
const MAX_PLAYERS = 10;
const MIN_PLAYERS = 2;
// Horde is co-op: 1-4 survivors sharing one life total against a self-running
// horde deck, so its player-count band is its own rather than PvP's 2-8.
const HORDE_MIN_PLAYERS = 1;
const HORDE_MAX_PLAYERS = 4;
const MAX_EVENTS = 5000;
const MAX_NAME_LEN = 40;
const MAX_LABEL_LEN = 200;
const MAX_NOTE_LEN = 500;
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const VALID_COLORS = new Set(['W', 'U', 'B', 'R', 'G']);
const EVENT_KINDS: ReadonlySet<string> = new Set<GameEvent['kind']>([
  'life',
  'set-life',
  'poison',
  'cmd-dmg',
  'eliminate',
  'revive',
  'note',
  'join',
  'leave',
  'start',
  'end',
  'reset',
  'settings',
  'turn',
  'designation',
  'phase',
  'counter',
  'clock',
]);

type Rec = Record<string, unknown>;

function isRec(x: unknown): x is Rec {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
function isInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x);
}
function optStr(x: unknown, max: number): string | null {
  return typeof x === 'string' && x.length > 0 ? x.slice(0, max) : null;
}
function colors(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const up = v.toUpperCase();
    if (VALID_COLORS.has(up) && !out.includes(up)) out.push(up);
  }
  return out;
}

export type LocalResultParse = { ok: true; state: GameState } | { ok: false; error: string };

export function parseLocalResult(body: unknown): LocalResultParse {
  if (!isRec(body) || !isRec(body.game)) return { ok: false, error: 'game is required.' };
  const g = body.game;

  if (typeof g.id !== 'string' || !ID_RE.test(g.id)) return { ok: false, error: 'Bad game id.' };
  if (g.mode !== 'local') return { ok: false, error: 'Only local games can be posted here.' };
  if (g.status !== 'finished') return { ok: false, error: 'Only a finished game can be recorded.' };
  if (typeof g.format !== 'string' || !VALID_FORMATS.includes(g.format as GameFormat)) {
    return { ok: false, error: 'Unknown format.' };
  }
  const isHorde = g.format === 'horde';
  if (!isInt(g.startingLife) || g.startingLife < 1 || g.startingLife > 999) {
    return { ok: false, error: 'Bad starting life.' };
  }
  if (!isInt(g.endedAt) || g.endedAt <= 0) return { ok: false, error: 'endedAt is required.' };
  const startedAt =
    isInt(g.startedAt) && g.startedAt > 0 && g.startedAt <= g.endedAt ? g.startedAt : null;
  const startingSeat = isInt(g.startingSeat) ? g.startingSeat : null;
  // Which way the table sat. Absent means clockwise (see GameState.turnOrder's
  // own convention) — anything present that isn't exactly one of the two
  // values is rejected, same as the online settings-action guard in
  // routes/games.ts (invalidTurnOrderError).
  let turnOrder: TurnOrder | undefined;
  if (g.turnOrder !== undefined) {
    if (g.turnOrder !== 'clockwise' && g.turnOrder !== 'counterclockwise') {
      return { ok: false, error: 'Invalid turn order.' };
    }
    turnOrder = g.turnOrder;
  }

  const minPlayers = isHorde ? HORDE_MIN_PLAYERS : MIN_PLAYERS;
  const maxPlayers = isHorde ? HORDE_MAX_PLAYERS : MAX_PLAYERS;
  if (!Array.isArray(g.players) || g.players.length < minPlayers || g.players.length > maxPlayers) {
    return {
      ok: false,
      error: isHorde
        ? `A horde game has ${HORDE_MIN_PLAYERS} to ${HORDE_MAX_PLAYERS} survivors.`
        : `A game has ${MIN_PLAYERS} to ${MAX_PLAYERS} players.`,
    };
  }
  const seats = new Set<number>();
  const players: GamePlayer[] = [];
  for (const raw of g.players) {
    if (!isRec(raw)) return { ok: false, error: 'Bad player.' };
    if (!isInt(raw.seat) || raw.seat < 0 || raw.seat >= MAX_PLAYERS || seats.has(raw.seat)) {
      return { ok: false, error: 'Bad seat.' };
    }
    seats.add(raw.seat);
    const name =
      typeof raw.name === 'string' && raw.name.trim().length > 0
        ? raw.name.trim().slice(0, MAX_NAME_LEN)
        : `Player ${raw.seat + 1}`;
    if (!isInt(raw.life)) return { ok: false, error: 'Bad life total.' };
    const cmd: Record<string, number> = {};
    if (isRec(raw.commanderDamage)) {
      for (const [k, v] of Object.entries(raw.commanderDamage)) {
        if (isInt(v) && v >= 0 && k.length <= 8) cmd[k] = v;
      }
    }
    const player = makePlayer({
      id:
        typeof raw.id === 'string' && raw.id.length > 0
          ? raw.id.slice(0, 100)
          : `local_${raw.seat}`,
      userId:
        typeof raw.userId === 'string' && raw.userId.length > 0 ? raw.userId.slice(0, 100) : null,
      seat: raw.seat,
      name,
      deckId: optStr(raw.deckId, 100),
      deckName: optStr(raw.deckName, MAX_LABEL_LEN),
      commander: optStr(raw.commander, MAX_LABEL_LEN),
      partner: optStr(raw.partner, MAX_LABEL_LEN),
      colorIdentity: colors(raw.colorIdentity),
      startingLife: g.startingLife,
      isHost: raw.seat === 0,
    });
    player.life = raw.life;
    player.poison = isInt(raw.poison) && raw.poison >= 0 ? raw.poison : 0;
    player.commanderDamage = cmd;
    player.eliminated = raw.eliminated === true;
    players.push(player);
  }
  players.sort((a, b) => a.seat - b.seat);

  let winnerSeat: number | null = null;
  if (g.winnerSeat != null) {
    if (!isInt(g.winnerSeat) || !seats.has(g.winnerSeat)) {
      return { ok: false, error: 'winnerSeat is not a seat in this game.' };
    }
    winnerSeat = g.winnerSeat;
  }

  // Horde is co-op: the table wins or loses together, so there is no winning
  // seat — the outcome is `coopOutcome` instead, and it is required.
  let coopOutcome: 'won' | 'lost' | undefined;
  let hordeId: string | undefined;
  if (isHorde) {
    if (winnerSeat !== null) {
      return { ok: false, error: 'A horde game has no winning seat.' };
    }
    if (g.coopOutcome !== 'won' && g.coopOutcome !== 'lost') {
      return { ok: false, error: 'A horde game needs a won or lost outcome.' };
    }
    coopOutcome = g.coopOutcome;
    hordeId = optStr(g.hordeId, MAX_LABEL_LEN) ?? undefined;
  }

  const rawEvents = Array.isArray(g.events) ? g.events : [];
  if (rawEvents.length > MAX_EVENTS) return { ok: false, error: 'Too many events.' };
  const events: GameEvent[] = [];
  for (const raw of rawEvents) {
    if (!isRec(raw) || typeof raw.kind !== 'string' || !isInt(raw.ts)) {
      return { ok: false, error: 'Bad event.' };
    }
    if (!EVENT_KINDS.has(raw.kind)) return { ok: false, error: 'Bad event.' };
    // Exactly the declared `GameEvent` fields — nothing else survives, so a
    // stray key can't ride into the summary or a future recap.
    const e: GameEvent = {
      id: typeof raw.id === 'string' ? raw.id.slice(0, 100) : `evt_${events.length}`,
      ts: raw.ts,
      kind: raw.kind as GameEvent['kind'],
      actorSeat: isInt(raw.actorSeat) ? raw.actorSeat : null,
      targetSeat: isInt(raw.targetSeat) ? raw.targetSeat : null,
    };
    if (isInt(raw.delta)) e.delta = raw.delta;
    if (isInt(raw.fromSeat)) e.fromSeat = raw.fromSeat;
    if (raw.fromPartner === true) e.fromPartner = true;
    if (raw.undo === true) e.undo = true;
    if (raw.undone === true) e.undone = true;
    if (typeof raw.paused === 'boolean') e.paused = raw.paused;
    if (typeof raw.message === 'string') e.message = raw.message.slice(0, MAX_NOTE_LEN);
    events.push(e);
  }

  const base = createGameState({
    id: g.id,
    code: '',
    mode: 'local',
    hostUserId: null,
    format: g.format as GameFormat,
    startingLife: g.startingLife,
    commanderDamageEnabled: g.commanderDamageEnabled !== false,
    poisonEnabled: g.poisonEnabled === true,
    turnOrder,
    players,
    ts: startedAt ?? g.endedAt,
  });
  return {
    ok: true,
    state: {
      ...base,
      status: 'finished',
      startingSeat,
      events,
      winnerSeat,
      startedAt,
      endedAt: g.endedAt,
      updatedAt: g.endedAt,
      ...(coopOutcome !== undefined ? { coopOutcome } : {}),
      ...(hordeId !== undefined ? { hordeId } : {}),
    },
  };
}

/**
 * A correction to an already-recorded LOCAL result: who actually won, and
 * which deck each seat was actually playing. Both are things a recorder
 * routinely gets wrong in the moment (a mistapped seat, a deck nobody
 * attached), and before this the only repair was deleting the game and
 * losing it.
 *
 * Deliberately narrow. Life totals, elimination, timings and the event log
 * are what the device WITNESSED; rewriting those after the fact would turn
 * the record into free-form fiction. The winner and the deck labels are
 * attribution, which is exactly the part a human enters by hand.
 */
export interface ResultEditDeck {
  deckId: string | null;
  deckName: string | null;
  commander: string | null;
  colorIdentity: string[];
}

export interface ResultEdit {
  /** Seat that won, or null for "no winner recorded". */
  winnerSeat: number | null;
  /** Per-seat deck attribution. A seat the map omits keeps what it had. */
  decks: Map<number, ResultEditDeck>;
}

export type ResultEditParse = { ok: true; edit: ResultEdit } | { ok: false; error: string };

export function parseResultEdit(body: unknown): ResultEditParse {
  if (!isRec(body)) return { ok: false, error: 'Nothing to change.' };

  let winnerSeat: number | null = null;
  if (body.winnerSeat !== null && body.winnerSeat !== undefined) {
    if (!isInt(body.winnerSeat) || body.winnerSeat < 0 || body.winnerSeat >= MAX_PLAYERS) {
      return { ok: false, error: 'That seat is not in this game.' };
    }
    winnerSeat = body.winnerSeat;
  }

  const decks: ResultEdit['decks'] = new Map();
  if (body.decks !== undefined) {
    if (!Array.isArray(body.decks) || body.decks.length > MAX_PLAYERS) {
      return { ok: false, error: 'Bad deck list.' };
    }
    for (const raw of body.decks) {
      if (!isRec(raw) || !isInt(raw.seat) || raw.seat < 0 || raw.seat >= MAX_PLAYERS) {
        return { ok: false, error: 'That seat is not in this game.' };
      }
      if (decks.has(raw.seat)) return { ok: false, error: 'A seat can appear only once.' };
      decks.set(raw.seat, {
        deckId: optStr(raw.deckId, 100),
        deckName: optStr(raw.deckName, MAX_LABEL_LEN),
        commander: optStr(raw.commander, MAX_LABEL_LEN),
        colorIdentity: colors(raw.colorIdentity),
      });
    }
  }

  return { ok: true, edit: { winnerSeat, decks } };
}
