import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildDeckReviewCards,
  deckContentKey,
  fetchAiStatus,
  requestDeckReview,
  setAiOptIn,
} from './ai-review';
import type { ScryfallCard } from '@/deck-builder/types';

function card(name: string, oracleId = `o-${name}`): ScryfallCard {
  return { name, oracle_id: oracleId } as ScryfallCard;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('buildDeckReviewCards', () => {
  it('aggregates duplicate names into quantities, sorted by name', () => {
    const cards = buildDeckReviewCards([
      { card: card('Swamp') },
      { card: card('Sol Ring') },
      { card: card('Swamp') },
      { card: card('Swamp') },
    ]);
    expect(cards).toEqual([
      { name: 'Sol Ring', oracleId: 'o-Sol Ring', qty: 1 },
      { name: 'Swamp', oracleId: 'o-Swamp', qty: 3 },
    ]);
  });

  it('tolerates a missing oracle_id', () => {
    const noOracle = { name: 'Mystery' } as ScryfallCard;
    expect(buildDeckReviewCards([{ card: noOracle }])[0].oracleId).toBe('');
  });
});

describe('deckContentKey', () => {
  it('is order-independent and qty-sensitive', () => {
    const a = deckContentKey('Meren', [
      { name: 'Swamp', qty: 12 },
      { name: 'Sol Ring', qty: 1 },
    ]);
    const b = deckContentKey('Meren', [
      { name: 'Sol Ring', qty: 1 },
      { name: 'Swamp', qty: 12 },
    ]);
    expect(a).toBe(b);
    const c = deckContentKey('Meren', [
      { name: 'Sol Ring', qty: 1 },
      { name: 'Swamp', qty: 11 },
    ]);
    expect(a).not.toBe(c);
  });

  it('an edit that is reverted reads as fresh again', () => {
    const before = deckContentKey('Meren', [{ name: 'Sol Ring', qty: 1 }]);
    const after = deckContentKey('Meren', [{ name: 'Sol Ring', qty: 1 }]);
    expect(before).toBe(after);
  });
});

describe('fetchAiStatus', () => {
  it('returns the status payload', async () => {
    stubFetch(200, { optIn: true, used: 2, limit: 10 });
    expect(await fetchAiStatus()).toEqual({ optIn: true, used: 2, limit: 10 });
  });

  it('returns null when the feature is unavailable (404) or unauthenticated (401)', async () => {
    stubFetch(404, { error: 'Not found.' });
    expect(await fetchAiStatus()).toBeNull();
    stubFetch(401, { error: 'Not authenticated.' });
    expect(await fetchAiStatus()).toBeNull();
  });
});

describe('setAiOptIn', () => {
  it('posts the flag and returns the new state', async () => {
    const mock = stubFetch(200, { optIn: true });
    expect(await setAiOptIn(true)).toBe(true);
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/ai/opt-in');
    expect(JSON.parse(init.body as string)).toEqual({ enabled: true });
  });
});

describe('requestDeckReview', () => {
  it('posts the payload and returns the review', async () => {
    const mock = stubFetch(200, {
      content: 'Prose.',
      cached: false,
      model: 'm',
      usage: { inputTokens: 1, outputTokens: 2 },
    });
    const result = await requestDeckReview({
      deckId: 'd1',
      commander: 'Meren',
      cards: [{ name: 'Swamp', oracleId: 'o', qty: 1 }],
      analysis: {} as never,
    });
    expect(result.content).toBe('Prose.');
    const [url] = mock.mock.calls[0] as [string];
    expect(url).toBe('/api/ai/deck-review');
  });

  it('surfaces the server error message with its status', async () => {
    stubFetch(429, { error: 'Daily limit reached (10 per day). It resets at midnight UTC.' });
    await expect(
      requestDeckReview({
        deckId: 'd1',
        commander: 'Meren',
        cards: [{ name: 'Swamp', oracleId: 'o', qty: 1 }],
        analysis: {} as never,
      })
    ).rejects.toMatchObject({ message: expect.stringContaining('Daily limit'), status: 429 });
  });
});
