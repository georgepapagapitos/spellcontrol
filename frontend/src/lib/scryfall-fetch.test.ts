import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getScryfallStats,
  parseRetryAfter,
  resetScryfallRateLimit,
  resetScryfallStats,
  scryfallFetch,
  scryfallRequest,
} from './scryfall-fetch';

const ok = (body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  resetScryfallRateLimit();
  resetScryfallStats();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  resetScryfallRateLimit();
});

describe('parseRetryAfter', () => {
  it('reads the delta-seconds form', () => {
    expect(parseRetryAfter('60')).toBe(60_000);
  });

  // The bug this covers: `Number('Wed, 21 Oct 2015 07:28:00 GMT')` is NaN, so a
  // dated header used to fall through to our own backoff — ignoring the one
  // authoritative answer to "how long should we wait?".
  it('reads the HTTP-date form', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2015-10-21T07:28:00Z'));
    expect(parseRetryAfter('Wed, 21 Oct 2015 07:28:30 GMT')).toBe(30_000);
  });

  it('never returns a negative wait for a date already in the past', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2015-10-21T07:28:00Z'));
    expect(parseRetryAfter('Wed, 21 Oct 2015 07:00:00 GMT')).toBe(0);
  });

  it('returns null for a missing or unparseable header', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

describe('scryfallRequest', () => {
  it('retries a 429 and succeeds, honoring Retry-After', async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('slow down', { status: 429, headers: { 'Retry-After': '2' } });
      }
      return ok({ fine: true });
    });

    const pending = scryfallRequest('/cards/named?exact=Sol%20Ring');
    await vi.runAllTimersAsync();

    expect((await pending).status).toBe(200);
    expect(calls).toBe(2);
  });

  it('gives up after the retry cap on a sustained 429 and returns the failing response', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('rate limited', { status: 429 }));

    const pending = scryfallRequest('/cards/search?q=sustained');
    await vi.runAllTimersAsync();

    expect((await pending).status).toBe(429);
    // 1 initial attempt + 4 retries.
    expect(fetchSpy.mock.calls.length).toBe(5);
  });

  // The whole point of the module. Before the shared cooldown, a 429 backed off
  // only the request that earned it while the limiter kept releasing every other
  // queued request at 100ms — so a throttled burst went right on striking through
  // the entire cooldown, deepening the block.
  it('parks OTHER in-flight callers for the cooldown after a single 429', async () => {
    vi.useFakeTimers();
    const hits: Array<{ url: string; at: number }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      hits.push({ url, at: Date.now() });
      // Only the first request is throttled; everything else is fine.
      if (hits.length === 1) {
        return new Response('slow down', { status: 429, headers: { 'Retry-After': '5' } });
      }
      return ok({ fine: true });
    });

    const start = Date.now();
    const throttled = scryfallRequest('/cards/search?q=first');
    // Queued behind it, and innocent — but it must NOT be released during the
    // cooldown the first request just triggered.
    const bystander = scryfallRequest('/cards/search?q=second');
    await vi.runAllTimersAsync();
    await Promise.all([throttled, bystander]);

    const bystanderHit = hits.find((h) => h.url.includes('second'));
    expect(bystanderHit).toBeDefined();
    expect(bystanderHit!.at - start).toBeGreaterThanOrEqual(5_000);
  });

  it('spaces sequential requests by the minimum delay', async () => {
    vi.useFakeTimers();
    const at: number[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      at.push(Date.now());
      return ok();
    });

    const pending = Promise.all([
      scryfallRequest('/cards/named?exact=A'),
      scryfallRequest('/cards/named?exact=B'),
    ]);
    await vi.runAllTimersAsync();
    await pending;

    expect(at).toHaveLength(2);
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(100);
  });
});

// The tally is the only way we can answer "did the 429s actually stop?" —
// client-side throttling never reaches our server.
describe('scryfall stats', () => {
  it('counts every request, including retries', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());

    await scryfallRequest('/cards/named?exact=A');
    await scryfallRequest('/cards/named?exact=B');

    expect(getScryfallStats()).toMatchObject({ requests: 2, throttled: 0, gaveUp: 0 });
  });

  it('counts a 429, the retry it caused, and the time parked', async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('slow down', { status: 429, headers: { 'Retry-After': '3' } });
      }
      return ok();
    });

    const pending = scryfallRequest('/cards/search?q=x');
    await vi.runAllTimersAsync();
    await pending;

    const s = getScryfallStats();
    expect(s.throttled).toBe(1);
    // The retry is a second request — the count is what we SENT, not what we asked for.
    expect(s.requests).toBe(2);
    expect(s.gaveUp).toBe(0);
    expect(s.cooldownMs).toBeGreaterThanOrEqual(3000);
  });

  it('records a request that burned every retry', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no', { status: 429 }));

    const pending = scryfallRequest('/cards/search?q=sustained');
    await vi.runAllTimersAsync();
    await pending;

    const s = getScryfallStats();
    expect(s.gaveUp).toBe(1);
    expect(s.requests).toBe(5); // 1 attempt + 4 retries
    expect(s.throttled).toBe(5);
  });

  it('separates 503 from 429 so an outage does not read as throttling', async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls += 1;
      return calls === 1 ? new Response('down', { status: 503 }) : ok();
    });

    const pending = scryfallRequest('/cards/named?exact=A');
    await vi.runAllTimersAsync();
    await pending;

    expect(getScryfallStats()).toMatchObject({ unavailable: 1, throttled: 0 });
  });
});

describe('scryfallFetch', () => {
  it('maps a 404 from /cards/search to an empty result set, not an error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));

    await expect(scryfallFetch('/cards/search?q=zzzznothing')).resolves.toEqual({
      object: 'list',
      total_cards: 0,
      has_more: false,
      data: [],
    });
  });

  // These messages are rendered verbatim by three search surfaces.
  it('throws player-readable copy rather than the raw status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 400 }));
    await expect(scryfallFetch('/cards/search?q=(((')).rejects.toThrow(/couldn’t read that search/);
  });

  it('throws connection copy when fetch itself rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(scryfallFetch('/cards/named?exact=Sol%20Ring')).rejects.toThrow(
      /Couldn’t reach Scryfall/
    );
  });
});
