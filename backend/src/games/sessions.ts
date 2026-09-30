import crypto from 'crypto';
import { eq, lt } from 'drizzle-orm';
import { getDb } from '../db';
import { gameSessions } from '../db/schema';
import { broadcastGameDeleted } from './live-registry';
import {
  HORDE_MAX_SEATS,
  MAX_ONLINE_SEATS,
  type GameFormat,
  type GameState,
  type GameStatus,
} from './state';

export const VALID_FORMATS: ReadonlyArray<GameFormat> = [
  'commander',
  'standard',
  'modern',
  'pioneer',
  'legacy',
  'vintage',
  'pauper',
  'brawl',
  'casual',
  // Co-op, local-only for now; see local-result.ts's horde-specific parse rules.
  'horde',
];

/** 4-char codes — base32-style without easily-confused chars. ~1M possibilities. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode(): string {
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

/** Postgres unique-constraint violation (SQLSTATE 23505). */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export async function generateUniqueCode(): Promise<string> {
  const db = getDb();
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCode();
    const existing = await db
      .select({ id: gameSessions.id })
      .from(gameSessions)
      .where(eq(gameSessions.code, code))
      .limit(1);
    if (existing.length === 0) return code;
  }
  throw new Error('Could not allocate a unique game code.');
}

export function nextOpenSeat(state: GameState, max: number): number {
  for (let s = 0; s < max; s++) {
    if (!state.players.some((p) => p.seat === s)) return s;
  }
  return state.players.length;
}

/**
 * Sweep sessions older than 24h. Cheap to call inline on creates so we don't
 * need a separate worker.
 *
 * Must broadcast the deletion for every code it sweeps — an SSE stream is
 * otherwise still "healthy" (its 25s heartbeat keeps writing to a genuinely
 * open connection) with nothing left to ever tell it the session is gone, so
 * a swept game would sit on screen looking live forever. `broadcastGameDeleted`
 * is the same teardown host-leave already uses, so this also evicts the
 * code's `boards` entry (see the comment above the `boards` map).
 *
 * Exported so the daily retention sweep (`retention.ts`) reuses this instead
 * of duplicating the 24h game_sessions cleanup — this inline call on session
 * create stays as-is; retention.ts is the backstop for sessions created and
 * then abandoned with no further /api/games POST to trigger a sweep.
 */
export async function sweepStale(): Promise<number> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const db = getDb();
  const deleted = await db
    .delete(gameSessions)
    .where(lt(gameSessions.updatedAt, cutoff))
    .returning({ code: gameSessions.code });
  for (const { code } of deleted) broadcastGameDeleted(code);
  return deleted.length;
}

/**
 * A table gone quiet this long is dropped from the room browser (see GET /
 * below) even though it is far from `sweepStale`'s 24h deletion cutoff. The
 * browser answers "would spectating find anyone home right now", not "does
 * this session still exist" — a lobby or an active game that hasn't mutated
 * in an hour is very likely a tab left open with nobody at the table. The
 * row stays reachable by code (and by `sweepStale`'s own 24h clock) either
 * way; this only hides it from discovery.
 */
export const STALE_LISTING_MS = 60 * 60 * 1000;

/** Page size for GET / (room browser) — newest-active first. */
export const LISTING_PAGE_SIZE = 50;

/** The narrow row the room browser needs — never the full `GameState`,
 *  which carries every seat's account id, deck name and commander. */
export interface GameListing {
  code: string;
  name: string;
  format: GameFormat;
  status: GameStatus;
  seated: number;
  max: number;
  /** True when there is an open seat and the table hasn't started — the
   *  frontend's Join action. Spectating is instead always available once
   *  `status` is 'active' (spectating never claims a seat). */
  joinable: boolean;
  /** `'friends'` rows are visibly marked (only the caller's own friends'
   *  friends-visibility tables are ever returned — see the query below), so
   *  the browser can badge them the same way `FriendDeckSummary.visibility`
   *  drives the "Friends only" deck-tile badge. Never `'private'`: those
   *  rows are excluded before this projection ever runs. */
  visibility: 'public' | 'friends';
  /**
   * Board E370: the COMPUTED bracket range across seated decks that have one
   * (each seat's `bracket` was estimated client-side from the actual deck via
   * `packages/deck-metrics` — see `GamePlayer.bracket`'s doc). `min === max`
   * for a single seated bracket; null when nobody seated has a known one
   * (no deck yet, or an unestimated one) — the row must show nothing rather
   * than guess. This is deliberately the only deck-shaped field the listing
   * exposes: unlike `deckName`/`commander` (never sent here — see the doc
   * above), a bare 1-5 number carries no card-identifying information, so
   * showing it to a stranger deciding whether to join is a small, reversible
   * exposure rather than the privacy question those fields would raise.
   */
  bracket: { min: 1 | 2 | 3 | 4 | 5; max: 1 | 2 | 3 | 4 | 5 } | null;
}

/** A table nobody named falls back to its format, e.g. "Commander table" —
 *  still identifies the game, never a placeholder that reads as broken. */
function fallbackGameName(format: GameFormat): string {
  return `${format.charAt(0).toUpperCase()}${format.slice(1)} table`;
}

/** Project a `GameState` down to what the room browser is allowed to show.
 *  Only ever called on rows the query below already restricted to
 *  `visibility: 'public'` or a `'friends'` row hosted by one of the caller's
 *  own friends — this function does not itself re-check either, so it must
 *  never be handed a `'private'` session's state. */
export function projectGameListing(state: GameState): GameListing {
  const seated = state.players.length;
  const maxSeats = state.format === 'horde' ? HORDE_MAX_SEATS : MAX_ONLINE_SEATS;
  const knownBrackets = state.players
    .map((p) => p.bracket)
    .filter((b): b is 1 | 2 | 3 | 4 | 5 => b != null);
  return {
    code: state.code,
    name: state.name || fallbackGameName(state.format),
    format: state.format,
    status: state.status,
    seated,
    max: maxSeats,
    joinable: state.status === 'lobby' && seated < maxSeats,
    // Only 'public'/'friends' rows ever reach this function (see the doc
    // above), so a bare cast is safe rather than needing a fallback branch.
    visibility: state.visibility as 'public' | 'friends',
    bracket:
      knownBrackets.length === 0
        ? null
        : {
            min: Math.min(...knownBrackets) as 1 | 2 | 3 | 4 | 5,
            max: Math.max(...knownBrackets) as 1 | 2 | 3 | 4 | 5,
          },
  };
}
