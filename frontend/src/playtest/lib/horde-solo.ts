/**
 * Solo Horde on the playtest board (E387 PR 5): your own deck against a
 * self-running horde. The horde is a second `PlaytestState` driven by the
 * same reducer, held beside yours in `usePlaytestStore`. Every horde step
 * pushes one entry onto YOUR `state.past`, paired with the horde as it was
 * in `hordePast` (Resistance's `resistancePast` pattern), so one undo trail
 * covers "the horde revealed, then I blocked".
 *
 * Solo only. A horde never exists at an online table and never publishes to
 * one (memory `project_playtest_and_real_game_stay_separate`), and its
 * results stay in the playtest session record, never Play history.
 */
import type { PlaytestCard, PlaytestState } from '@/lib/playtest';
import type {
  HordeDamageResult,
  HordeLevel,
  HordePendingAttack,
  HordeReveal,
  HordeSettings,
} from '@/lib/horde';

export interface SoloHordeConfig {
  hordeId: string;
  hordeName: string;
  level: HordeLevel;
  /** The Customise values, kept so Reset can rebuild the same fight. */
  overrides: Partial<HordeSettings>;
  /** Resolved for one survivor. */
  settings: HordeSettings;
}

/**
 * - `waiting` — your turn; the horde acts when you pass it (once due).
 * - `reveal`  — its reveal sheet is open.
 * - `combat`  — its creatures attack; the damage-total banner is up.
 * - `ended`   — won or lost; the end sheet is up.
 */
export type SoloHordePhase = 'waiting' | 'reveal' | 'combat' | 'ended';

export interface SoloHordeState {
  config: SoloHordeConfig;
  /** The horde's own reducer state. Its `past` is always empty: the horde's
   *  history lives in the store's `hordePast`, aligned with YOUR `past`. */
  board: PlaytestState;
  librarySizeAtStart: number;
  /** Indexes into `config.settings.bossTicks` already crossed. */
  bossTicksCrossed: number[];
  /** Your turn number when the horde was armed; setup turns count from it. */
  armedAtTurn: number;
  /** Horde turns taken so far. */
  hordeTurn: number;
  phase: SoloHordePhase;
  pendingReveal: HordeReveal | null;
  pendingAttack: HordePendingAttack | null;
  /** Ringed in red during combat, never tapped. */
  attackingIds: string[];
  /** The damage sheet's result view; cleared when the sheet closes. */
  lastDamageResult: HordeDamageResult | null;
  outcome: 'won' | 'lost' | null;
  damageTaken: number;
  cardsMilledByDamage: number;
}

/** What a solo horde game adds to the playtest session record. */
export interface SoloHordeRecord {
  hordeId: string;
  hordeName: string;
  level: HordeLevel;
  outcome: 'won' | 'lost' | null;
}

/** The last of your turns before the horde first acts. With 3 setup turns
 *  armed on turn 1, that is turn 3: the horde's first turn comes when you
 *  pass turn 3. With none, it is the turn you armed it on. */
export function hordeArrivesAfterTurn(horde: Pick<SoloHordeState, 'armedAtTurn' | 'config'>) {
  return horde.armedAtTurn + Math.max(0, horde.config.settings.setupTurns - 1);
}

/** Whether passing your turn `playerTurn` hands it to the horde (rather
 *  than straight to your next turn). */
export function isHordeTurnDue(
  horde: Pick<SoloHordeState, 'armedAtTurn' | 'config' | 'phase'>,
  playerTurn: number
): boolean {
  return horde.phase === 'waiting' && playerTurn >= hordeArrivesAfterTurn(horde);
}

function isHordeCreature(card: PlaytestCard): boolean {
  return (card.typeLine ?? '').toLowerCase().includes('creature');
}

/** Ids of every creature the horde currently controls — the red-ring
 *  attacker set. Mirrors the paper table's own `creatureIds`. */
export function hordeCreatureIds(board: PlaytestState): string[] {
  return board.battlefield.filter((b) => isHordeCreature(b.card)).map((b) => b.card.id);
}
