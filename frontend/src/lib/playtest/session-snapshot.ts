/**
 * Device-local playtest session persistence (E137). A page refresh, back-swipe,
 * or app switch used to lose the whole in-progress game — this snapshots the
 * session to `localStorage` so `/decks/:id/playtest` can offer a resume.
 *
 * Deliberately NOT the sync path: this is scratch/ephemeral play state, not
 * synced user data, so it never touches IndexedDB or the mutation queue (see
 * `project_offline_vs_sync_caches`). One key per deck, pruned to the most
 * recently-played `MAX_DECKS` decks so a long play history doesn't leak
 * localStorage forever.
 *
 * The reducer's `past` undo stack (up to 50 full snapshots) is deliberately
 * excluded — too big to persist every debounce tick. Undo history not
 * surviving a reload/resume is an accepted tradeoff.
 */

import { playtestLifeConfig } from './life-config';
import type { PlaytestState } from './types';
import type { GameLogEntry } from './game-log';
import type { ResistanceState } from '@/playtest/lib/resistance';
import type { Deck } from '@/store/decks';

/** Mirrors `PlaytestPhase` in `@/playtest/store` (kept local to avoid a cycle). */
export type PlaytestSnapshotPhase = 'opening' | 'mulligan-bottom' | 'playing';

export interface PlaytestSnapshot {
  /** `${deck.updatedAt}:${deck.cards.length}` — invalidates the snapshot if the deck changed since. */
  fingerprint: string;
  savedAt: number;
  phase: PlaytestSnapshotPhase;
  mulliganCount: number;
  resistance: boolean;
  resistanceState: ResistanceState | null;
  /** Reducer state minus `past` (the undo stack — too big, not persisted). */
  state: Omit<PlaytestState, 'past'>;
  /** Event journal (E140). Optional on the wire — a snapshot saved before this
   *  field existed loads with an empty log rather than failing validation. */
  gameLog: GameLogEntry[];
}

const KEY_PREFIX = 'spellcontrol:playtest:';
const INDEX_KEY = 'spellcontrol:playtest:index';
const MAX_DECKS = 3;

export function fingerprintDeck(deck: Pick<Deck, 'updatedAt' | 'cards'>): string {
  return `${deck.updatedAt}:${deck.cards.length}`;
}

/** Simple, honest "is this game worth offering to resume" check: past the
 *  opening hand, or a turn has passed, or something is already in play. */
export function isResumeWorthy(snapshot: Pick<PlaytestSnapshot, 'phase' | 'state'>): boolean {
  return (
    snapshot.phase !== 'opening' || snapshot.state.turn > 1 || snapshot.state.battlefield.length > 0
  );
}

function isValidSnapshot(v: unknown): v is PlaytestSnapshot {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  if (
    typeof s.fingerprint !== 'string' ||
    typeof s.savedAt !== 'number' ||
    typeof s.phase !== 'string' ||
    typeof s.mulliganCount !== 'number' ||
    typeof s.resistance !== 'boolean' ||
    !s.state ||
    typeof s.state !== 'object'
  ) {
    return false;
  }
  const state = s.state as Record<string, unknown>;
  if (
    typeof state.turn !== 'number' ||
    typeof state.rngSeed !== 'number' ||
    !Array.isArray(state.battlefield) ||
    !state.zones ||
    typeof state.zones !== 'object'
  ) {
    return false;
  }
  // Life fields (E138) are optional here — an OLDER snapshot predates them
  // entirely and gets backfilled by `migrateSnapshotState` below. But if
  // present at all, they must be well-formed (a half-corrupt shape is
  // rejected outright rather than fed to the reducer).
  if (state.life !== undefined && typeof state.life !== 'number') return false;
  if (state.opponents !== undefined && !Array.isArray(state.opponents)) return false;
  return true;
}

/**
 * Backfills the life/opponents fields (E138) onto a snapshot's state that
 * predates them, using the same format-aware defaults a fresh game would get.
 * A snapshot that already has them (the common case) passes through
 * unchanged. Never throws — worst case a snapshot that's missing `deck`
 * context falls back to the generic 1v1/20-life config.
 */
export function migrateSnapshotState(
  state: Omit<PlaytestState, 'past'>,
  deck: Pick<Deck, 'format'> | undefined
): Omit<PlaytestState, 'past'> {
  if (typeof state.life === 'number' && Array.isArray(state.opponents)) return state;
  const cfg = playtestLifeConfig(deck?.format);
  return {
    ...state,
    life: cfg.life,
    opponents: Array.from({ length: cfg.opponentCount }, () => ({
      life: cfg.opponentLife,
      commanderDamage: 0,
    })),
    startingLife: cfg.life,
    startingOpponentLife: cfg.opponentLife,
    commanderDamageThreshold: cfg.commanderDamageThreshold,
    tableDefeatedTurn: null,
  };
}

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function savePlaytestSnapshot(deckId: string, snapshot: PlaytestSnapshot): void {
  try {
    localStorage.setItem(KEY_PREFIX + deckId, JSON.stringify(snapshot));
  } catch {
    return; // storage unavailable/full — best-effort persistence, drop silently
  }
  const ids = [deckId, ...readIndex().filter((id) => id !== deckId)];
  for (const stale of ids.slice(MAX_DECKS)) {
    try {
      localStorage.removeItem(KEY_PREFIX + stale);
    } catch {
      /* ignore */
    }
  }
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(ids.slice(0, MAX_DECKS)));
  } catch {
    /* ignore */
  }
}

/** Loads a snapshot for `deckId` if it exists, is well-formed, and matches
 *  `fingerprint`. Any corruption or staleness silently discards it. */
export function loadPlaytestSnapshot(deckId: string, fingerprint: string): PlaytestSnapshot | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY_PREFIX + deckId);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isValidSnapshot(parsed) || parsed.fingerprint !== fingerprint) {
      clearPlaytestSnapshot(deckId);
      return null;
    }
    // Snapshots saved before E140 have no `gameLog` — load them with an empty one.
    return { ...parsed, gameLog: Array.isArray(parsed.gameLog) ? parsed.gameLog : [] };
  } catch {
    clearPlaytestSnapshot(deckId);
    return null;
  }
}

export function clearPlaytestSnapshot(deckId: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + deckId);
  } catch {
    /* ignore */
  }
}
