/**
 * A minimal promise concurrency limiter. `createLimiter(n)` returns a `run`
 * function that caps how many wrapped tasks execute at once; excess tasks queue
 * and start as slots free up. Used to throttle the lazy per-row commander-summary
 * fetches so scrolling a long product list doesn't fire 50 requests at once.
 */
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  const limit = Math.max(1, max);
  let active = 0;
  const queue: (() => void)[] = [];

  const next = () => {
    active--;
    const start = queue.shift();
    if (start) start();
  };

  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        active++;
        task().then(resolve, reject).finally(next);
      };
      if (active < limit) start();
      else queue.push(start);
    });
  };
}
