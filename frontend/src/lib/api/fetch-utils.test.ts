import { afterEach, describe, expect, it, vi } from 'vitest';
import { pending } from '@/test/pending';
import { describeHttpFailure, fetchWithAbortTimeout, handleResponse } from './fetch-utils';

vi.mock('@/lib/util/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

describe('describeHttpFailure', () => {
  it('says what happened and what to do, never the bare status', () => {
    for (const status of [400, 401, 403, 404, 408, 413, 429, 500, 502, 503, 504]) {
      const copy = describeHttpFailure(status);
      expect(copy, String(status)).not.toMatch(/\d{3}/);
      expect(copy, String(status)).toMatch(/\.$/);
    }
    expect(describeHttpFailure(401)).toBe('Sign in to continue.');
    expect(describeHttpFailure(502)).toMatch(/isn't responding/);
  });
});

describe('handleResponse', () => {
  it('prefers the server-authored { error } body', async () => {
    const res = new Response(JSON.stringify({ error: 'That trade was already answered.' }), {
      status: 409,
    });
    const err = await handleResponse(res).catch((e: Error & { status?: number }) => e);
    expect((err as Error).message).toBe('That trade was already answered.');
    expect((err as { status?: number }).status).toBe(409);
  });

  it('keeps a short plain-text body from our own server', async () => {
    const err = await handleResponse(new Response('plain failure', { status: 500 })).catch(
      (e: Error) => e
    );
    expect((err as Error).message).toBe('plain failure');
  });

  it('replaces an HTML gateway page or an empty body with actionable copy', async () => {
    const html = await handleResponse(
      new Response('<html><body>502 Bad Gateway</body></html>', { status: 502 })
    ).catch((e: Error) => e);
    expect((html as Error).message).toMatch(/isn't responding right now/);
    const empty = await handleResponse(new Response('', { status: 404 })).catch((e: Error) => e);
    expect((empty as Error).message).toMatch(/wasn't found/);
  });
});

// E1122: the clock used to stop when the headers arrived, so a body that
// never came hung the caller with no timeout left.
describe('fetchWithAbortTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function outcomeAt(ms: number, run: () => Promise<unknown>) {
    let outcome: unknown = 'pending';
    void run().then(
      (v) => (outcome = v),
      (e: unknown) => (outcome = e)
    );
    await vi.advanceTimersByTimeAsync(ms);
    return () => outcome;
  }

  it.each([
    ['the headers never arrive', () => pending({ ok: true, json: async () => ({}) })],
    [
      'the headers arrive and the body never does',
      async () => ({ ok: true, json: () => pending({}) }),
    ],
  ])('rejects with the timeout copy when %s', async (_, respond) => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(respond));
    const run = () => fetchWithAbortTimeout('/api/x', {}, 1000, 'Timed out.', (res) => res.json());
    const at = await outcomeAt(999, run);
    expect(at()).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(at()).toBeInstanceOf(Error);
    expect((at() as Error).message).toBe('Timed out.');
  });

  it('maps only a failure of the request itself through onFetchError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const transport = await fetchWithAbortTimeout(
      '/api/x',
      {},
      1000,
      'Timed out.',
      async () => 'read',
      () => new Error('mapped')
    ).catch((e: Error) => e);
    expect((transport as Error).message).toBe('mapped');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const fromRead = await fetchWithAbortTimeout(
      '/api/x',
      {},
      1000,
      'Timed out.',
      () => Promise.reject(new Error('from read')),
      () => new Error('mapped')
    ).catch((e: Error) => e);
    expect((fromRead as Error).message).toBe('from read');
  });
});
