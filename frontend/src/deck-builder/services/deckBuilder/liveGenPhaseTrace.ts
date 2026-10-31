// E1061: which build phase put each card in, or took it out, for the live
// panel's stability report (frontend/scripts/gen-stability.mjs).
//
// The build report records four late passes (coherence, budget, surplus,
// search); the other phases that move cards (smart trim, combo audit, fixup,
// flagship seating, bracket convergence, the staple guarantee, the budget last
// resort) leave no row, so churn they cause read as "earlier". The live test
// wraps each phase function with `tracePhase`, which snapshots the deck's card
// names after the phase returns. Test-only: production code never imports this.

type Snapshot = { phase: string; names: string[] };
type TraceHolder = { __phaseTrace?: Snapshot[] };
type StateLike = { categories: Record<string, Array<{ name: string }>> };

/** Empty the trace; the live test calls this before each deck. */
export function resetPhaseTrace(): void {
  (globalThis as TraceHolder).__phaseTrace = [];
}

/** The snapshots taken since the last reset, in run order (null when never reset). */
export function readPhaseTrace(): Snapshot[] | null {
  return (globalThis as TraceHolder).__phaseTrace ?? null;
}

function snapshot(phase: string, state: StateLike): void {
  const trace = (globalThis as TraceHolder).__phaseTrace;
  if (!trace) return;
  trace.push({
    phase,
    names: Object.values(state.categories)
      .flat()
      .map((c) => c.name),
  });
}

/**
 * `fn` (a phase taking the generation state first) that snapshots the deck
 * after it returns. The first call also snapshots the deck as it arrived, as
 * `pick`: everything before the first wrapped phase is card picking.
 */
export function tracePhase<A extends [StateLike, ...unknown[]], R>(
  phase: string,
  fn: (...args: A) => R
): (...args: A) => R {
  return (...args: A): R => {
    const trace = (globalThis as TraceHolder).__phaseTrace;
    if (trace && trace.length === 0) snapshot('pick', args[0]);
    const out = fn(...args);
    if (out instanceof Promise) {
      return out.then((v) => {
        snapshot(phase, args[0]);
        return v;
      }) as R;
    }
    snapshot(phase, args[0]);
    return out;
  };
}
