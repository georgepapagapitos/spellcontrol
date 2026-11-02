// The action union, split out of index.ts (which re-exports it) to keep the
// reducer file under its size ceiling. Type-only imports back into index.ts:
// nothing here exists at runtime.
import type { DesignationKind, GamePhase, GamePlayer, GameState } from './index';
import type { DungeonOp } from './dungeons';
import type { HordeLevel, HordeSettings, HordeStep } from './horde-types';

export type GameAction =
  | { type: 'start'; ts?: number }
  /** Start the game clock by hand, for a table that does not wait for its first action. */
  | { type: 'clock-start'; ts?: number }
  /**
   * `coopOutcome` is meaningful only for `format === 'horde'`: when given, it
   * sets `GameState.coopOutcome` and forces `winnerSeat` to null regardless of
   * what was passed. Every other format ignores it and keeps today's
   * behavior.
   */
  | { type: 'end'; winnerSeat: number | null; coopOutcome?: 'won' | 'lost'; ts?: number }
  /**
   * Back to the lobby for a new game at the same table. `id` is the NEW
   * game's id, supplied by the caller (the reducer stays pure, the way the
   * horde's seed is rolled on the host's device): a finished game's result is
   * recorded once per `id`, so a rematch that kept the old id had its own
   * result silently dropped. Optional so a legacy dispatch keeps its meaning.
   */
  | { type: 'reset'; id?: string; ts?: number }
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
  /**
   * Hand the table to another seat: its account becomes the host, with every
   * host-only power (start, reset, settings, add/remove players, reseat,
   * horde-setup). The leave route applies it when the host leaves (E430,
   * successor from `nextHostSeat`); as a PATCH action it is host-only. A
   * guest seat has no account and cannot host.
   */
  | { type: 'transfer-host'; seat: number; ts?: number }
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
          | 'deckFacts'
          | 'deckVersion'
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
   * seat is eliminated/unknown, falling back to the advance behavior.
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
  /**
   * One venture step for a seat: enter a dungeon, move to a room, complete it,
   * leave it without completing, or take back a completed one (a mis-tap).
   * Records progress only; see `stepDungeon` for what it checks (a dungeon
   * and room that exist) and what it deliberately does not (the path).
   */
  | ({ type: 'dungeon'; seat: number; actorSeat: number | null; ts?: number } & DungeonOp)
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
   *
   * `force` is "Start without them": a survivor who is done ends the team
   * turn without waiting for the rest (a teammate who is connected but away).
   * Only meaningful with `done: true`; it is the one way to move a setup turn
   * on without everyone, since `horde-step reveal` is for the horde's turn.
   */
  | { type: 'horde-done'; actorSeat: number; done: boolean; force?: boolean; ts?: number }
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
