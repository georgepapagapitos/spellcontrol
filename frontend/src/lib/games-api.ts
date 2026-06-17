import { authedFetch, handleResponse } from './fetch-utils';
import type { GameAction, GameState } from './game-state';

export interface CreateGameInput {
  format: GameState['format'];
  startingLife: number;
  commanderDamageEnabled: boolean;
  poisonEnabled: boolean;
  hostName?: string;
  hostDeckId?: string | null;
  hostDeckName?: string | null;
  hostCommander?: string | null;
  hostColorIdentity?: string[];
}

export async function createGame(input: CreateGameInput): Promise<GameState> {
  const res = await authedFetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await handleResponse<{ game: GameState }>(res);
  return data.game;
}

/**
 * Fetch a game's current state. When `knownVersion` is supplied the server may
 * answer `{ unchanged: true }` (the version still matches), in which case this
 * resolves to `null` so the caller can skip the update entirely — no full
 * `GameState` payload crosses the wire. Call without `knownVersion` to always
 * get the full state.
 */
export async function getGame(code: string, knownVersion?: number): Promise<GameState | null> {
  const path = `/api/games/${encodeURIComponent(code)}`;
  const url = knownVersion != null ? `${path}?knownVersion=${knownVersion}` : path;
  const res = await authedFetch(url);
  const data = await handleResponse<{ game?: GameState; unchanged?: boolean }>(res);
  return data.unchanged ? null : (data.game ?? null);
}

export interface JoinGameInput {
  name?: string;
  deckId?: string | null;
  deckName?: string | null;
  commander?: string | null;
  colorIdentity?: string[];
}

export async function joinGame(code: string, input: JoinGameInput): Promise<GameState> {
  const res = await authedFetch(`/api/games/${encodeURIComponent(code)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await handleResponse<{ game: GameState }>(res);
  return data.game;
}

export async function patchGame(
  code: string,
  baseVersion: number,
  actions: GameAction[]
): Promise<{ game: GameState; conflict?: GameState }> {
  const res = await authedFetch(`/api/games/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseVersion, actions }),
  });
  if (res.status === 409) {
    const body = (await res.json()) as { current?: GameState };
    return { game: body.current!, conflict: body.current };
  }
  const data = await handleResponse<{ game: GameState }>(res);
  return { game: data.game };
}

export async function leaveGame(code: string): Promise<{ deleted?: boolean; game?: GameState }> {
  const res = await authedFetch(`/api/games/${encodeURIComponent(code)}/leave`, {
    method: 'POST',
  });
  return handleResponse<{ deleted?: boolean; game?: GameState }>(res);
}
