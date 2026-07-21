import { useEffect, useMemo, useRef, useState } from 'react';
import { matchCombos } from './api/combos';
import type { ComboMatch, ComboMatchResponse } from '../types/combos';

interface Args {
  /** Oracle ids of every card currently in the deck (commander + main + side). */
  deckOracleIds: string[];
  /** Oracle ids of every card the user owns in their collection. */
  ownedOracleIds: string[];
  /** Format used to filter combos by legality (e.g. "commander"). Optional. */
  format?: string;
  /**
   * The deck's color identity (WUBRG letters — the commander(s)'). When set,
   * the suggestion buckets (`oneAway` / `almostInCollection`) drop combos whose
   * own identity escapes it: their missing piece could never legally join the
   * deck. `inDeck` is never filtered — a combo already assembled in the deck is
   * a fact, not a suggestion. Omit (undefined) for formats with no identity
   * restriction; an empty array is a colorless commander and filters strictly.
   */
  colorIdentity?: readonly string[];
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
  return [format ?? '', [...deck].sort().join(','), [...owned].sort().join(',')].join('|');
}

/**
 * Filter the suggestion buckets to combos whose identity (Spellbook format,
 * e.g. "wub", or "c" for colorless) fits inside the deck's identity letters.
 * `identityKey` null = no restriction; '' = colorless commander. An unknown
 * combo identity ('') always fits — never over-filter on missing data.
 */
function filterByIdentity(
  data: ComboMatchResponse,
  identityKey: string | null
): ComboMatchResponse {
  if (identityKey === null) return data;
  const allowed = new Set(identityKey);
  const fits = (m: ComboMatch) =>
    [...m.combo.identity.toUpperCase()].every((ch) => ch === 'C' || allowed.has(ch));
  return {
    inDeck: data.inDeck,
    oneAway: data.oneAway.filter(fits),
    almostInCollection: data.almostInCollection.filter(fits),
  };
}

function rememberCache(key: string, value: ComboMatchResponse): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, value);
}

export function useDeckCombos(args: Args): State {
  const { deckOracleIds, ownedOracleIds, format, colorIdentity, enabled = true } = args;
  // Stable string key so the filter memo survives an unstable array reference.
  const identityKey = colorIdentity
    ? [...colorIdentity]
        .map((c) => c.toUpperCase())
        .sort()
        .join('')
    : null;

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

  // Identity filtering happens on the way out (the cache stays raw): the key
  // above doesn't include identity, but identity is a function of the deck's
  // commander, which is part of deckOracleIds — same key ⇒ same identity.
  const data = useMemo(
    () => (state.data ? filterByIdentity(state.data, identityKey) : null),
    [state.data, identityKey]
  );

  return { ...state, data };
}

export const __testing = { cache, buildKey, filterByIdentity };
