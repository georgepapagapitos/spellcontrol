/**
 * Wrap a pure function so every caller shares its last few results, matched by
 * argument identity (`Object.is` on each argument).
 *
 * A `useMemo` is per component instance: two surfaces that derive the same
 * decorated card list each get their own array, and anything keyed on that
 * array's identity downstream (the materialize memo) misses for both. Routing
 * the derivation through one of these makes the same inputs give the same
 * reference everywhere (E1049). Callers treat results as read-only.
 */
export function memoByArgs<A extends unknown[], R>(fn: (...args: A) => R, size = 4) {
  const recent: { args: A; result: R }[] = [];
  return (...args: A): R => {
    const i = recent.findIndex(
      (e) => e.args.length === args.length && e.args.every((a, j) => Object.is(a, args[j]))
    );
    if (i >= 0) {
      const [hit] = recent.splice(i, 1);
      recent.unshift(hit);
      return hit.result;
    }
    const result = fn(...args);
    recent.unshift({ args, result });
    if (recent.length > size) recent.length = size;
    return result;
  };
}
