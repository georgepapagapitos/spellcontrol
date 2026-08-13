import { useState } from 'react';

/**
 * Diffs a list of card ids against everything seen so far by this mount,
 * returning only the ids that are new THIS render. Used to animate a
 * permanent's tile once, the first time it appears for a seat — never on a
 * whole-board republish of cards already there (opponent boards arrive as
 * full snapshots roughly every ~150ms of activity, so a naive "animate
 * whatever's rendered" reads every republish — or the very first one — as N
 * simultaneous arrivals and floods the board). The first-ever render seeds
 * the baseline with zero "new" ids, so a seat's first-ever board — or the
 * first board after this component remounts (e.g. reconnect catch-up) —
 * never animates. Its own module (not part of `OpponentRail`) because both
 * `OpponentRail` and `OpponentBoardModal` need it and the rail already
 * imports the modal — exporting it from the rail was a value-level import
 * cycle (see import-cycles.test.ts: move the shared leaf DOWN).
 */
export function useNewCardIds(ids: readonly string[]): ReadonlySet<string> {
  // Lazily seeded from the FIRST render's ids — so a seat's first-ever board
  // never needs a special "is this the baseline?" branch below; it's simply
  // already fully in `seen` before `newIds` is ever computed.
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set(ids));
  // The caller maps its board straight into this array inline, so `ids` is a
  // FRESH array on every render — including React's own immediate replay of
  // a render-phase state update below (the replay re-runs the whole calling
  // component, re-creating that `.map()` again). Comparing `ids` by
  // reference would never go stable, looping forever. A joined content key
  // is a plain string primitive: it compares by VALUE, so it reads equal
  // across the replay even though the backing array is a new object.
  const key = ids.join(' ');
  const [prevKey, setPrevKey] = useState(key);
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(() => new Set());

  // "Adjusting state when a prop changes" (react.dev), done directly in the
  // render body rather than an effect+setState — the latter is exactly what
  // `react-hooks/set-state-in-effect` flags for state purely derived from a
  // prop, and reading a ref instead would trip `react-hooks/refs` (refs
  // can't be read during render). This can't be a plain `useMemo` off `seen`
  // either: a memo re-derives `newIds` from `seen` on EVERY pass, including
  // React's own immediate replay of the `setSeen` call below — by the time
  // that replay's memo runs, `seen` already contains the id that was "new" a
  // moment ago, so the memo would always settle on empty. Gating on
  // `key !== prevKey` avoids that: once `prevKey` is updated, the guard is
  // false on the replay, so `newIds` (set below, in the pass that's
  // discarded but whose STATE updates persist) is what actually commits.
  if (key !== prevKey) {
    setPrevKey(key);
    const fresh = ids.filter((id) => !seen.has(id));
    if (fresh.length > 0 || newIds.size > 0) setNewIds(new Set(fresh));
    if (fresh.length > 0) {
      setSeen((prev) => {
        const merged = new Set(prev);
        for (const id of fresh) merged.add(id);
        return merged;
      });
    }
  }

  return newIds;
}
