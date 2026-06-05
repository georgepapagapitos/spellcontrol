import { describe, it, expect } from 'vitest';
import { createLimiter } from './concurrency-limit';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Let queued microtasks + the limiter's finally→next callback settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createLimiter', () => {
  it('never runs more than `max` tasks at once and still completes them all', async () => {
    const run = createLimiter(2);
    let active = 0;
    let peak = 0;
    const defs = Array.from({ length: 4 }, () => deferred<void>());

    const tasks = defs.map((d) =>
      run(async () => {
        active++;
        peak = Math.max(peak, active);
        await d.promise;
        active--;
      })
    );

    await flush();
    expect(active).toBe(2); // only 2 start; 2 queued

    for (const d of defs) {
      d.resolve();
      await flush(); // frees a slot → a queued task starts
    }
    await Promise.all(tasks);

    expect(peak).toBe(2);
  });

  it('treats max < 1 as 1 (serial)', async () => {
    const run = createLimiter(0);
    const order: number[] = [];
    await Promise.all([
      run(async () => {
        order.push(1);
      }),
      run(async () => {
        order.push(2);
      }),
      run(async () => {
        order.push(3);
      }),
    ]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('propagates task rejection without wedging the queue', async () => {
    const run = createLimiter(1);
    await expect(run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    // A later task still runs (the slot was freed despite the rejection).
    await expect(run(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});
