import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildDeckReviewCards,
  deckContentKey,
  fetchAiStatus,
  requestDeckReview,
  setAiOptIn,
  splitReviewSections,
  tokenizeCardNames,
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

describe('splitReviewSections', () => {
  const paras = (...p: string[]) => p.join('\n\n');

  it('leads with the weakness — the last paragraph the model wrote', () => {
    const sections = splitReviewSections(paras('Gameplan.', 'Win path.', 'The weakness.'));
    expect(sections?.map((s) => s.id)).toEqual(['weakness', 'gameplan', 'win']);
    expect(sections?.[0].paragraphs).toEqual(['The weakness.']);
    expect(sections?.[1].paragraphs).toEqual(['Gameplan.']);
    expect(sections?.[2].paragraphs).toEqual(['Win path.']);
  });

  it('gives a fourth paragraph to the win path, never to the weakness', () => {
    const sections = splitReviewSections(paras('Gameplan.', 'Win A.', 'Win B.', 'The weakness.'));
    expect(sections?.[0].paragraphs).toEqual(['The weakness.']);
    expect(sections?.[2].paragraphs).toEqual(['Win A.', 'Win B.']);
  });

  it('returns null below three paragraphs rather than mislabelling prose', () => {
    expect(splitReviewSections('One block.')).toBeNull();
    expect(splitReviewSections(paras('One.', 'Two.'))).toBeNull();
  });

  it('ignores blank paragraphs and stray whitespace', () => {
    const sections = splitReviewSections('  A.  \n\n\n\n  B.  \n\n C. \n\n');
    expect(sections?.map((s) => s.paragraphs)).toEqual([['C.'], ['A.'], ['B.']]);
  });
});

describe('tokenizeCardNames', () => {
  const text = (tokens: ReturnType<typeof tokenizeCardNames>) => tokens.map((t) => t.text).join('');
  const chipped = (tokens: ReturnType<typeof tokenizeCardNames>) =>
    tokens.filter((t) => t.card).map((t) => t.card);

  it('chips in-deck names and leaves the prose byte-identical', () => {
    const tokens = tokenizeCardNames('Cast Sol Ring early, then Demonic Tutor.', [
      'Sol Ring',
      'Demonic Tutor',
    ]);
    expect(text(tokens)).toBe('Cast Sol Ring early, then Demonic Tutor.');
    expect(chipped(tokens)).toEqual(['Sol Ring', 'Demonic Tutor']);
  });

  it('prefers the longest name, so a list-mate prefix does not win', () => {
    const tokens = tokenizeCardNames('Kaalia of the Vast attacks.', [
      'Kaalia',
      'Kaalia of the Vast',
    ]);
    expect(chipped(tokens)).toEqual(['Kaalia of the Vast']);
    expect(tokens.find((t) => t.card)?.text).toBe('Kaalia of the Vast');
  });

  it('matches a double-faced front face but reports the canonical name', () => {
    const tokens = tokenizeCardNames('Delver of Secrets flips.', [
      'Delver of Secrets // Insectile Aberration',
    ]);
    expect(chipped(tokens)).toEqual(['Delver of Secrets // Insectile Aberration']);
    expect(tokens.find((t) => t.card)?.text).toBe('Delver of Secrets');
  });

  it('chips the name out of a possessive but never out of a longer word', () => {
    expect(chipped(tokenizeCardNames("Kaalia's trigger.", ['Kaalia']))).toEqual(['Kaalia']);
    expect(chipped(tokenizeCardNames('Foggy weather.', ['Fog']))).toEqual([]);
  });

  it('is case-insensitive and handles regex-special characters in names', () => {
    expect(chipped(tokenizeCardNames('play sol ring', ['Sol Ring']))).toEqual(['Sol Ring']);
    expect(chipped(tokenizeCardNames('Equip +2 Mace.', ['+2 Mace']))).toEqual(['+2 Mace']);
  });

  it('returns the text untouched when the deck has no names to match', () => {
    expect(tokenizeCardNames('Nothing to chip.', [])).toEqual([{ text: 'Nothing to chip.' }]);
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
  const payload = {
    deckId: 'd1',
    commander: 'Meren',
    cards: [{ name: 'Swamp', oracleId: 'o', qty: 1 }],
    analysis: {} as never,
  };

  const DONE = {
    content: 'One. Two.',
    cached: false,
    model: 'm',
    usage: { inputTokens: 1, outputTokens: 2 },
  };

  /** Stub the NDJSON stream the route emits, one object per line. */
  function stubStream(lines: unknown[], status = 200): ReturnType<typeof vi.fn> {
    const body = lines.map((l) => `${JSON.stringify(l)}\n`).join('');
    const mock = vi
      .fn()
      .mockResolvedValue(
        new Response(body, { status, headers: { 'Content-Type': 'application/x-ndjson' } })
      );
    vi.stubGlobal('fetch', mock);
    return mock;
  }

  it('assembles the deltas and reports the text as it arrives', async () => {
    const mock = stubStream([{ delta: 'One. ' }, { delta: 'Two.' }, { done: DONE }]);
    const seen: string[] = [];
    const result = await requestDeckReview(payload, (t) => seen.push(t));

    // onText gets the running total, so a caller can render it directly.
    expect(seen).toEqual(['One. ', 'One. Two.']);
    expect(result).toEqual(DONE);
    expect((mock.mock.calls[0] as [string])[0]).toBe('/api/ai/deck-review');
  });

  it('returns the terminator text, not the deltas glued back together', async () => {
    // If the two ever disagree, the stored review is the one that counts.
    stubStream([{ delta: 'partial' }, { done: { ...DONE, content: 'the whole thing' } }]);
    expect((await requestDeckReview(payload)).content).toBe('the whole thing');
  });

  it('treats a stream that never terminates as a failure, not a short review', async () => {
    stubStream([{ delta: 'Half a find' }]);
    await expect(requestDeckReview(payload)).rejects.toThrow(/ended early/);
  });

  it('throws the in-band error a mid-stream failure reports', async () => {
    stubStream([{ delta: 'Your deck ' }, { error: 'The review could not be generated.' }]);
    await expect(requestDeckReview(payload)).rejects.toThrow('The review could not be generated.');
  });

  it('turns a mangled frame into readable copy, not a JSON parse error', async () => {
    const mock = vi
      .fn()
      .mockResolvedValue(new Response('{"delta":"ok"}\n{not json}\n', { status: 200 }));
    vi.stubGlobal('fetch', mock);
    await expect(requestDeckReview(payload)).rejects.toThrow(/garbled/);
  });

  it('surfaces a pre-stream server error with its status', async () => {
    stubFetch(429, { error: 'Daily limit reached (10 per day). It resets at midnight UTC.' });
    await expect(requestDeckReview(payload)).rejects.toMatchObject({
      message: expect.stringContaining('Daily limit'),
      status: 429,
    });
  });
});
