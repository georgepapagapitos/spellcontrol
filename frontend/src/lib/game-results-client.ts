import { apiUrl } from './api-base';
import type { GameEvent, GameRecord, GameState, GameSummary } from './game-state';

/** One friend's shared-game W/L, as returned by GET /api/game-results/leaderboard. */
export interface LeaderboardEntry {
  friendId: string;
  friendUsername: string;
  friendDisplayName: string | null;
  gamesPlayed: number;
  callerWins: number;
  friendWins: number;
  lastPlayedAt: number;
}

export interface GameResultParticipant {
  seat: number;
  userId: string | null;
  username: string | null;
  name: string;
  deckId: string | null;
  deckName: string | null;
  commander: string | null;
  colorIdentity: string[];
  finalLife: number;
  eliminated: boolean;
}

export interface PublicGameResult {
  sessionId: string;
  code: string;
  /** 'online' (server-written) or 'local' (posted by the device that tracked
   *  the table). One table holds both; every read counts both unless asked
   *  to split. */
  mode: 'local' | 'online';
  /** Who posted a local result; null for online rows. Only they may delete it. */
  recordedByUserId: string | null;
  /** Who hosted an online game — the only account that may delete that row.
   *  Null for local rows and for online rows recorded before it was captured. */
  hostUserId: string | null;
  format: string;
  startingLife: number;
  winnerSeat: number | null;
  winnerUserId: string | null;
  startedAt: number | null;
  endedAt: number;
  durationMs: number;
  participants: GameResultParticipant[];
  /** Whitelisted eliminate/end/designation events (selectNotableEvents),
   *  null for a pre-migration row. Not yet rendered on the H2H page —
   *  carried here so a future head-to-head notable-moments display has the
   *  right shape without another round-trip. */
  notableEvents: GameEvent[] | null;
  /** Derived stats (summarizeGame) captured at record time; null for a
   *  pre-migration row. Carried into `GameRecord.summary` by resultToRecord. */
  summary?: GameSummary | null;
}

export type GameResultMode = PublicGameResult['mode'];

export interface DeckMatchup {
  callerDeckId: string | null;
  callerDeckName: string | null;
  friendDeckId: string | null;
  friendDeckName: string | null;
  callerWins: number;
  friendWins: number;
  played: number;
}

export interface H2HResponse {
  friend: { id: string; username: string; displayName: string | null };
  results: PublicGameResult[];
  summary: {
    gamesPlayed: number;
    callerWins: number;
    friendWins: number;
    deckMatchups: DeckMatchup[];
    /**
     * Games in this pairing carrying a derived summary — the denominator for
     * the rivalry fields below, and **not** `gamesPlayed`: games recorded
     * before summaries existed contribute nothing. `ratedGames === 0` (or
     * absent, on an older backend) means "no rivalry data", and the block
     * must be hidden rather than rendered as a row of zeroes.
     */
    ratedGames?: number;
    callerAvgPlacement?: number | null;
    friendAvgPlacement?: number | null;
    callerFirstBlood?: number;
    friendFirstBlood?: number;
    /** Times each knocked the *other* out specifically, not total KOs. */
    callerKos?: number;
    friendKos?: number;
  };
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

function modeQuery(mode: GameResultMode | null | undefined): string {
  return mode ? `?mode=${mode}` : '';
}

/** `mode` narrows to one surface; omit it to count local and online alike. */
export async function fetchLeaderboard(mode?: GameResultMode | null): Promise<LeaderboardEntry[]> {
  const res = await fetch(apiUrl(`/api/game-results/leaderboard${modeQuery(mode)}`), {
    credentials: 'include',
  });
  if (!res.ok)
    throw new Error(await readError(res, "Couldn't load the leaderboard. Try again in a moment."));
  const body = (await res.json()) as { leaderboard: LeaderboardEntry[] };
  return body.leaderboard;
}

export async function fetchH2H(
  friendId: string,
  mode?: GameResultMode | null
): Promise<H2HResponse> {
  const res = await fetch(
    apiUrl(`/api/game-results/h2h/${encodeURIComponent(friendId)}${modeQuery(mode)}`),
    { credentials: 'include' }
  );
  if (!res.ok)
    throw new Error(
      await readError(res, "Couldn't load your head-to-head record. Try again in a moment.")
    );
  return (await res.json()) as H2HResponse;
}

/**
 * The caller's own history from the canonical table: every game they held a
 * seat in (either mode) plus every local game they recorded. Newest first;
 * `nextCursor` pages further back.
 */
export async function fetchMyResults(
  opts: {
    mode?: GameResultMode | null;
    limit?: number;
    before?: string | null;
    /** True asks for the rows the caller has hidden, instead of the rest. */
    hidden?: boolean;
  } = {}
): Promise<MyResultsPage> {
  const params = new URLSearchParams();
  if (opts.mode) params.set('mode', opts.mode);
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.before) params.set('before', opts.before);
  if (opts.hidden) params.set('hidden', '1');
  const qs = params.toString();
  const res = await fetch(apiUrl(`/api/game-results/mine${qs ? `?${qs}` : ''}`), {
    credentials: 'include',
  });
  if (!res.ok)
    throw new Error(await readError(res, "Couldn't load your games. Try again in a moment."));
  return (await res.json()) as MyResultsPage;
}

export interface MyResultsPage {
  results: PublicGameResult[];
  nextCursor: string | null;
  /** How many rows this account has hidden, on every page — so the History
   *  tab can offer them back without a speculative extra request. */
  hiddenCount: number;
}

/**
 * Attribution this account is correcting on a game it recorded: who won, and
 * which deck sat where. A seat the list omits keeps the deck it had.
 */
export interface GameResultEdit {
  winnerSeat: number | null;
  decks: {
    seat: number;
    deckId: string | null;
    deckName: string | null;
    commander: string | null;
    colorIdentity: string[];
  }[];
}

/**
 * Correct a local game the caller recorded. Only the winner and the deck
 * labels move: everything the device witnessed (life, elimination, timings)
 * is the record, not an editable field.
 */
export async function patchGameResult(
  sessionId: string,
  edit: GameResultEdit
): Promise<PublicGameResult> {
  const res = await fetch(apiUrl(`/api/game-results/${encodeURIComponent(sessionId)}`), {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(edit),
  });
  if (!res.ok) throw new Error(await readError(res, "Couldn't save that change."));
  const body = (await res.json()) as { result: PublicGameResult };
  return body.result;
}

/**
 * Drop an online game out of this account's history list, or (`hidden: false`)
 * put it back. The row itself is the table's shared record and is untouched —
 * every stats read still counts the game.
 */
export async function setGameResultHidden(sessionId: string, hidden: boolean): Promise<void> {
  const res = await fetch(apiUrl(`/api/game-results/${encodeURIComponent(sessionId)}/hidden`), {
    method: hidden ? 'PUT' : 'DELETE',
    credentials: 'include',
  });
  if (!res.ok)
    throw new Error(
      await readError(res, hidden ? "Couldn't hide that game." : "Couldn't bring that game back.")
    );
}

/**
 * Record a finished LOCAL game. The server enforces shape and that every
 * credited seat is the caller or an accepted friend. Idempotent on the game
 * id: a retry after a dropped response gets the existing row back.
 */
export async function postLocalResult(game: GameState): Promise<PublicGameResult> {
  const res = await fetch(apiUrl('/api/game-results'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ game }),
  });
  if (!res.ok) {
    const err = new Error(
      await readError(res, "Couldn't save the game to your record.")
    ) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  const body = (await res.json()) as { result: PublicGameResult };
  return body.result;
}

/** Remove a local game the caller recorded. Online rows can't be removed. */
export async function deleteGameResult(sessionId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/game-results/${encodeURIComponent(sessionId)}`), {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await readError(res, "Couldn't remove that game."));
}

/**
 * The canonical row in the shape the Play page, deck records and matchup
 * tables already consume — so a game read back from the server aggregates
 * exactly like one recorded on this device a moment ago.
 */
export function resultToRecord(r: PublicGameResult): GameRecord {
  return {
    id: r.sessionId,
    code: r.code,
    format: r.format as GameRecord['format'],
    startingLife: r.startingLife,
    players: r.participants.map((p) => ({
      seat: p.seat,
      userId: p.userId,
      name: p.name,
      deckId: p.deckId,
      deckName: p.deckName,
      commander: p.commander,
      finalLife: p.finalLife,
      eliminated: p.eliminated,
    })),
    winnerSeat: r.winnerSeat,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    durationMs: r.durationMs,
    mode: r.mode,
    recordedByUserId: r.recordedByUserId,
    ...(r.hostUserId !== null ? { hostUserId: r.hostUserId } : {}),
    ...(r.summary ? { summary: r.summary } : {}),
  };
}
