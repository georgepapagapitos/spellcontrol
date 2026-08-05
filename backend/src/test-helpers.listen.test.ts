/**
 * Guard for issue #1494.
 *
 * `createTestEnv` must hand tests a server that is already listening **on
 * 127.0.0.1**. If it ever goes back to returning the bare Express app,
 * supertest wraps the app in its own server and calls `listen(0)` per request,
 * which binds the wildcard address — and a wildcard bind can be handed a port
 * another local process already holds on 127.0.0.1 (there is no EADDRINUSE
 * across different address tuples). Requests then land on that process instead
 * of Express, and its reply becomes the test result.
 *
 * That is exactly how a Brother printer driver on 127.0.0.1:50000 turned ~3 in
 * 8 full-suite runs into an unexplained HTTP 400 in a random test file.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createTestEnv } from './test-helpers';

let app: Server;
let cleanup: (() => Promise<void>) | undefined;

beforeAll(async () => {
  const env = await createTestEnv();
  app = env.app;
  cleanup = env.cleanup;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

it('listens on 127.0.0.1 so a wildcard port collision cannot reroute requests', () => {
  const address = app.address();
  expect(address).not.toBeNull();
  expect(typeof address).not.toBe('string');
  const { address: host, port } = address as { address: string; port: number };
  expect(host).toBe('127.0.0.1');
  expect(port).toBeGreaterThan(0);
});

it('is already listening, so supertest reuses it instead of binding per request', () => {
  // supertest's `serverAddress()` only calls `listen(0)` when `address()` is
  // null, so a live address is what stops the ~1100-binds-per-run churn.
  expect(app.listening).toBe(true);
});
