import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  importFile,
  importText,
  importDeckFile,
  importDeckText,
  fetchPrintings,
  getSetMap,
  identifyCard,
} from './api';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  // Reset the cached set-map promise between tests by re-importing.
});

describe('api', () => {
  it('importText posts JSON and returns the parsed body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        cards: [],
        totalRows: 0,
        scryfallHits: 0,
        scryfallMisses: 0,
        unresolvedNames: [],
        detectedFormat: 'plain',
      })
    );
    const out = await importText('Sol Ring');
    expect(out.detectedFormat).toBe('plain');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/import',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('importFile posts FormData', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        cards: [],
        totalRows: 0,
        scryfallHits: 0,
        scryfallMisses: 0,
        unresolvedNames: [],
        detectedFormat: 'csv',
      })
    );
    const file = new File(['name\nSol Ring'], 'cards.csv', { type: 'text/csv' });
    await importFile(file);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
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

  it('importDeckFile posts FormData to /api/import-deck', async () => {
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

  it('reports unreachable server as a friendly message', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('failed to fetch'));
    await expect(importText('x')).rejects.toThrow(/not responding/);
  });
});

describe('identifyCard', () => {
  it('returns null for empty input without calling fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await identifyCard('')).toBeNull();
    expect(await identifyCard('   ')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('encodes the query and returns the resolved card', async () => {
    const card = { id: 'abc', name: 'Sol Ring' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ card }));
    const out = await identifyCard("Atraxa, Praetors' Voice");
    expect(out).toEqual(card);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/api/cards/identify?q=');
    expect(url).toContain(encodeURIComponent("Atraxa, Praetors' Voice"));
  });

  it('returns null when Scryfall cannot match', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ card: null }));
    expect(await identifyCard('gibberish')).toBeNull();
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
