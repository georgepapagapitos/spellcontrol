import { describe, expect, it, vi } from 'vitest';
import { describeHttpFailure, handleResponse } from './fetch-utils';

vi.mock('./logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

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
