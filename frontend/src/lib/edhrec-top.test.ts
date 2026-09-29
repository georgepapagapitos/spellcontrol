import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearEdhrecTopMemo,
  edhrecTopQuery,
  fetchEdhrecTop,
  isEdhrecTopType,
  normalizeColors,
} from './edhrec-top';

function list(name = 'Sol Ring') {
  return {
    kind: 'cards',
    period: 'week',
    colors: null,
    type: null,
    entries: [{ rank: 1, name, scryfallId: null, numDecks: 9, potentialDecks: 10, salt: null }],
    fetchedAt: 1,
    stale: false,
    sourceUrl: 'https://edhrec.com/top/week',
  };
}

function res(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => clearEdhrecTopMemo());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('normalizeColors', () => {
  it('orders letters WUBRG and drops anything else', () => {
    expect(normalizeColors('gw')).toBe('WG');
    expect(normalizeColors('RUx')).toBe('UR');
  });

  it('keeps colorless only when no colour is picked', () => {
    expect(normalizeColors('C')).toBe('C');
    expect(normalizeColors('CW')).toBe('W');
    expect(normalizeColors('')).toBe('');
    expect(normalizeColors(null)).toBe('');
  });
});

describe('edhrecTopQuery', () => {
  it('asks for the week by default', () => {
    expect(edhrecTopQuery({ kind: 'commanders' })).toBe('kind=commanders&period=week');
  });

  it('locks a colour or type list to the past 2 years, the only window EDHREC has', () => {
    expect(edhrecTopQuery({ kind: 'cards', period: 'week', colors: 'uw' })).toBe(
      'kind=cards&period=year&colors=WU'
    );
    expect(edhrecTopQuery({ kind: 'cards', period: 'month', type: 'creatures' })).toBe(
      'kind=cards&period=year&type=creatures'
    );
  });

  it('only sends a type for the cards list, and nothing but the kind for salt', () => {
    expect(edhrecTopQuery({ kind: 'commanders', type: 'creatures' })).toBe(
      'kind=commanders&period=week'
    );
    expect(edhrecTopQuery({ kind: 'salt', period: 'month', colors: 'W' })).toBe('kind=salt');
  });
});

describe('isEdhrecTopType', () => {
  it('knows the type lists', () => {
    expect(isEdhrecTopType('mana-artifacts')).toBe(true);
    expect(isEdhrecTopType('tribal')).toBe(false);
    expect(isEdhrecTopType(null)).toBe(false);
  });
});

describe('fetchEdhrecTop', () => {
  it('reads our backend and shares one request between callers', async () => {
    const fetchMock = vi.fn(async () => res(200, list()));
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([
      fetchEdhrecTop({ kind: 'cards' }),
      fetchEdhrecTop({ kind: 'cards', period: 'week' }),
    ]);

    expect(a.entries[0].name).toBe('Sol Ring');
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/edhrec/top?kind=cards&period=week');
  });

  it("rejects with the server's own message and forgets the failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(502, { error: "Couldn't reach EDHREC." }))
      .mockResolvedValueOnce(res(200, list('Arcane Signet')));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchEdhrecTop({ kind: 'salt' })).rejects.toThrow("Couldn't reach EDHREC.");
    const retried = await fetchEdhrecTop({ kind: 'salt' });
    expect(retried.entries[0].name).toBe('Arcane Signet');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to its own message when the error body says nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('gateway', { status: 504 }))
    );
    await expect(fetchEdhrecTop({ kind: 'commanders', colors: 'B' })).rejects.toThrow(
      "Couldn't load this list."
    );
  });

  it('asks again once its half hour is up', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => res(200, list()));
    vi.stubGlobal('fetch', fetchMock);

    await fetchEdhrecTop({ kind: 'cards', period: 'month' });
    vi.advanceTimersByTime(29 * 60 * 1000);
    await fetchEdhrecTop({ kind: 'cards', period: 'month' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2 * 60 * 1000);
    await fetchEdhrecTop({ kind: 'cards', period: 'month' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
