// Horde table types, split out of index.ts (which re-exports them) to keep
// the reducer file under its size ceiling.

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
