import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncOfflineData } from './download';
import { clearOfflineData } from './db';

/**
 * The retry-with-backoff path. download.ts is excluded from coverage but
 * its retry contract is load-bearing — a 503 from a warming server must
 * not surface to the user as a hard failure.
 *
 * Tests use fake timers so the 2-15s backoff doesn't make the suite slow.
 */
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await clearOfflineData();
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function gzippedEmptyArray(): Response {
  // The download flow expects gzipped JSON for the cards/combos bodies but
  // browsers transparently decompress. Under the test harness fetch doesn't,
  // so we serve plain JSON — readBody just decodes whatever bytes arrive.
  return jsonResponse([]);
}

describe('syncOfflineData', () => {
  it('retries on 503 and eventually succeeds when the server warms up', async () => {
    let manifestCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/offline/manifest')) {
        manifestCalls += 1;
        if (manifestCalls < 3) {
          return new Response(JSON.stringify({ error: 'preparing' }), {
            status: 503,
            headers: { 'Retry-After': '0' },
          });
        }
        return jsonResponse({
          oracleVersion: 'v1',
          oracleCardCount: 0,
          oracleByteSize: 0,
          oracleUpdatedAt: 0,
          combosVersion: 'c1',
          combosCount: 0,
          combosByteSize: 0,
          combosUpdatedAt: 0,
        });
      }
      if (url.endsWith('/api/offline/oracle-cards') || url.endsWith('/api/offline/combos')) {
        return gzippedEmptyArray();
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const progressEvents: string[] = [];
    const pending = syncOfflineData({
      onProgress: (p) => progressEvents.push(p.phase),
    });

    // Drain pending microtasks + scheduled retries.
    await vi.runAllTimersAsync();
    await pending;

    expect(manifestCalls).toBe(3);
    expect(progressEvents).toContain('waiting-for-server');
    expect(progressEvents.at(-1)).toBe('done');
  });

  it('gives up on a non-retryable status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    // No timers fire on this path (500 is not retryable), so attach the
    // rejection matcher up front to avoid an unhandled-rejection warning.
    const pending = syncOfflineData({});
    const assertion = expect(pending).rejects.toThrow(/manifest \(500\)/);
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('honors a Retry-After header when present', async () => {
    let manifestCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/offline/manifest')) {
        manifestCalls += 1;
        if (manifestCalls === 1) {
          return new Response('{}', {
            status: 503,
            headers: { 'Retry-After': '7' },
          });
        }
        return jsonResponse({
          oracleVersion: 'v',
          oracleCardCount: 0,
          oracleByteSize: 0,
          oracleUpdatedAt: 0,
          combosVersion: 'v',
          combosCount: 0,
          combosByteSize: 0,
          combosUpdatedAt: 0,
        });
      }
      return gzippedEmptyArray();
    });

    let waitDetail = '';
    const pending = syncOfflineData({
      onProgress: (p) => {
        if (p.phase === 'waiting-for-server' && p.detail) waitDetail = p.detail;
      },
    });
    await vi.runAllTimersAsync();
    await pending;

    expect(waitDetail).toMatch(/retrying in 7s/);
  });
});
