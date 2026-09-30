import crypto from 'crypto';
import {
  GAME_PHASES,
  HORDE_MAX_SEATS,
  type GameAction,
  type GamePlayer,
  type GameState,
  type HordeRevealMode,
  type HordeSettings,
  type HordeStep,
} from './state';
import { isParticipant } from './live-registry';

const VALID_COLORS = new Set(['W', 'U', 'B', 'R', 'G']);
const VALID_PANEL_KEYS = new Set(['W', 'U', 'B', 'R', 'G', 'M', 'C']);
export function sanitizeColorIdentity(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const up = v.toUpperCase();
    if (VALID_COLORS.has(up) && !out.includes(up)) out.push(up);
  }
  return out;
}
/** Whitelist panel color override; anything else falls back to auto (null). */
function sanitizePanelColorKey(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw !== 'string') return null;
  const up = raw.toUpperCase();
  return VALID_PANEL_KEYS.has(up) ? up : null;
}

const VALID_BRACKETS = new Set([1, 2, 3, 4, 5]);
/**
 * Whitelist a client-computed bracket (board E370): the server trusts the
 * NUMBER, never the reasoning behind it — the deck itself, and the tag data
 * the estimator needs, only ever live on the seat's own device (see
 * `packages/deck-metrics`'s TagLookup injection: that data is null
 * server-side, so the server cannot verify this itself). Anything outside
 * 1-5 falls back to null, same as an unset bracket.
 */
export function sanitizeBracket(raw: unknown): 1 | 2 | 3 | 4 | 5 | null {
  if (typeof raw !== 'number' || !VALID_BRACKETS.has(raw)) return null;
  return raw as 1 | 2 | 3 | 4 | 5;
}

type UpdatePlayerPatch = Extract<GameAction, { type: 'update-player' }>['patch'];

/** Mirrors the create/join paths' name cap (40) for the free-text table note. */
const MAX_NOTE_MESSAGE_LEN = 500;

/**
 * Rebuild an `add-player` action's `player` through the same normalization
 * the join path (`POST /:code/join`) applies, rather than trusting the
 * host's body verbatim — otherwise an unbounded `name`, a raw
 * `colorIdentity`, or a forged `isHost`/`connected`/`commanderDamage` would
 * land in `game_sessions.state` and get re-broadcast on every subsequent
 * push. `seat`/`life` are validated numeric by `numericFieldError` before
 * this runs, so they're trusted here. `userId` is passed through as-is
 * (string or null) — a host-added guest legitimately has no `userId`.
 */
function sanitizeAddedPlayer(raw: GamePlayer): GamePlayer {
  const r = raw as unknown as Record<string, unknown>;
  const name =
    typeof r.name === 'string' && r.name.trim().length > 0 ? r.name.trim().slice(0, 40) : 'Player';
  return {
    id:
      typeof r.id === 'string' && r.id.trim().length > 0 ? r.id.slice(0, 100) : crypto.randomUUID(),
    userId: typeof r.userId === 'string' ? r.userId : null,
    seat: raw.seat,
    name,
    deckId: typeof r.deckId === 'string' ? r.deckId : null,
    deckName: typeof r.deckName === 'string' ? r.deckName : null,
    commander: typeof r.commander === 'string' ? r.commander : null,
    partner: typeof r.partner === 'string' ? r.partner : null,
    colorIdentity: sanitizeColorIdentity(r.colorIdentity),
    panelColorKey: sanitizePanelColorKey(r.panelColorKey),
    bracket: sanitizeBracket(r.bracket),
    life: raw.life,
    poison: 0,
    commanderDamage: {},
    eliminated: false,
    isHost: false,
    connected: true,
  };
}

/** 1-40 lowercase alphanumeric/hyphen — the host's own deck/table slug, never rendered as HTML. */
const HORDE_ID_RE = /^[a-z0-9-]{1,40}$/;

/**
 * Rebuild a claimed `HordeRevealMode` field by field, or null if it names an
 * unknown `kind` or a field outside its bounds. Mirrors the union in
 * `packages/game-core` exactly — see `HordeRevealMode`'s doc there.
 */
function sanitizeHordeReveal(raw: unknown): HordeRevealMode | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case 'until-nontoken':
      return { kind: 'until-nontoken' };
    case 'waves': {
      const perTurn = r.perTurn;
      if (!Number.isInteger(perTurn) || (perTurn as number) < 1 || (perTurn as number) > 10) {
        return null;
      }
      return { kind: 'waves', perTurn: perTurn as number };
    }
    case 'waves-pattern': {
      const pattern = r.pattern;
      if (!Array.isArray(pattern) || pattern.length < 1 || pattern.length > 12) return null;
      const clean: number[] = [];
      for (const p of pattern) {
        if (!Number.isInteger(p) || (p as number) < 1 || (p as number) > 10) return null;
        clean.push(p as number);
      }
      return { kind: 'waves-pattern', pattern: clean };
    }
    case 'fixed': {
      const count = r.count;
      if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 20) return null;
      return {
        kind: 'fixed',
        count: count as number,
        ...(r.plusPerArtifact !== undefined ? { plusPerArtifact: r.plusPerArtifact === true } : {}),
      };
    }
    default:
      return null;
  }
}

/**
 * Rebuild a claimed `HordeSettings` field by field — the settings a
 * `horde-setup` action resolves once, on the host's device, and every other
 * client then trusts verbatim out of the persisted log. Returns null on the
 * first out-of-range or malformed field.
 */
function sanitizeHordeSettings(raw: unknown): HordeSettings | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const survivors = r.survivors;
  if (!Number.isInteger(survivors) || (survivors as number) < 1 || (survivors as number) > 4) {
    return null;
  }
  const life = r.life;
  if (!Number.isInteger(life) || (life as number) < 1 || (life as number) > 999) return null;
  const librarySize = r.librarySize;
  if (
    !Number.isInteger(librarySize) ||
    (librarySize as number) < 1 ||
    (librarySize as number) > 300
  ) {
    return null;
  }
  const setupTurns = r.setupTurns;
  if (!Number.isInteger(setupTurns) || (setupTurns as number) < 0 || (setupTurns as number) > 10) {
    return null;
  }
  const safeZone = r.safeZone;
  if (safeZone !== 'full' && safeZone !== 'reduced' && safeZone !== 'off') return null;
  const bossTicksRaw = r.bossTicks;
  if (!Array.isArray(bossTicksRaw) || bossTicksRaw.length > 8) return null;
  const bossTicks: number[] = [];
  for (const t of bossTicksRaw) {
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0 || t > 1) return null;
    bossTicks.push(t);
  }
  const reveal = sanitizeHordeReveal(r.reveal);
  if (!reveal) return null;
  return {
    survivors: survivors as number,
    life: life as number,
    librarySize: librarySize as number,
    setupTurns: setupTurns as number,
    reveal,
    bossTicks,
    safeZone,
  };
}

/**
 * Rebuild a claimed `HordeStep` field by field, keeping only the fields its
 * own `k` declares — mirrors the union in `packages/game-core` exactly.
 * Returns null for an unknown `k` or an out-of-range field.
 */
function sanitizeHordeStep(raw: unknown): HordeStep | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  switch (r.k) {
    case 'reveal':
      return { k: 'reveal' };
    case 'confirm':
      return { k: 'confirm' };
    case 'take': {
      const dealt = r.dealt;
      if (!Number.isInteger(dealt) || (dealt as number) < 0 || (dealt as number) > 999) return null;
      return { k: 'take', dealt: dealt as number };
    }
    case 'damage': {
      const n = r.n;
      if (!Number.isInteger(n) || (n as number) < 0 || (n as number) > 999) return null;
      return { k: 'damage', n: n as number };
    }
    case 'move': {
      const cardId = r.cardId;
      if (typeof cardId !== 'string' || cardId.length < 1 || cardId.length > 80) return null;
      const to = r.to;
      if (to !== 'graveyard' && to !== 'exile' && to !== 'library') return null;
      return { k: 'move', cardId, to };
    }
    default:
      return null;
  }
}

/**
 * Reject a malformed `horde-setup` action before it reaches `sanitizeAction`
 * — like `noteMessageError`/`invalidPhaseError`, a 400 rather than a silent
 * coercion, since there is no sane default for an invalid seed or level.
 */
export function invalidHordeSetupError(action: GameAction): string | null {
  if (action.type !== 'horde-setup') return null;
  if (!HORDE_ID_RE.test(action.hordeId as unknown as string)) return 'Invalid horde id.';
  if (action.level !== 'casual' && action.level !== 'standard' && action.level !== 'brutal') {
    return 'Invalid horde level.';
  }
  const seed = action.seed as unknown;
  if (!Number.isInteger(seed) || (seed as number) < 0 || (seed as number) > 4294967295) {
    return 'Invalid horde seed.';
  }
  const deckRev = action.deckRev as unknown;
  if (typeof deckRev !== 'string' || deckRev.length < 1 || deckRev.length > 64) {
    return 'Invalid deck revision.';
  }
  return sanitizeHordeSettings(action.settings) ? null : 'Invalid horde settings.';
}

/** Reject a malformed `horde-step` action — `step` is validated by kind, `at` must be a real log index. */
export function invalidHordeStepError(action: GameAction): string | null {
  if (action.type !== 'horde-step') return null;
  if (!Number.isInteger(action.at) || action.at < 0) return 'Invalid step index.';
  return sanitizeHordeStep(action.step) ? null : 'Invalid horde step.';
}

/**
 * Reject a malformed `reset` id. The id becomes the next game's
 * `game_results.session_id`, so it is a plain opaque token: 1-100 letters,
 * digits, `_` or `-` (a UUID, or the client's `game_<uuid>`). Absent is fine;
 * the table then keeps its id, as every reset did before.
 */
export function invalidResetIdError(action: GameAction): string | null {
  if (action.type !== 'reset' || action.id === undefined) return null;
  const id = action.id as unknown;
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id) ? null : 'Invalid game id.';
}

/** Reject a malformed `horde-undo` action — same `at` bound as `horde-step`. */
export function invalidHordeUndoError(action: GameAction): string | null {
  if (action.type !== 'horde-undo') return null;
  return Number.isInteger(action.at) && action.at >= 0 ? null : 'Invalid step index.';
}

/**
 * `end.coopOutcome` is meaningful only at a horde table (see the `GameAction`
 * doc in `packages/game-core`) — reject a malformed value outright, and
 * reject a well-formed one at any other format rather than letting the
 * reducer silently ignore it.
 */
export function invalidCoopOutcomeError(action: GameAction, state: GameState): string | null {
  if (action.type !== 'end' || action.coopOutcome === undefined) return null;
  if (action.coopOutcome !== 'won' && action.coopOutcome !== 'lost') return 'Invalid outcome.';
  return state.format === 'horde' ? null : 'coopOutcome is only valid for a horde table.';
}

/**
 * Horde seats at most `HORDE_MAX_SEATS` (4) — the two ways a batch could
 * push past that: the host seating a guest via `add-player`, or the host
 * switching an already-crowded table's format to `'horde'` via `settings`.
 * `POST /:code/join`'s own seat cap covers the third way (a self-service
 * join) directly at that route, since it never goes through this batch.
 */
export function invalidHordeSeatCapError(action: GameAction, state: GameState): string | null {
  if (action.type === 'add-player' && state.format === 'horde') {
    return state.players.length >= HORDE_MAX_SEATS ? 'This Horde table is full.' : null;
  }
  if (action.type === 'settings' && action.patch.format === 'horde') {
    return state.players.length > HORDE_MAX_SEATS ? 'A Horde table seats at most 4.' : null;
  }
  return null;
}

/**
 * Scrub user-controllable fields on actions before they hit the reducer.
 * The reducer is pure and trusts its inputs; the route is the place to
 * enforce that.
 *
 * For `update-player`, the reducer spreads `patch` onto the player wholesale
 * (`{ ...p, ...patch }`), so we must **whitelist** it to exactly the nine
 * declared fields — otherwise a participant could smuggle `userId`, `isHost`,
 * `life`, or `eliminated` into their own seat, and those land verbatim in the
 * permanent `game_results` row. Never widen this without matching the
 * `GameAction` `update-player` type. Also caps `name` at 40 chars, matching
 * the create/join paths.
 *
 * `note` is open to any participant and carries a free-text `message`, so it
 * gets the same length cap the rest of the file applies to free text
 * (`MAX_SUMMARY_LEN` for a request summary). `add-player` is host-only but
 * still untrusted input — see `sanitizeAddedPlayer`.
 */
export function sanitizeAction(action: GameAction): GameAction {
  if (action.type === 'update-player' && action.patch) {
    const raw = action.patch as Record<string, unknown>;
    const patch: UpdatePlayerPatch = {};
    if (typeof raw.name === 'string' && raw.name.trim().length > 0) {
      patch.name = raw.name.trim().slice(0, 40);
    }
    for (const f of ['deckId', 'deckName', 'commander', 'partner'] as const) {
      if (f in raw) patch[f] = typeof raw[f] === 'string' ? (raw[f] as string) : null;
    }
    if ('colorIdentity' in raw) patch.colorIdentity = sanitizeColorIdentity(raw.colorIdentity);
    if ('panelColorKey' in raw) patch.panelColorKey = sanitizePanelColorKey(raw.panelColorKey);
    if ('bracket' in raw) patch.bracket = sanitizeBracket(raw.bracket);
    if ('connected' in raw) patch.connected = raw.connected === true;
    return { ...action, patch };
  }
  if (action.type === 'note') {
    const message = typeof action.message === 'string' ? action.message : '';
    return { ...action, message: message.trim().slice(0, MAX_NOTE_MESSAGE_LEN) };
  }
  if (action.type === 'set-ready') {
    // Boolean-coerced rather than trusted: the reducer stores this verbatim,
    // so a `"no"` string would land in the JSONB row and read as truthy
    // everywhere. Only an explicit `true` counts as ready.
    return { ...action, ready: (action.ready as unknown) === true };
  }
  if (action.type === 'clock') {
    // Same coercion as `set-ready`, for the same reason: the reducer's
    // `isClockPaused` reads this field back verbatim from the log.
    return { ...action, paused: (action.paused as unknown) === true };
  }
  if (action.type === 'add-player' && action.player) {
    return { ...action, player: sanitizeAddedPlayer(action.player) };
  }
  if (action.type === 'settings' && typeof action.patch.name === 'string') {
    return {
      ...action,
      patch: { ...action.patch, name: action.patch.name.trim().slice(0, MAX_GAME_NAME_LEN) },
    };
  }
  // horde-setup/horde-step have already been through invalidHordeSetupError /
  // invalidHordeStepError by the time this runs, so the rebuild always
  // succeeds — the `!` mirrors that ordering, not a new assumption.
  if (action.type === 'horde-setup') {
    return { ...action, settings: sanitizeHordeSettings(action.settings)! };
  }
  if (action.type === 'horde-step') {
    return { ...action, step: sanitizeHordeStep(action.step)! };
  }
  if (action.type === 'horde-done') {
    // Same boolean-coercion reasoning as `set-ready`/`clock` above.
    return {
      ...action,
      done: (action.done as unknown) === true,
      ...(action.force !== undefined ? { force: (action.force as unknown) === true } : {}),
    };
  }
  return action;
}

/**
 * Reject actions carrying non-finite numeric fields before they reach the
 * reducer, which does raw arithmetic (e.g. `p.life + delta`). A string delta
 * like `"oops"` would otherwise stringify life (`"40oops"`) and permanently
 * defeat the `life <= 0` loss check. Returns an error string or null.
 */
export function numericFieldError(action: GameAction): string | null {
  const check = (v: unknown, field: string): string | null =>
    typeof v === 'number' && Number.isFinite(v) ? null : `Invalid ${field}.`;
  switch (action.type) {
    case 'life':
    case 'poison':
      return check(action.delta, 'delta');
    case 'set-life':
      return check(action.value, 'value');
    case 'cmd-dmg':
      return check(action.delta, 'delta') ?? check(action.fromSeat, 'fromSeat');
    case 'end':
      return action.winnerSeat === null ? null : check(action.winnerSeat, 'winnerSeat');
    case 'add-player':
      return check(action.player?.seat, 'player.seat') ?? check(action.player?.life, 'player.life');
    default:
      return null;
  }
}

/**
 * Reject a `note` action whose `message` isn't a string, before it reaches
 * `sanitizeAction` (which only caps a string's length — it can't coerce a
 * missing/malformed one into something meaningful).
 */
export function noteMessageError(action: GameAction): string | null {
  if (action.type !== 'note') return null;
  return typeof action.message === 'string' ? null : 'Invalid message.';
}

/**
 * Reject a `phase` action whose value isn't one of the exported `GamePhase`
 * list — the reducer sets it verbatim with no validation of its own (see
 * `packages/game-core`), so the route is the only place this is checked.
 */
/**
 * The table's voice link: the invite to its Discord table (POST /:code/discord
 * returns it and the client stores it here). The reducer stores whatever it
 * is handed (see `packages/game-core`), so this route is the only place it is
 * checked — same division of labour as `phase` below.
 *
 * Discord or nothing: only a `https://discord.gg/<code>` invite, the shape
 * discord.ts builds. The string is rendered as a link every other seat can
 * click, so anything looser is one player handing the pod a link of their
 * choosing (a `javascript:` URL at worst). Clearing it back to null is always
 * allowed.
 */
const DISCORD_INVITE = /^https:\/\/discord\.gg\/[A-Za-z0-9-]{2,64}$/;

export function invalidVoiceUrlError(action: GameAction): string | null {
  if (action.type !== 'settings') return null;
  const url = action.patch.voiceUrl;
  if (url === undefined || url === null || url === '') return null;
  if (typeof url !== 'string' || !DISCORD_INVITE.test(url)) {
    return 'A table’s voice link has to be its Discord invite.';
  }
  return null;
}

export function invalidPhaseError(action: GameAction): string | null {
  if (action.type !== 'phase') return null;
  return (GAME_PHASES as readonly string[]).includes(action.phase) ? null : 'Invalid phase.';
}

/**
 * Reject a `visibility` patch that isn't exactly `'public'`, `'friends'` or
 * `'private'` — the reducer stores it verbatim (see `packages/game-core`),
 * so, like `phase` and the voice link above, this route is the only place it
 * is checked.
 */
export function invalidVisibilityError(action: GameAction): string | null {
  if (action.type !== 'settings') return null;
  const visibility = action.patch.visibility;
  if (visibility === undefined) return null;
  return visibility === 'public' || visibility === 'friends' || visibility === 'private'
    ? null
    : 'Invalid visibility.';
}

/**
 * Reject a `turnOrder` patch that isn't exactly `'clockwise'` or
 * `'counterclockwise'` — the reducer stores it verbatim (see
 * `packages/game-core`), same division of labour as `visibility` above.
 */
export function invalidTurnOrderError(action: GameAction): string | null {
  if (action.type !== 'settings') return null;
  const turnOrder = action.patch.turnOrder;
  if (turnOrder === undefined) return null;
  return turnOrder === 'clockwise' || turnOrder === 'counterclockwise'
    ? null
    : 'Invalid turn order.';
}

/** Longest a table name may be — a lobby heading, not a paragraph. */
export const MAX_GAME_NAME_LEN = 60;

export function invalidNameError(action: GameAction): string | null {
  if (action.type !== 'settings') return null;
  const name = action.patch.name;
  if (name === undefined) return null;
  return typeof name === 'string' ? null : 'Invalid name.';
}

export function actionIsAllowed(
  action: GameAction,
  state: GameState,
  userId: string
): string | null {
  const isHost = state.hostUserId === userId;

  // Per-device online surface: each player adjusts only their own seat's
  // life/poison/commander-damage — even the host, who otherwise has an
  // admin monopoly on start/reset/settings/add-player/remove-player. Runs
  // before the isHost bypass below so it also constrains the host. Carve-out:
  // a host-added guest seat (no userId) has no device of its own, so anyone
  // seated may adjust it rather than bricking it.
  switch (action.type) {
    case 'life':
    case 'set-life':
    case 'poison':
    case 'cmd-dmg': {
      const target = state.players.find((p) => p.seat === action.seat);
      if (target && target.userId !== userId && target.userId !== null) {
        return 'Can only adjust your own seat.';
      }
      break;
    }
    // Readiness is a statement about yourself: nobody — host included — marks
    // another player ready. Enforced here, before the isHost bypass, because
    // the reducer trusts `actorSeat` outright. A host-added guest seat (no
    // userId, no device of its own) stays adjustable by any seated player,
    // same carve-out as the life controls above.
    case 'set-ready': {
      const target = state.players.find((p) => p.seat === action.actorSeat);
      if (target && target.userId !== userId && target.userId !== null) {
        return 'Can only ready your own seat.';
      }
      break;
    }
    // horde-done is the horde table's own "statement about yourself" — same
    // shape and same guest carve-out as set-ready above, just ending the
    // caller's own team turn instead of flipping a ready flag.
    case 'horde-done': {
      const target = state.players.find((p) => p.seat === action.actorSeat);
      if (target && target.userId !== userId && target.userId !== null) {
        return 'Can only end your own turn.';
      }
      break;
    }
    // horde-step/horde-undo: any seated survivor may act, but `actorSeat` is
    // attribution in the replayable log, not just a UI label, so it must be
    // the caller's own seat — no guest carve-out (unlike the cases above): a
    // host-added guest has no device to dispatch a horde step from at all.
    case 'horde-step':
    case 'horde-undo': {
      const target = state.players.find((p) => p.seat === action.actorSeat);
      if (target && target.userId !== userId) {
        return 'Can only act as your own seat.';
      }
      break;
    }
    default:
      break;
  }

  // Host can do anything else. Other authed participants can do gameplay
  // actions (life, poison, cmd-dmg, eliminate, note, update-player for their
  // own seat, and end). They can't add/remove other players, reseat the table
  // (which rewrites every seat number), change settings, reset, or start the
  // game — those are host-only.
  if (isHost) return null;
  if (!isParticipant(state, userId)) return 'Not a participant.';

  switch (action.type) {
    case 'start':
    case 'reset':
    case 'settings':
    case 'add-player':
    case 'remove-player':
    case 'reseat':
    case 'horde-setup':
    case 'transfer-host':
      return 'Host only.';
    case 'update-player': {
      const target = state.players.find((p) => p.seat === action.seat);
      if (!target) return 'No such seat.';
      if (target.userId !== userId) return 'Can only update your own seat.';
      return null;
    }
    default:
      return null;
  }
}
