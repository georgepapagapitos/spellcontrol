import { useEffect, useMemo, useRef, useState } from 'react';
import { matchCombos } from './api/combos';
import type { ComboMatchResponse } from '../types/combos';

interface Args {
  /** Oracle ids of every card currently in the deck (commander + main + side). */
  deckOracleIds: string[];
  /** Oracle ids of every card the user owns in their collection. */
  ownedOracleIds: string[];
  /** Format used to filter combos by legality (e.g. "commander"). Optional. */
  format?: string;
  /** When false, the hook does nothing — useful while a panel is closed. */
  enabled?: boolean;
}

interface State {
  data: ComboMatchResponse | null;
  loading: boolean;
  error: string | null;
}

const DEBOUNCE_MS = 250;

/**
 * Module-scoped cache so toggling the panel or switching tabs reuses the
 * previous result instantly. Keyed by a stable hash of the inputs. Same idea
 * as Spellbook's findMyCombosResultsCache.
 */
const cache = new Map<string, ComboMatchResponse>();
const CACHE_LIMIT = 32;

function buildKey(deck: string[], owned: string[], format: string | undefined): string {
  // Sort so order doesn't fragment the cache. Inputs aren't huge for any one
  // deck, so a join is fine.
  return [
    format ?? '',
    [...deck].sort().join(','),
    [...owned].sort().join(','),
  ].join('|');
}

function rememberCache(key: string, value: ComboMatchResponse): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, value);
}

export function useDeckCombos(args: Args): State {
  const { deckOracleIds, ownedOracleIds, format, enabled = true } = args;

  const key = useMemo(
    () => buildKey(deckOracleIds, ownedOracleIds, format),
    [deckOracleIds, ownedOracleIds, format]
  );

  // Render-phase state reset when the input key changes. Mirrors the
  // prevState pattern used elsewhere in the codebase (DeckEditorPage's color
  // popover, etc.) — keeps setState out of useEffect so the React lint rule
  // banning "setState during effect" stays happy.
  const [trackedKey, setTrackedKey] = useState(key);
  const [state, setState] = useState<State>(() => {
    const cached = cache.get(key);
    return cached
      ? { data: cached, loading: false, error: null }
      : { data: null, loading: enabled, error: null };
  });
  if (trackedKey !== key) {
    setTrackedKey(key);
    const cached = cache.get(key);
    setState(
      cached
        ? { data: cached, loading: false, error: null }
        : { data: null, loading: enabled, error: null }
    );
  }

  // Track the latest in-flight request so a stale response doesn't overwrite
  // a fresher one.
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    if (cache.has(key)) return; // already served by the render-phase reset

    const myReqId = ++reqIdRef.current;
    const timer = window.setTimeout(() => {
      matchCombos({
        ownedOracleIds,
        deckOracleIds: deckOracleIds.length > 0 ? deckOracleIds : undefined,
        format,
      })
        .then((data) => {
          if (reqIdRef.current !== myReqId) return;
          rememberCache(key, data);
          setState({ data, loading: false, error: null });
        })
        .catch((err: Error) => {
          if (reqIdRef.current !== myReqId) return;
          setState({ data: null, loading: false, error: err.message ?? 'Failed to load combos.' });
        });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
    // We intentionally key on `key` only (not the underlying arrays); `key`
    // is derived from the array contents so it covers both, and reading the
    // arrays via closure is fine because the effect re-runs whenever they
    // change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return state;
}

export const __testing = { cache, buildKey };
