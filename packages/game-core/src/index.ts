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
 * per-seat rotations. The mapping lives in the client-side layout registry —
 * the server only persists the id. Rotations are 0°, 90°, 180° or 270°: the
 * `*-sides` layouts (e.g. `4p-sides`) seat players along the left and right
 * edges of a device lying flat, so those panels genuinely read sideways.
 * Anything positioning itself against a seat must handle all four.
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
 * Which way seats come around the table, clockwise being the MTG default
 * (the player on your left takes the turn after you). This only reorders
 * where each seat index is DRAWN on the board (see the frontend's
 * `board-layouts.ts`) — the reducer's own turn order (seat index + 1, below)
 * never changes, so a table seated counterclockwise still just needs its
 * preset layout's seats reversed (seat 0 stays put, the rest run backward),
 * and the existing seat-index pass-turn already reads as going the other way
 * around a reversed board.
 */
export type TurnOrder = 'clockwise' | 'counterclockwise';

/**
 * How the table takes mulligans. Three real variants, and every one of them is
 * just "how many cards go to the bottom after the Nth mulligan":
 * - `commander` — the first mulligan is free, then London. The Commander
 *   default, and this table's default.
 * - `london` — bottom N after N mulligans, from the first one.
 * - `free` — every mulligan redraws a full seven, nothing owed.
 */
export type MulliganType = 'commander' | 'london' | 'free';

export const MULLIGAN_TYPES: readonly MulliganType[] = ['commander', 'london', 'free'];

/** How many cards this variant owes the bottom after `count` mulligans. The
 *  one place the three variants differ, shared by the table and the solo
 *  playtest board so they can't drift. */
export function cardsToBottom(type: MulliganType, count: number): number {
  if (type === 'free' || count <= 0) return 0;
  return type === 'commander' ? Math.max(0, count - 1) : count;
}

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
  | 'casual'
  /**
   * Co-op: 1-4 survivors sharing one life total against a self-running horde
   * deck. There is no winning seat — `winnerSeat` stays null and the outcome
   * lives in `GameState.coopOutcome` instead. See that field's doc.
   */
  | 'horde';

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
  /**
   * This seat's Commander bracket (1-5), computed CLIENT-SIDE from the seated
   * deck (the device that owns the deck runs the estimator; the server never
   * sees a deck's cards). Null/absent means "no known bracket" — no deck
   * seated yet, a non-Commander deck, or a deck whose estimate hasn't been
   * computed on its owner's device — and must render as a neutral state,
   * never a guess. Display only, like `commander`/`partner`.
   *
   * OPTIONAL by design, same as `ready`: every row written before this field
   * existed reads `undefined`, which means exactly what `null` means, so
   * nothing needed migrating.
   */
  bracket?: 1 | 2 | 3 | 4 | 5 | null;
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
  /**
   * Free-form named counters for this seat — energy, experience, rad, tickets,
   * a token count, whatever the table is actually tracking. Deliberately
   * untyped beyond `name -> count`: the whole point is that a pod never waits
   * on us to ship a specific counter.
   *
   * OPTIONAL by design: every persisted row written before this field reads as
   * `undefined`, which means "this seat has no counters" — identical in
   * meaning to `{}`, so nothing needed migrating. Read it through
   * `seatCounters()` rather than dereferencing it.
   *
   * Never a loss condition. Poison and commander damage kill; a counter named
   * "poison" by a user does not, because the reducer must not infer rules from
   * a free-text label.
   */
  counters?: Record<string, number>;
  eliminated: boolean;
  isHost: boolean;
  /** Server-set presence flag for online games. Local games leave this true. */
  connected: boolean;
  /**
   * Lobby readiness — "I have my deck, go whenever you like". Advisory: it
   * never blocks `start` (the host still decides), it just tells the table
   * who is still shuffling.
   *
   * OPTIONAL by design: every `game_sessions.state` row written before this
   * field reads `undefined`, which means exactly what `false` means, so
   * nothing needed migrating. Read it as `p.ready === true`. Cleared on
   * `start` and `reset` — last game's readiness says nothing about this one.
   */
  ready?: boolean;
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
    | 'phase'
    | 'counter'
    | 'clock';
  actorSeat: number | null;
  targetSeat: number | null;
  delta?: number;
  fromSeat?: number;
  /** cmd-dmg only: the damage came from that seat's partner, not its primary. */
  fromPartner?: boolean;
  message?: string;
  /**
   * `clock` only: `true` for a pause, `false` for a resume. The table clock
   * has no field of its own on `GameState` — "is it paused right now" is a
   * fold over these events (see `isClockPaused`), the same design as
   * `activeSeat`'s turn history being a fold over `turn` events. A persisted
   * state with no `clock` events at all folds to "never paused" by
   * construction, so old rows need no migration.
   */
  paused?: boolean;
  /**
   * Set on a compensating event dispatched by Undo (see `GameAction.undoOf`).
   * The life/poison/damage it pins are real state; the *event* is bookkeeping
   * and must not read as a hit, a heal or a concession in any derived stat.
   */
  undo?: true;
  /**
   * Set on an event a later Undo reversed. Every consumer that derives a
   * story from the log — first blood, biggest hit, damage taken, the life
   * chart — skips these together with the `undo` events that cancelled them,
   * so a mis-tap that was taken back never becomes a fact about the game.
   */
  undone?: true;
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

/**
 * Horde mode: 1-4 survivors share one life total against a self-running horde
 * deck (no hand, no lands, no decisions — the app does bookkeeping). The
 * horde itself is never a seat anyone drives; game-core stores its resolved
 * settings, a seed, and an append-only LOG of horde steps, and every device
 * rebuilds the same horde board by replaying that log through the frontend's
 * horde engine. game-core never sees cards — a step names a card only by its
 * opaque id (`HordeStep`'s `move.cardId`).
 */

/** Horde mode difficulty presets (see docs/board.json E-horde / PR series). */
export type HordeLevel = 'casual' | 'standard' | 'brutal';

export type HordeRevealMode =
  /** Reveal until the first nontoken card, inclusive — one wave. */
  | { kind: 'until-nontoken' }
  /** That same wave, repeated `perTurn` times each horde turn. */
  | { kind: 'waves'; perTurn: number }
  /** Waves per horde turn, cycling through `pattern` by horde-turn index. */
  | { kind: 'waves-pattern'; pattern: number[] }
  /** Battle the Horde style: a flat count, +1 per horde artifact if set. */
  | { kind: 'fixed'; count: number; plusPerArtifact?: boolean };

export type HordeSafeZone = 'full' | 'reduced' | 'off';

export interface HordeSettings {
  /** 1..4. */
  survivors: number;
  /** Survivors' shared starting life. */
  life: number;
  /** Cards in this game's library — bosses are held out separately. */
  librarySize: number;
  /** Survivor turns before the horde's first turn. */
  setupTurns: number;
  reveal: HordeRevealMode;
  /** Fractions of the library gone at which a boss enters (1 = library empty). */
  bossTicks: number[];
  safeZone: HordeSafeZone;
}

/**
 * One step in the horde's replayable log. game-core only records WHAT
 * happened at the table-bookkeeping level — the frontend's horde engine (a
 * later lane) is what actually plans a reveal or resolves which cards a
 * `damage` step mills, using the seeded RNG + `deckRev`'d card list every
 * device already has.
 */
export type HordeStep =
  /** Start the horde's turn; the replay plans the reveal. */
  | { k: 'reveal' }
  /** The reveal goes onto the battlefield / spells to the graveyard. */
  | { k: 'confirm' }
  /** The attack resolved; lowers shared life. */
  | { k: 'take'; dealt: number }
  /** Survivors hit the horde; the replay mills and deals bosses. */
  | { k: 'damage'; n: number }
  | { k: 'move'; cardId: string; to: 'graveyard' | 'exile' | 'library' };

/** A logged `HordeStep`, stamped with who dispatched it and when. */
export type HordeLogEntry = HordeStep & { seat: number; ts: number };

export type HordePhase = 'survivors' | 'reveal' | 'combat';

export interface HordeTable {
  hordeId: string;
  level: HordeLevel;
  /** Resolved by the host's device at Start. */
  settings: HordeSettings;
  /** Rolled on the host's device at Start. */
  seed: number;
  /** Hash of the horde deck's data; a device with another rev must not
   *  replay this log against its own copy of the deck. */
  deckRev: string;
  phase: HordePhase;
  /** Team turns, 1-based. */
  survivorTurn: number;
  /** Horde turns taken, 0 before the first. */
  hordeTurn: number;
  /** Seats that have ended the current team turn. */
  done: number[];
  steps: HordeLogEntry[];
}

/** Bound on `HordeTable.steps` — same storage-bound reasoning as
 *  `MAX_COUNTERS_PER_SCOPE`: an online game's whole state is one JSONB row. */
export const MAX_HORDE_STEPS = 2000;

/** Seat cap for a horde table — 1-4 survivors, never more. */
export const HORDE_MAX_SEATS = 4;

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
  /** How this table mulligans. Defaults to 'commander'; legacy states resolve
   *  to it, which is what they already behaved as. */
  mulliganType: MulliganType;
  /** Whether the table shows how long the current turn has been running.
   *  A readout only — nothing expires, nobody is forced to pass. */
  turnTimerEnabled: boolean;
  /** The table's display name, set by the host at creation (e.g. "Bracket 3
   *  chill"). Empty string for a table nobody named. Legacy states resolve to
   *  `''`, which renders the same as a table left unnamed. */
  name: string;
  /**
   * Whether this table is listed and watchable, or reachable by code only.
   * `'public'` means anyone holding the join code may watch or join without
   * restriction; `'friends'` restricts both to the host's friends (plus
   * seated participants, always); `'private'` (the default) restricts the
   * table to its seats. The default is load-bearing: a code is four
   * characters, so the read routes answer a non-participant with the same
   * 404 an unknown code gets, and opening that up is the host's decision to
   * make rather than ours. Legacy states carried this as the
   * `spectatorsAllowed` boolean; they resolve to `'public'` when that was
   * `true`, else `'private'` — the same behaviour they already had.
   */
  visibility: 'public' | 'friends' | 'private';
  /**
   * Where this table is talking, if it is: a Discord invite, a Meet room, any
   * https link the host pastes. Display only — nothing here dials anything,
   * and the reducer stores whatever it is handed. The ROUTE is what refuses a
   * non-https or over-long link (see the games router), the same division of
   * labour `phase` already uses.
   */
  voiceUrl: string | null;
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
   * Which way seats are arranged around the table. Optional: absent (every
   * game persisted before this field existed) reads as `'clockwise'`
   * wherever it is consumed — there is no reducer behaviour keyed on it, so
   * no normalization is needed here (contrast `mulliganType`, which the
   * reducer itself branches on). A custom (user-arranged) layout ignores
   * this field entirely and keeps the order the user set.
   */
  turnOrder?: TurnOrder;
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
   * Free-form counters that belong to the TABLE rather than to a seat — storm
   * count, the turn number, a shared timer of some kind. Same shape and same
   * optionality as `GamePlayer.counters`; see that field's note.
   */
  tableCounters?: Record<string, number>;
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
  /**
   * Outcome of a CO-OP format (currently only `'horde'`). There is no winning
   * seat in co-op, so `winnerSeat` stays null and this field carries the
   * result instead. Absent for every non-co-op format and for any co-op game
   * that never finished. Never set alongside a non-null `winnerSeat`.
   */
  coopOutcome?: 'won' | 'lost';
  /**
   * Which horde deck this co-op game was fought against (display name/id,
   * host's choice) — the key `aggregateHordeRecords` groups by. Absent for
   * every non-co-op format.
   */
  hordeId?: string;
  /**
   * Online co-op horde table: resolved settings, seed, and the replayable
   * step log. Present only for `format === 'horde'` games that have run
   * `horde-setup` (i.e. every horde game past the lobby); OPTIONAL by design
   * like the other fields added after initial ship, and absent means "not a
   * horde table" — the frontend must never synthesize one when this is
   * missing.
   */
  horde?: HordeTable;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  version: number;
}

export type GameAction =
  | { type: 'start'; ts?: number }
  /**
   * `coopOutcome` is meaningful only for `format === 'horde'`: when given, it
   * sets `GameState.coopOutcome` and forces `winnerSeat` to null regardless of
   * what was passed. Every other format ignores it and keeps today's
   * behaviour.
   */
  | { type: 'end'; winnerSeat: number | null; coopOutcome?: 'won' | 'lost'; ts?: number }
  | { type: 'reset'; ts?: number }
  | { type: 'add-player'; player: GamePlayer; ts?: number }
  | { type: 'remove-player'; seat: number; ts?: number }
  /**
   * Reseat the table: `order` is every seated player's id, in the seat order
   * they should take (`order[0]` sits in seat 0). Lobby only — seat numbers
   * key commander damage, designations and the turn marker, all of which are
   * empty before a game starts and would be silently rewired after it.
   *
   * The caller supplies the order rather than the reducer rolling one, so the
   * reducer stays pure and the server and every client land on the same
   * seating (the same split the random-first-player control already uses).
   */
  | { type: 'reseat'; order: string[]; ts?: number }
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
          | 'bracket'
          | 'connected'
        >
      >;
      ts?: number;
    }
  // The five undoable kinds accept `undoOf`: the id of the last event that
  // stands. Undo dispatches ordinary compensating actions (the reducer has no
  // "undo" — it is shared with the server), and this is how the log learns
  // that everything after `undoOf` was taken back: the reducer flags those
  // events `undone` and the compensating event itself `undo`. Optional, so
  // every existing dispatch and every persisted online action is untouched.
  | {
      type: 'life';
      seat: number;
      delta: number;
      actorSeat: number | null;
      ts?: number;
      undoOf?: string;
    }
  | {
      type: 'set-life';
      seat: number;
      value: number;
      actorSeat: number | null;
      ts?: number;
      undoOf?: string;
    }
  | {
      type: 'poison';
      seat: number;
      delta: number;
      actorSeat: number | null;
      ts?: number;
      undoOf?: string;
    }
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
      undoOf?: string;
    }
  | { type: 'eliminate'; seat: number; eliminated: boolean; ts?: number; undoOf?: string }
  | { type: 'note'; actorSeat: number | null; message: string; ts?: number }
  /**
   * Flip the actor's own lobby-ready flag. `actorSeat` is deliberately the
   * ONLY seat this can touch — readiness is a statement about yourself, so
   * there is no `seat` field for one player to mark another ready (the route
   * enforces the same rule against a forged `actorSeat`).
   *
   * Announces itself into the log as a system note (`actorSeat: null`), the
   * same shape the table tools use, so the lobby chat shows it as a system
   * line rather than as something the player typed.
   */
  | { type: 'set-ready'; actorSeat: number; ready: boolean; ts?: number }
  | {
      type: 'settings';
      patch: Partial<
        Pick<
          GameState,
          | 'startingLife'
          | 'commanderDamageEnabled'
          | 'poisonEnabled'
          | 'mulliganType'
          | 'turnTimerEnabled'
          | 'format'
          | 'layout'
          | 'tapOrientation'
          | 'turnOrder'
          | 'startingSeat'
          | 'visibility'
          | 'voiceUrl'
          | 'name'
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
  | { type: 'phase'; phase: GamePhase; actorSeat: number | null; ts?: number }
  /**
   * Pause or resume the derived table clock (`lib/game-clock.ts`'s
   * `gameElapsed`/`turnElapsed`/`seatTurnTotals` all subtract paused
   * stretches). Recorded as an ordinary log EVENT, never a `GameState`
   * field — `isClockPaused` folds the log for "is it paused right now",
   * exactly like `activeSeat`'s history is a fold over `turn` events, so a
   * pause survives resume/reconnect the same way the rest of the log does
   * with no separate field to keep in sync.
   *
   * A no-op (state unchanged, no event, no version bump) when the game isn't
   * `active` — nothing runs before a start or after a finish to pause — or
   * when `paused` already matches the current state (a double-tap, or two
   * devices racing the same toggle). Deliberately NOT one of the five
   * undoable kinds: pausing is a table decision a player makes on purpose,
   * not a value a misclick corrupts, so Undo does not reach it (see
   * `isUndoable` in the frontend's `undo-stack.ts`).
   */
  | { type: 'clock'; paused: boolean; actorSeat: number | null; ts?: number }
  /**
   * Adjust a free-form counter. `seat` is the owning seat, or `null` for a
   * table-level counter. A counter springs into existence on its first
   * `counter` action (delta 0 creates it at zero), so there is no separate
   * "add" action to keep in step with this one.
   *
   * The name is normalized (`normalizeCounterName`) before it is used as a
   * key, so "  Energy " and "Energy" are the same counter rather than two
   * rows that look identical in the UI.
   */
  | {
      type: 'counter';
      seat: number | null;
      name: string;
      delta: number;
      actorSeat: number | null;
      ts?: number;
    }
  /** Delete a free-form counter outright. Distinct from decrementing it to
   *  zero, which is a legitimate value a table may want to keep on the board. */
  | {
      type: 'counter-remove';
      seat: number | null;
      name: string;
      actorSeat: number | null;
      ts?: number;
    }
  /**
   * Set up the horde table for a lobby about to start a `'horde'` game.
   * Lobby + format-gated: a no-op (`return prev`) unless `status === 'lobby'`
   * and `format === 'horde'`. The host's device resolves `settings`/`seed`
   * once, before `start`, so every device that later replays the step log
   * lands on the identical horde.
   */
  | {
      type: 'horde-setup';
      hordeId: string;
      level: HordeLevel;
      settings: HordeSettings;
      seed: number;
      deckRev: string;
      ts?: number;
    }
  /**
   * Mark (or un-mark) a survivor's team turn as done. Once every ACTIVE
   * survivor (not eliminated, connected) is done: advances the setup-turn
   * counter, or — once setup is over — appends the log's next `reveal` step
   * and starts the horde's turn.
   */
  | { type: 'horde-done'; actorSeat: number; done: boolean; ts?: number }
  /**
   * Append one step to the horde's replayable log. `at` is the index this
   * step expects to land at (`horde.steps.length` when it was dispatched) —
   * a mismatch means another device already moved the horde, and the action
   * is a silent no-op (`return prev` UNCHANGED) rather than an error, since
   * two devices racing the same tap is the expected case, not a bug.
   */
  | { type: 'horde-step'; step: HordeStep; at: number; actorSeat: number; ts?: number }
  /**
   * Undo the horde's last logged step, reversing its table effect. Only
   * valid when `at` matches the current log length (the same staleness guard
   * as `horde-step`).
   */
  | { type: 'horde-undo'; at: number; actorSeat: number; ts?: number };

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
  'mulliganType',
  'turnTimerEnabled',
  'format',
  // Not a rule, but the one setting the table has a right to hear about: it
  // decides whether anyone outside the seats can see the game. The name is
  // deliberately NOT here — a rename isn't a rules change worth a log row.
  'visibility',
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

/**
 * An Undo just appended its compensating event (the last one): flag it `undo`,
 * and flag every event after `anchorId` — the last event that still stands —
 * as `undone`. Earlier compensating events of the same Undo keep their `undo`
 * mark. An anchor the bounded log has already trimmed away flags nothing
 * beyond the compensating event itself: better to under-report an undo than to
 * void the whole game.
 */
function markUndone(events: GameEvent[], anchorId: string): GameEvent[] {
  const last = events.length - 1;
  const anchor = events.findIndex((e) => e.id === anchorId);
  return events.map((e, i) => {
    if (i === last) return { ...e, undo: true };
    if (anchor === -1 || i <= anchor || e.undo || e.undone) return e;
    return { ...e, undone: true };
  });
}

function updatePlayer(
  state: GameState,
  seat: number,
  patch: (p: GamePlayer) => GamePlayer
): GamePlayer[] {
  return state.players.map((p) => (p.seat === seat ? patch(p) : p));
}

/** Horde mode shares one life total: set every seat to the same value. */
function mirrorLife(players: GamePlayer[], life: number): GamePlayer[] {
  return players.map((p) => ({ ...p, life }));
}

/**
 * Find the next non-eliminated seat after `currentSeat` in sorted seat order,
 * wrapping. Returns `null` if no eligible seat exists (everyone is eliminated).
 * When `currentSeat` is null, returns the first non-eliminated seat.
 *
 * Exported (not just an internal `pass-turn` helper) so the board can render
 * a read-only "up next" marker on the seat this would move to, without
 * duplicating the alive/sort/wrap logic — see `GameBoard.tsx`.
 */
export function nextActiveSeat(players: GamePlayer[], currentSeat: number | null): number | null {
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
 * Whether the table clock is paused right now: the `paused` flag of the most
 * recent `clock` event, walking backward, or `false` when the log has none.
 * A state written before pause/resume existed has no `clock` events and so
 * reads as "never paused" through this same code path — no migration.
 */
export function isClockPaused(state: GameState): boolean {
  for (let i = state.events.length - 1; i >= 0; i--) {
    const ev = state.events[i];
    if (ev.kind === 'clock' && typeof ev.paused === 'boolean') return ev.paused;
  }
  return false;
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

/**
 * Longest a free-form counter name may be. Long enough for "Experience" or
 * "Rad counters", short enough that a chip stays a chip on a 4-up board.
 */
export const MAX_COUNTER_NAME_LENGTH = 24;

/**
 * Most free-form counters one scope (a seat, or the table) may hold at once.
 * This is a storage bound, not a taste judgement: an online game's whole state
 * is one JSONB row, and an unbounded user-named map is the one field here a
 * bored table could grow without limit.
 */
export const MAX_COUNTERS_PER_SCOPE = 12;

/**
 * Seat cap for every ONLINE table. Shared by the join route (rejects an
 * 11th seat) and the room browser's `max` field on the backend, and by the
 * lobby's rendered seat grid on the frontend — one constant so the two
 * never drift apart again (they were two hand-matched `8`s before). Local
 * pass-and-play seats up to 10 already (Lotus); this brings online in line.
 */
export const MAX_ONLINE_SEATS = 10;

/**
 * Canonical form of a user-supplied counter name, and the trust boundary for
 * this field: the name is persisted, synced to every other device in an online
 * game, and rendered. Collapses internal whitespace (so "Rad  counters" can't
 * masquerade as a second, distinct "Rad counters") and caps the length.
 *
 * Throws on an empty result rather than silently inventing a name — the caller
 * is a form that can show the error, and a counter keyed on "" would be
 * unreachable in the UI.
 */
export function normalizeCounterName(raw: string): string {
  const name = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_COUNTER_NAME_LENGTH)
    .trim();
  if (!name) throw new Error('A counter needs a name.');
  return name;
}

/** A seat's counters, tolerating the legacy `undefined`. Never returns null. */
export function seatCounters(player: GamePlayer): Record<string, number> {
  return player.counters ?? {};
}

/** The table's counters, tolerating the legacy `undefined`. */
export function tableCounters(state: GameState): Record<string, number> {
  return state.tableCounters ?? {};
}

/**
 * Apply a delta to one counter inside a scope's map. Clamped at zero, like
 * poison — every counter Magic actually uses is non-negative, and a stray tap
 * that reads "-1" looks broken rather than permissive.
 *
 * ponytail: clamped at 0. If a table ever genuinely needs a signed tally, the
 * upgrade is a per-counter `signed` flag, not removing the clamp for everyone.
 */
function withCounterDelta(
  map: Record<string, number>,
  name: string,
  delta: number
): Record<string, number> {
  const cur = map[name];
  if (cur === undefined && Object.keys(map).length >= MAX_COUNTERS_PER_SCOPE) {
    throw new Error(`A maximum of ${MAX_COUNTERS_PER_SCOPE} counters can be tracked at once.`);
  }
  return { ...map, [name]: Math.max(0, (cur ?? 0) + delta) };
}

function withoutCounter(map: Record<string, number>, name: string): Record<string, number> {
  if (!(name in map)) return map;
  const next = { ...map };
  delete next[name];
  return next;
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
  // Co-op: there is no winning seat, and a solo survivor left standing while
  // teammates are down is not a win — the team keeps playing on shared life.
  // Only everyone down together ends it, as a loss.
  if (state.format === 'horde') {
    if (alive.length === 0 && state.players.length > 0) {
      return {
        ...state,
        status: 'finished',
        winnerSeat: null,
        coopOutcome: 'lost',
        endedAt: state.endedAt ?? Date.now(),
      };
    }
    return state;
  }
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
  mulliganType?: MulliganType;
  turnTimerEnabled?: boolean;
  layout?: GameLayout;
  tapOrientation?: TapOrientation;
  turnOrder?: TurnOrder;
  name?: string;
  visibility?: 'public' | 'friends' | 'private';
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
    mulliganType: input.mulliganType ?? 'commander',
    turnTimerEnabled: input.turnTimerEnabled ?? false,
    name: input.name ?? '',
    // Private until the host says otherwise — see the field's own doc.
    visibility: input.visibility ?? 'private',
    voiceUrl: null,
    layout: input.layout ?? 'pod',
    tapOrientation: input.tapOrientation ?? 'horizontal',
    turnOrder: input.turnOrder,
    activeSeat: null,
    startingSeat: null,
    designations: { monarch: null, initiative: null },
    tableCounters: {},
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
  bracket?: 1 | 2 | 3 | 4 | 5 | null;
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
    bracket: input.bracket ?? null,
    life: input.startingLife,
    poison: 0,
    commanderDamage: {},
    counters: {},
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
    mulliganType: prev.mulliganType ?? 'commander',
    turnTimerEnabled: prev.turnTimerEnabled ?? false,
    name: prev.name ?? '',
    visibility:
      prev.visibility ??
      ((prev as { spectatorsAllowed?: boolean }).spectatorsAllowed === true ? 'public' : 'private'),
    voiceUrl: prev.voiceUrl ?? null,
    designations: resolveDesignations(prev.designations),
    tableCounters: prev.tableCounters ?? {},
  };

  switch (action.type) {
    case 'start': {
      if (prev.status !== 'lobby') return prev;
      next = {
        ...next,
        status: 'active',
        startedAt: ts,
        // Readiness is a lobby-only statement; it means nothing once the game
        // is live, and a stale `true` would come back on a later `reset`.
        players: prev.players.map((p) => ({ ...p, ready: false })),
        events: pushEvent(next, { kind: 'start', actorSeat: null, targetSeat: null, ts }),
      };
      break;
    }
    case 'end': {
      if (prev.status === 'finished') return prev;
      // Co-op has no winning seat — a coopOutcome always forces null,
      // regardless of what the caller passed.
      const isCoop = prev.format === 'horde' && action.coopOutcome !== undefined;
      // A player who is eliminated (or a seat that doesn't exist) can never be
      // the winner — coerce any such client-supplied winnerSeat to null rather
      // than trusting it, so a losing participant can't forge a self-win into
      // the permanent game_results stats.
      const winnerSeat = isCoop
        ? null
        : action.winnerSeat != null &&
            prev.players.some((p) => p.seat === action.winnerSeat && !p.eliminated)
          ? action.winnerSeat
          : null;
      next = {
        ...next,
        status: 'finished',
        winnerSeat,
        ...(isCoop ? { coopOutcome: action.coopOutcome } : {}),
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
        tableCounters: {},
        // A rematch sets up a new seed/log, not a replay of last game's.
        coopOutcome: undefined,
        horde: undefined,
        players: prev.players.map((p) => ({
          ...p,
          life: prev.startingLife,
          poison: 0,
          commanderDamage: {},
          // A reset is a fresh game at the same table: last game's energy /
          // experience / storm count is stale, exactly like its poison.
          counters: {},
          eliminated: false,
          ready: false,
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
    case 'reseat': {
      if (prev.status !== 'lobby') return prev;
      // Must be a permutation of exactly the seated players: anything else
      // would drop or duplicate a seat, so leave the table untouched.
      const ids = prev.players.map((p) => p.id);
      const ok =
        action.order.length === ids.length &&
        new Set(action.order).size === ids.length &&
        action.order.every((id) => ids.includes(id));
      if (!ok) return prev;
      const byId = new Map(prev.players.map((p) => [p.id, p]));
      next = {
        ...next,
        players: action.order.map((id, seat) => ({ ...byId.get(id)!, seat })),
        // Whoever was on the play is identified by seat, and every seat just
        // changed hands — the mark is stale, not transferable.
        startingSeat: null,
        events: pushEvent(next, {
          kind: 'settings',
          actorSeat: null,
          targetSeat: null,
          message: 'Seats shuffled',
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
      const target = requireSeat(prev.players, action.seat);
      // Horde: one shared life total — the delta lands on the acted-on seat,
      // then mirrors to the whole team.
      const newLife = target.life + action.delta;
      next = {
        ...next,
        players:
          prev.format === 'horde'
            ? mirrorLife(next.players, newLife)
            : updatePlayer(next, action.seat, (p) => ({ ...p, life: newLife })),
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
        players:
          prev.format === 'horde'
            ? mirrorLife(next.players, action.value)
            : updatePlayer(next, action.seat, (p) => ({ ...p, life: action.value })),
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
    case 'set-ready': {
      const target = requireSeat(prev.players, action.actorSeat);
      if ((target.ready ?? false) === action.ready) return prev;
      next = {
        ...next,
        players: updatePlayer(next, action.actorSeat, (p) => ({ ...p, ready: action.ready })),
        events: pushEvent(next, {
          kind: 'note',
          actorSeat: null,
          targetSeat: action.actorSeat,
          message: `${target.name} is ${action.ready ? 'ready' : 'not ready'}`,
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
    case 'counter': {
      const name = normalizeCounterName(action.name);
      if (action.seat !== null) requireSeat(prev.players, action.seat);
      next =
        action.seat === null
          ? { ...next, tableCounters: withCounterDelta(tableCounters(next), name, action.delta) }
          : {
              ...next,
              players: updatePlayer(next, action.seat, (p) => ({
                ...p,
                counters: withCounterDelta(seatCounters(p), name, action.delta),
              })),
            };
      next = {
        ...next,
        events: pushEvent(next, {
          kind: 'counter',
          actorSeat: action.actorSeat,
          targetSeat: action.seat,
          delta: action.delta,
          message: name,
          ts,
        }),
      };
      break;
    }
    case 'counter-remove': {
      const name = normalizeCounterName(action.name);
      if (action.seat !== null) requireSeat(prev.players, action.seat);
      next =
        action.seat === null
          ? { ...next, tableCounters: withoutCounter(tableCounters(next), name) }
          : {
              ...next,
              players: updatePlayer(next, action.seat, (p) => ({
                ...p,
                counters: withoutCounter(seatCounters(p), name),
              })),
            };
      next = {
        ...next,
        events: pushEvent(next, {
          kind: 'counter',
          actorSeat: action.actorSeat,
          targetSeat: action.seat,
          message: name,
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
    case 'clock': {
      if (prev.status !== 'active' || isClockPaused(prev) === action.paused) return prev;
      next = {
        ...next,
        events: pushEvent(next, {
          kind: 'clock',
          actorSeat: action.actorSeat,
          targetSeat: null,
          paused: action.paused,
          ts,
        }),
      };
      break;
    }
    case 'horde-setup': {
      if (prev.status !== 'lobby' || prev.format !== 'horde') return prev;
      const horde: HordeTable = {
        hordeId: action.hordeId,
        level: action.level,
        settings: action.settings,
        seed: action.seed,
        deckRev: action.deckRev,
        phase: 'survivors',
        survivorTurn: 1,
        hordeTurn: 0,
        done: [],
        steps: [],
      };
      next = {
        ...next,
        horde,
        hordeId: action.hordeId,
        startingLife: action.settings.life,
        commanderDamageEnabled: false,
        poisonEnabled: false,
        players: prev.players.map((p) => ({ ...p, life: action.settings.life })),
        events: pushEvent(next, { kind: 'settings', actorSeat: null, targetSeat: null, ts }),
      };
      break;
    }
    case 'horde-done': {
      if (prev.status !== 'active' || !prev.horde || prev.horde.phase !== 'survivors') return prev;
      const horde = prev.horde;
      const doneSet = new Set(horde.done);
      if (action.done) doneSet.add(action.actorSeat);
      else doneSet.delete(action.actorSeat);

      const activeSurvivors = prev.players.filter((p) => !p.eliminated && p.connected);
      const allDone =
        action.done &&
        activeSurvivors.length > 0 &&
        activeSurvivors.every((p) => doneSet.has(p.seat));

      if (allDone && horde.survivorTurn < horde.settings.setupTurns) {
        // Setup turn over — just advance; the horde hasn't taken a turn yet.
        next = { ...next, horde: { ...horde, survivorTurn: horde.survivorTurn + 1, done: [] } };
      } else if (allDone) {
        // Setup is over: the horde's turn is due.
        const entry: HordeLogEntry = { k: 'reveal', seat: action.actorSeat, ts };
        next = {
          ...next,
          horde: {
            ...horde,
            hordeTurn: horde.hordeTurn + 1,
            phase: 'reveal',
            done: [],
            steps: [...horde.steps, entry],
          },
        };
      } else {
        next = { ...next, horde: { ...horde, done: [...doneSet].sort((a, b) => a - b) } };
      }
      break;
    }
    case 'horde-step': {
      if (prev.status !== 'active' || !prev.horde) return prev;
      const horde = prev.horde;
      // Stale view: another device already moved the horde since this client
      // last saw the log.
      if (action.at !== horde.steps.length) return prev;
      if (horde.steps.length >= MAX_HORDE_STEPS) {
        throw new Error(`Horde log is at its ${MAX_HORDE_STEPS}-step limit.`);
      }
      const step = action.step;
      const entry: HordeLogEntry = { ...step, seat: action.actorSeat, ts };

      switch (step.k) {
        case 'reveal': {
          // The "start without them" path: skip past a stuck team-done wait.
          if (horde.phase !== 'survivors') return prev;
          next = {
            ...next,
            horde: {
              ...horde,
              hordeTurn: horde.hordeTurn + 1,
              phase: 'reveal',
              done: [],
              steps: [...horde.steps, entry],
            },
          };
          break;
        }
        case 'confirm': {
          if (horde.phase !== 'reveal') return prev;
          next = { ...next, horde: { ...horde, phase: 'combat', steps: [...horde.steps, entry] } };
          break;
        }
        case 'take': {
          if (horde.phase !== 'combat') return prev;
          if (!Number.isInteger(step.dealt) || step.dealt < 0 || step.dealt > 999) {
            throw new Error('A horde attack must deal 0-999 damage.');
          }
          const sharedLife = prev.players.length > 0 ? prev.players[0].life : 0;
          next = {
            ...next,
            players: mirrorLife(next.players, Math.max(0, sharedLife - step.dealt)),
            horde: {
              ...horde,
              phase: 'survivors',
              survivorTurn: horde.survivorTurn + 1,
              done: [],
              steps: [...horde.steps, entry],
            },
            // A 'life' event with a real targetSeat feeds the derived
            // per-seat summary stats (damageTaken, biggestHit, firstBlood);
            // a shared team hit has no single target, and summary.ts skips
            // a 'life' event whose targetSeat is null — so this uses 'note'
            // instead of quietly dropping the game's main damage source from
            // every horde game's summary.
            events: pushEvent(next, {
              kind: 'note',
              actorSeat: action.actorSeat,
              targetSeat: null,
              message: `Horde attack: ${step.dealt}`,
              ts,
            }),
          };
          break;
        }
        case 'damage': {
          if (!Number.isInteger(step.n) || step.n < 0 || step.n > 999) {
            throw new Error('Horde damage must be 0-999.');
          }
          next = { ...next, horde: { ...horde, steps: [...horde.steps, entry] } };
          break;
        }
        case 'move': {
          if (!step.cardId || step.cardId.length > 80) {
            throw new Error('A horde card move needs a card id of at most 80 characters.');
          }
          if (step.to !== 'graveyard' && step.to !== 'exile' && step.to !== 'library') {
            throw new Error(`Unknown horde move destination "${step.to}".`);
          }
          next = { ...next, horde: { ...horde, steps: [...horde.steps, entry] } };
          break;
        }
      }
      break;
    }
    case 'horde-undo': {
      if (prev.status !== 'active' || !prev.horde || prev.horde.steps.length === 0) return prev;
      const horde = prev.horde;
      if (action.at !== horde.steps.length) return prev;
      const last = horde.steps[horde.steps.length - 1];
      const steps = horde.steps.slice(0, -1);

      switch (last.k) {
        case 'take': {
          // An active game never has a clamped take (hitting 0 ends the game,
          // and horde-undo requires 'active'), so adding `dealt` back is exact.
          const sharedLife = prev.players.length > 0 ? prev.players[0].life : 0;
          next = {
            ...next,
            players: mirrorLife(next.players, sharedLife + last.dealt),
            horde: {
              ...horde,
              phase: 'combat',
              survivorTurn: horde.survivorTurn - 1,
              done: [],
              steps,
            },
          };
          break;
        }
        case 'confirm': {
          next = { ...next, horde: { ...horde, phase: 'reveal', steps } };
          break;
        }
        case 'reveal': {
          // Every active survivor had to be done to get here — restore that.
          const activeSurvivors = prev.players
            .filter((p) => !p.eliminated && p.connected)
            .map((p) => p.seat);
          next = {
            ...next,
            horde: {
              ...horde,
              phase: 'survivors',
              hordeTurn: horde.hordeTurn - 1,
              done: activeSurvivors,
              steps,
            },
          };
          break;
        }
        case 'damage':
        case 'move': {
          next = { ...next, horde: { ...horde, steps } };
          break;
        }
      }
      break;
    }
  }

  if ('undoOf' in action && typeof action.undoOf === 'string' && next.events !== prev.events) {
    next = { ...next, events: markUndone(next.events, action.undoOf) };
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
    /** Second commander for a Partner pair. Optional: absent on a record
     *  read back from a legacy row, which means "unknown", not "none". */
    partner?: string | null;
    /** Optional for the same reason as `partner` — absent on a legacy row. */
    colorIdentity?: string[];
    finalLife: number;
    eliminated: boolean;
  }[];
  winnerSeat: number | null;
  startedAt: number | null;
  endedAt: number;
  durationMs: number;
  mode: 'local' | 'online';
  /**
   * The account that posted a local result to the server, when this record
   * came back from the canonical `game_results` table; only they may delete
   * it there. Absent on a record built on-device (`gameToRecord`) and on
   * every online record.
   */
  recordedByUserId?: string | null;
  /**
   * Who hosted an ONLINE game — the only account that may delete that record
   * outright (everyone else at the table can hide it from their own list).
   * Absent on a local record and on an online one written before the server
   * captured it.
   */
  hostUserId?: string | null;
  /**
   * Derived stats, computed once here so history rollups never re-walk a log
   * the record doesn't even carry. **Optional by design**: records written
   * before this field read as `undefined` — "no data captured" — and must
   * never be coerced to a zeroed summary, which is indistinguishable from a
   * genuinely uneventful game. Same discipline as `game_results.notable_events`.
   */
  summary?: GameSummary;
  /** See `GameState.coopOutcome`. Absent for every non-co-op format. */
  coopOutcome?: 'won' | 'lost';
  /** See `GameState.hordeId`. Absent for every non-co-op format. */
  hordeId?: string;
  /** See `GameState.turnOrder`. Absent reads as `'clockwise'` wherever this
   *  is consumed — same as on `GameState` itself. */
  turnOrder?: TurnOrder;
  /**
   * The two rule toggles. Optional: absent on a record read back from a
   * legacy row, which a rematch must infer (cmdr damage from format, poison
   * off) rather than treat as "off" — an absent toggle is not a false one.
   */
  commanderDamageEnabled?: boolean;
  poisonEnabled?: boolean;
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
      partner: p.partner,
      colorIdentity: p.colorIdentity,
      finalLife: p.life,
      eliminated: p.eliminated,
    })),
    winnerSeat: state.winnerSeat,
    startedAt: state.startedAt,
    endedAt,
    durationMs: state.startedAt ? endedAt - state.startedAt : 0,
    mode: state.mode,
    commanderDamageEnabled: state.commanderDamageEnabled,
    poisonEnabled: state.poisonEnabled,
    ...(state.hostUserId !== null ? { hostUserId: state.hostUserId } : {}),
    summary: summarizeGame(state, endedAt),
    ...(state.coopOutcome !== undefined ? { coopOutcome: state.coopOutcome } : {}),
    ...(state.hordeId !== undefined ? { hordeId: state.hordeId } : {}),
    ...(state.turnOrder !== undefined ? { turnOrder: state.turnOrder } : {}),
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
  // An undone tap (and the Undo that cancelled it) is not a moment of the game.
  const notable = events.filter((e) => NOTABLE_KINDS.has(e.kind) && !e.undone && !e.undo);
  return notable.length > MAX_NOTABLE_EVENTS ? notable.slice(-MAX_NOTABLE_EVENTS) : notable;
}

// Derived per-game statistics (first blood, placements, damage, KO credit).
// One-directional at runtime: `summary.ts` imports only *types* from here, so
// nothing requires back into this module.
export * from './summary';
