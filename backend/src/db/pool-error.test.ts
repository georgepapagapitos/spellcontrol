import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Pool } from 'pg';
import { setDbForTesting } from './index';
import type { Database } from './index';

/**
 * The pool MUST have an `error` listener.
 *
 * `pg` emits `'error'` on the pool when a client dies while idle — no query is
 * in flight, so there is no promise to reject. Node treats an unhandled
 * `'error'` event as fatal, so a missing listener means the whole server exits
 * 1 on something that is routine: Neon recycles serverless compute and drops
 * idle connections by design.
 *
 * This crash-looped production for ~40 minutes on 2026-08-17 (`error: server
 * conn crashed?` out of pg-protocol, `exit_code=1, oom_killed=false`). The
 * failure is invisible in app logs — it only shows in the machine's exit
 * events — so a test is the only thing that will notice if the listener is
 * ever dropped in a refactor.
 */
describe('pg pool error handling', () => {
  afterEach(() => vi.restoreAllMocks());

  it('attaches an error listener to an injected pool', () => {
    const p = new Pool({ connectionString: 'postgres://unused/never-connected' });
    expect(p.listenerCount('error')).toBe(0);
    setDbForTesting(p, {} as Database);
    expect(p.listenerCount('error')).toBeGreaterThan(0);
    void p.end().catch(() => {});
  });

  it('an idle-client error is logged, not thrown', () => {
    const p = new Pool({ connectionString: 'postgres://unused/never-connected' });
    setDbForTesting(p, {} as Database);
    // Exactly the shape Neon produces: an error event on the pool with nothing
    // awaiting it. Before the fix this propagated as an uncaught exception.
    expect(() => p.emit('error', new Error('server conn crashed?'), {} as never)).not.toThrow();
    void p.end().catch(() => {});
  });

  it('gives every CONNECTED client its own error listener', () => {
    // The pool-level handler does NOT cover a checked-out client: from
    // connect() to release() the borrower owns it. routes/sync.ts holds one
    // across a long transaction, and every drizzle `db.transaction()` (combos
    // ingest, aggregates rollup, feedback) checks one out internally. Shipping
    // only the pool handler (#1651) left production still crash-looping, so
    // this pins the second listener.
    const p = new Pool({ connectionString: 'postgres://unused/never-connected' });
    setDbForTesting(p, {} as Database);
    const client = new EventEmitter();
    p.emit('connect', client as never);
    expect(client.listenerCount('error')).toBeGreaterThan(0);
    expect(() => client.emit('error', new Error('server conn crashed?'))).not.toThrow();
    void p.end().catch(() => {});
  });
});
