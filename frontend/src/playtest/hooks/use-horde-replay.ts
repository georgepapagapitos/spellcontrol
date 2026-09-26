import { useEffect, useMemo, useState, useCallback } from 'react';
import { logger } from '@/lib/logger';
import type { GameState } from '@/lib/game-state';
import { loadHordeDeck, replayHorde, type HordeDeckDef, type HordeReplay } from '@/lib/horde';
import type { Rect } from '@/playtest/lib/auto-place';

export type HordeReplayStatus = 'none' | 'loading' | 'error' | 'skew' | 'ready';

export interface UseHordeReplayResult {
  status: HordeReplayStatus;
  error: string | null;
  retry(): void;
  replay: HordeReplay | null;
}

/**
 * Rebuilds `game.horde`'s board on THIS device by replaying its step log
 * through `replayHorde` — the same deterministic rebuild every seat and
 * spectator runs. `none` for a non-horde (or absent) game; `skew` when this
 * device's copy of the deck doesn't match the one the table was built from
 * (`HordeDeckDef.rev` vs `HordeTable.deckRev`) — never replay against the
 * wrong deck data. No network beyond the lazy `loadHordeDeck` import.
 */
export function useHordeReplay(game: GameState | null, rect: Rect | null): UseHordeReplayResult {
  const hordeId = game?.horde?.hordeId ?? null;

  // A per-hook-instance cache: once a hordeId has been loaded, a later
  // render for the same id (or a return to it) skips the fetch. Held in
  // state (not a ref) so its `.get()` can be read directly during render —
  // reading a ref during render is unsafe; reading state is not.
  const [cache] = useState<Map<string, HordeDeckDef>>(() => new Map());
  const [loadedDef, setLoadedDef] = useState<HordeDeckDef | null>(null);
  // Scoped to the hordeId it happened for — a failure on a PREVIOUS hordeId
  // must not read as this render's status once the table has moved on.
  const [loadError, setLoadError] = useState<{ hordeId: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  const cachedDef = hordeId ? (cache.get(hordeId) ?? null) : null;
  // `loadedDef` only matters for the hordeId it was fetched for — a stale
  // value from a PREVIOUS hordeId must never replay against a different
  // table (it's also mirrored into `cache` the same render its fetch
  // resolves, so this mostly covers the one render before that lands).
  const def = cachedDef ?? (loadedDef && loadedDef.id === hordeId ? loadedDef : null);
  const scopedError = loadError && loadError.hordeId === hordeId ? loadError.message : null;

  useEffect(() => {
    if (!hordeId || cache.has(hordeId)) return;
    let cancelled = false;
    loadHordeDeck(hordeId)
      .then((loaded) => {
        if (cancelled) return;
        cache.set(hordeId, loaded);
        setLoadedDef(loaded);
      })
      .catch((err) => {
        if (cancelled) return;
        logger.warn('[use-horde-replay] failed to load deck', hordeId, err);
        setLoadError({ hordeId, message: "Couldn't load the horde." });
      });
    return () => {
      cancelled = true;
    };
  }, [hordeId, attempt, cache]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const table = game?.horde ?? null;
  const life = game?.players[0]?.life ?? 0;
  const skew = !!(def && table && def.rev !== table.deckRev);

  const replay = useMemo(() => {
    if (!def || !table || skew) return null;
    return replayHorde(def, table, life, rect);
    // Keyed on the table object, life, and the rect's SIZE (not its identity —
    // a fresh measurement every render must not force a fresh replay).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, table, life, rect?.width, rect?.height, rect?.cardW, rect?.cardH, skew]);

  let status: HordeReplayStatus;
  if (!table) status = 'none';
  else if (skew) status = 'skew';
  else if (scopedError) status = 'error';
  else if (!def) status = 'loading';
  else status = 'ready';

  return { status, error: status === 'error' ? scopedError : null, retry, replay };
}
