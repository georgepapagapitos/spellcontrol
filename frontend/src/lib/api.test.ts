import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  importFile,
  importText,
  importDeckFile,
  importDeckText,
  fetchPrintings,
  getSetMap,
  getCardById,
} from './api';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const uploadOk = (overrides: Record<string, unknown> = {}) =>
  jsonResponse({
    cards: [],
    totalRows: 0,
    scryfallHits: 0,
    scryfallMisses: 0,
    unresolvedNames: [],
    detectedFormat: 'plain',
    ...overrides,
  });

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('api', () => {
  it('importText posts JSON and returns the parsed body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(uploadOk());
    const out = await importText('Sol Ring');
    expect(out.detectedFormat).toBe('plain');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/import',
      expect.objectContaining({ method: 'POST' })
    );
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ text: 'Sol Ring' });
  });

  it('importFile reads the file as text and posts JSON', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(uploadOk({ detectedFormat: 'csv' }));
    const file = new File(['Name\nSol Ring'], 'cards.csv', { type: 'text/csv' });
    await importFile(file);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ text: 'Name\nSol Ring' });
  });

  it('importText chunks large inputs and merges responses', async () => {
    // 1200 plain rows → at chunk size 500 splits into 3 chunks.
    const lines = Array.from({ length: 1200 }, (_, i) => `Card ${i}`);
    const text = lines.join('\n');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        uploadOk({ totalRows: 500, scryfallHits: 500, unresolvedNames: ['miss-a'] })
      )
      .mockResolvedValueOnce(uploadOk({ totalRows: 500, scryfallHits: 499, scryfallMisses: 1 }))
      .mockResolvedValueOnce(
        uploadOk({ totalRows: 200, scryfallHits: 200, unresolvedNames: ['miss-a', 'miss-b'] })
      );

    const progress: Array<[number, number]> = [];
    const out = await importText(text, (p) => progress.push([p.chunkIndex, p.totalChunks]));

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(out.totalRows).toBe(1200);
    expect(out.scryfallHits).toBe(1199);
    expect(out.scryfallMisses).toBe(1);
    expect(out.unresolvedNames).toEqual(['miss-a', 'miss-b']);
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('importText retries a transient network failure on a single chunk', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('failed to fetch'))
      .mockResolvedValueOnce(uploadOk({ totalRows: 1, scryfallHits: 1 }));
    const out = await importText('Sol Ring');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(out.totalRows).toBe(1);
  });

  it('importText surfaces a chunk failure with batch context after retries exhaust', async () => {
    const lines = Array.from({ length: 1200 }, (_, i) => `Card ${i}`);
    const text = lines.join('\n');
    // First chunk succeeds; second fails 3 times (initial + 2 retries).
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(uploadOk({ totalRows: 500 }))
      .mockRejectedValue(new TypeError('failed to fetch'));
    await expect(importText(text)).rejects.toThrow(/batch 2 of 3/);
  });

  it('does not retry on HTTP error responses (server replied — not transient)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Bad format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await expect(importText('Sol Ring')).rejects.toThrow(/Bad format/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('importDeckText posts JSON to /api/import-deck', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        commander: null,
        companion: null,
        cards: [],
        unresolvedNames: [],
        detectedFormat: 'plain',
        cardCount: 0,
      })
    );
    await importDeckText('Sol Ring');
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/import-deck');
  });

  it('importDeckFile reads the file and posts JSON to /api/import-deck', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        commander: null,
        companion: null,
        cards: [],
        unresolvedNames: [],
        detectedFormat: 'csv',
        cardCount: 0,
      })
    );
    const file = new File(['x'], 'd.csv');
    await importDeckFile(file);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/import-deck');
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ text: 'x' });
  });

  it('fetchPrintings encodes the card name', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ printings: [{ id: 'a', name: 'Sol Ring' }] }));
    const out = await fetchPrintings("Atraxa, Praetors' Voice");
    expect(out).toHaveLength(1);
    expect(fetchSpy.mock.calls[0][0]).toContain('/api/cards/');
    expect(fetchSpy.mock.calls[0][0]).toContain(encodeURIComponent("Atraxa, Praetors' Voice"));
  });

  it('surfaces structured server errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Boom' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await expect(importText('x')).rejects.toThrow(/Boom/);
  });

  it('surfaces short non-JSON error bodies', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('plain failure', { status: 500 }));
    await expect(importText('x')).rejects.toThrow(/plain failure/);
  });

  it('falls back to a generic message for long error bodies', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x'.repeat(500), { status: 500 }));
    await expect(importText('x')).rejects.toThrow(/HTTP 500/);
  });

  it('reports timeouts as a friendly message', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });
    await expect(importText('x')).rejects.toThrow(/timed out/);
  });

  it('reports unreachable server as a friendly message after retries exhaust', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('failed to fetch'));
    await expect(importText('x')).rejects.toThrow(/not responding/);
    // 1 initial attempt + 2 retries (delays are zero in test env).
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

describe('getCardById', () => {
  it('encodes the id and returns the resolved card', async () => {
    const card = { id: '895ac890-1234-5678-90ab-cdef12345678', name: 'Sol Ring' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ card }));
    const out = await getCardById(card.id);
    expect(out).toEqual(card);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain(`/api/cards/by-id/${encodeURIComponent(card.id)}`);
  });

  it('returns null when the server reports an unknown id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ card: null }));
    expect(await getCardById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('getSetMap', () => {
  it('caches the response across calls', async () => {
    const sets = {
      CMR: {
        code: 'CMR',
        name: 'Commander Legends',
        iconSvgUri: 'x',
        releasedAt: '2020-11-20',
      },
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ sets }));
    const a = await getSetMap();
    const b = await getSetMap();
    expect(a).toBe(b);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
