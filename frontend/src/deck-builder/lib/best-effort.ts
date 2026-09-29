/**
 * One shared deadline for the best-effort steps inside a single operation.
 *
 * `analyzeCommanderDeck` awaits several Scryfall enrichments that are nice to
 * have (prices for the cost plan, card data for synergy candidates, oracle
 * searches for off-meta picks). When Scryfall answers 429 the shared limiter
 * parks its whole queue for the Retry-After window, one of those awaits blocks
 * past the caller's 20s stall timer, and the stall throws away the bracket,
 * roles and gaps that were already computed. With a budget, the optional steps
 * degrade to their fallback and the essentials still land.
 *
 * The budget is shared, not per step: three steps cannot each spend the full
 * allowance and blow the outer timer together.
 */
export function bestEffortBudget(ms: number) {
  const deadline = Date.now() + ms;
  return async function within<T>(work: Promise<T>, fallback: T): Promise<T> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return fallback;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settle = (): void => {};
    const timeout = new Promise<T>((resolve) => {
      settle = () => resolve(fallback);
      timer = setTimeout(settle, remaining);
    });
    try {
      return await Promise.race([work, timeout]);
    } catch {
      return fallback;
    } finally {
      // Settle the loser too: a cleared timer would otherwise leave `timeout`
      // (and the race's subscription to it) pending forever.
      clearTimeout(timer);
      settle();
    }
  };
}
