// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

/**
 * Guard test for the E207 network guard in `setup.ts`.
 *
 * Without this, the guard is one line in a setup file that nothing asserts —
 * a future "tests should be able to hit a local server" change would silently
 * reopen the hole that produced 405 unhandled `ECONNREFUSED ::1:3000` dumps
 * per suite run, and with them the intermittent
 * `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending`
 * that failed 3 of ~8 CI runs on fully green suites.
 *
 * happy-dom is required: a relative URL only resolves against a document
 * origin, which is exactly the case the guard exists for.
 */
describe('test network guard', () => {
  it('rejects an unstubbed relative fetch instead of opening a socket', async () => {
    await expect(fetch('/api/sync')).rejects.toThrow(/Unstubbed network call/);
  });

  it('names the attempted URL so the offending call is findable', async () => {
    await expect(fetch('/api/decks/123')).rejects.toThrow(/\/api\/decks\/123/);
  });

  it('accepts a Request object without throwing on url extraction', async () => {
    await expect(fetch(new Request('https://example.test/cards'))).rejects.toThrow(
      /https:\/\/example\.test\/cards/
    );
  });

  it('still lets a test stub fetch for itself', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"ok":true}'))
    );
    await expect(fetch('/api/sync').then((r) => r.json())).resolves.toEqual({ ok: true });
    vi.unstubAllGlobals();
  });

  it('restores to the guard — not a live socket — after unstubAllGlobals', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}'))
    );
    vi.unstubAllGlobals();
    await expect(fetch('/api/sync')).rejects.toThrow(/Unstubbed network call/);
  });
});
