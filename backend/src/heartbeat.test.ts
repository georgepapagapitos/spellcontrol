import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeAndPing } from './heartbeat';

vi.mock('./logger', () => ({ logger: { error: vi.fn(), info: vi.fn() } }));

const PING = 'https://hc-ping.com/abc';
const ORIGIN = 'https://example.test';

function stubFetch(health: () => Promise<Response>) {
  const calls: string[] = [];
  const bodies: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url === `${ORIGIN}/health`) return health();
    bodies.push(String(init?.body ?? ''));
    return new Response('OK');
  });
  return { calls, bodies };
}

afterEach(() => vi.unstubAllGlobals());

describe('probeAndPing', () => {
  it('pings the success URL when the public /health answers ok:true', async () => {
    const { calls } = stubFetch(async () => Response.json({ ok: true }));
    await expect(probeAndPing(PING, ORIGIN)).resolves.toBe(true);
    expect(calls).toEqual([`${ORIGIN}/health`, PING]);
  });

  it('pings /fail on a non-2xx, a body without ok:true, or a network error', async () => {
    for (const health of [
      async () => new Response('down', { status: 503 }),
      async () => Response.json({ ok: false }),
      async () => {
        throw new Error('ENOTFOUND');
      },
    ]) {
      const { calls } = stubFetch(health);
      await expect(probeAndPing(PING, ORIGIN)).resolves.toBe(false);
      expect(calls).toEqual([`${ORIGIN}/health`, `${PING}/fail`]);
    }
  });

  it('reports a client-error burst as a failure with the count in the body', async () => {
    const { calls, bodies } = stubFetch(async () => Response.json({ ok: true }));
    const burst = { count: async () => 40, minutes: 15, threshold: 25 };
    await expect(probeAndPing(PING, ORIGIN, burst)).resolves.toBe(false);
    expect(calls).toEqual([`${ORIGIN}/health`, `${PING}/fail`]);
    expect(bodies[0]).toMatch(/40 client errors in the last 15 min/);
  });

  it('stays green at or under the burst threshold, and when the count itself fails', async () => {
    for (const count of [async () => 25, async () => Promise.reject(new Error('db down'))]) {
      const { calls } = stubFetch(async () => Response.json({ ok: true }));
      await expect(probeAndPing(PING, ORIGIN, { count, minutes: 15, threshold: 25 })).resolves.toBe(
        true
      );
      expect(calls).toEqual([`${ORIGIN}/health`, PING]);
    }
  });

  it('pings /fail when the database probe rejects twice, but not on one blip', async () => {
    let n = 0;
    const down = async () => {
      n++;
      throw new Error('ECONNREFUSED');
    };
    const a = stubFetch(async () => Response.json({ ok: true }));
    await expect(probeAndPing(PING, ORIGIN, undefined, down)).resolves.toBe(false);
    expect(n).toBe(2);
    expect(a.calls).toEqual([`${ORIGIN}/health`, `${PING}/fail`]);
    expect(a.bodies[0]).toMatch(/database probe failed/);

    let calls = 0;
    const blip = async () => {
      if (calls++ === 0) throw new Error('slow');
    };
    const b = stubFetch(async () => Response.json({ ok: true }));
    await expect(probeAndPing(PING, ORIGIN, undefined, blip)).resolves.toBe(true);
    expect(b.calls).toEqual([`${ORIGIN}/health`, PING]);
  });

  it('survives the ping delivery itself failing', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url === `${ORIGIN}/health`) return Response.json({ ok: true });
      throw new Error('hc-ping unreachable');
    });
    await expect(probeAndPing(PING, ORIGIN)).resolves.toBe(true);
  });
});
