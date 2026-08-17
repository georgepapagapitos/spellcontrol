import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildDeckReviewCards,
  deckContentKey,
  fetchAiStatus,
  fetchReviewHistory,
  requestDeckReview,
  setAiOptIn,
  splitReviewSections,
  stripEmphasis,
  toAiAnalysis,
  tokenizeCardNames,
} from './ai-review';
import type { DeckAnalysisResult } from './deck-analysis';
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
  const W = '---WEAKNESS---';
  const G = '---GAMEPLAN---';
  const N = '---WINS---';
  const full = `${W}\nThe mana is wrong.\n\n${G}\nGoblins, wide.\n\n${N}\nCombat damage.`;

  it('reads the labels and keeps display order', () => {
    const secs = splitReviewSections(full);
    expect(secs?.map((s) => s.id)).toEqual(['weakness', 'gameplan', 'win']);
    expect(secs?.[0].paragraphs).toEqual(['The mana is wrong.']);
    expect(secs?.[1].paragraphs).toEqual(['Goblins, wide.']);
    expect(secs?.[2].paragraphs).toEqual(['Combat damage.']);
    expect(secs?.every((s) => s.complete)).toBe(true);
  });

  it('keeps multi-paragraph sections together', () => {
    const secs = splitReviewSections(`${W}\nOne.\n\nTwo.\n\n${G}\nPlan.\n\n${N}\nWin.`);
    expect(secs?.[0].paragraphs).toEqual(['One.', 'Two.']);
  });

  // The streaming contract: every block exists from the first label, so the
  // layout is final before the text is.
  it('returns all four sections from the very first label', () => {
    const secs = splitReviewSections(`${W}\nThe mana is w`, true);
    expect(secs?.map((s) => s.id)).toEqual(['weakness', 'fixes', 'gameplan', 'win']);
    expect(secs?.[1].paragraphs).toEqual([]);
    expect(secs?.[3].paragraphs).toEqual([]);
  });

  it('marks the section being written as incomplete, earlier ones as done', () => {
    const secs = splitReviewSections(`${W}\nMana.\n\n${G}\nGoblins, wi`, true);
    expect(secs?.[0].complete).toBe(true); // a later label appeared
    expect(secs?.[1].complete).toBe(false); // still being typed
  });

  it('treats everything as complete once the stream is done', () => {
    expect(splitReviewSections(full, false)?.every((s) => s.complete)).toBe(true);
  });

  it('falls back to null for label-less prose (a review cached from v3)', () => {
    expect(splitReviewSections('Three\n\nplain\n\nparagraphs.')).toBeNull();
    expect(splitReviewSections('')).toBeNull();
  });

  it('survives the model emitting the labels out of order', () => {
    // Display order is ours, not the model's — the ids stay in our order and
    // each body still follows its own label.
    const secs = splitReviewSections(`${G}\nPlan.\n\n${W}\nFlaw.\n\n${N}\nWin.`);
    expect(secs?.map((s) => s.id)).toEqual(['weakness', 'gameplan', 'win']);
    expect(secs?.[0].paragraphs).toEqual(['Flaw.']);
    expect(secs?.[1].paragraphs).toEqual(['Plan.']);
  });

  it('tolerates a missing section rather than dropping the rest', () => {
    // A finished reading renders what it has: the gameplan label never
    // appeared, so there is no empty block where it would have gone. This is
    // also every pre-v11 cached reading, none of which has a fixes section.
    const secs = splitReviewSections(`${W}\nFlaw.\n\n${N}\nWin.`);
    expect(secs?.map((s) => s.id)).toEqual(['weakness', 'win']);
    expect(secs?.map((s) => s.paragraphs.length)).toEqual([1, 1]);
  });

  describe('the fixes section', () => {
    const F = '---FIXES---';

    it('makes each line its own fix', () => {
      const secs = splitReviewSections(
        `${W}\nFlaw.\n\n${F}\nAn instant-speed artifact answer.\nA second land that taps for black.\n\n${G}\nPlan.\n\n${N}\nWin.`
      );
      expect(secs?.[1].id).toBe('fixes');
      expect(secs?.[1].paragraphs).toEqual([
        'An instant-speed artifact answer.',
        'A second land that taps for black.',
      ]);
    });

    it('strips a bullet or number the model wrote anyway', () => {
      const secs = splitReviewSections(`${W}\nFlaw.\n\n${F}\n1. Add removal.\n- Add a rock.`);
      expect(secs?.[1].paragraphs).toEqual(['Add removal.', 'Add a rock.']);
    });

    it('leaves a lone fix as one item', () => {
      const secs = splitReviewSections(`${W}\nFlaw.\n\n${F}\nOne fix is enough here.`);
      expect(secs?.[1].paragraphs).toEqual(['One fix is enough here.']);
    });
  });

  describe('the end marker', () => {
    // The production leak: the model wrote the whole review and carried on
    // narrating its next move, and with no terminator that ran into the last
    // section (which slices to the end of the text).
    const trailing =
      '\n\nNow for the prescriptions. I need to identify which untap creatures to cut:';

    it('drops everything the model writes after the terminator', () => {
      const secs = splitReviewSections(`${full}\n\n---END---${trailing}`);
      expect(secs?.at(-1)?.paragraphs).toEqual(['Combat damage.']);
      expect(JSON.stringify(secs)).not.toContain('Now for the prescriptions');
    });

    it('drops it mid-stream too, so it never renders even for a frame', () => {
      const secs = splitReviewSections(`${full}\n\n---END---${trailing}`, true);
      expect(JSON.stringify(secs)).not.toContain('untap creatures');
    });

    it('is optional — a reading without one reads exactly as before', () => {
      expect(splitReviewSections(full)?.at(-1)?.paragraphs).toEqual(['Combat damage.']);
    });
  });
});

describe('tokenizeCardNames', () => {
  const text = (tokens: ReturnType<typeof tokenizeCardNames>) => tokens.map((t) => t.text).join('');
  const chipped = (tokens: ReturnType<typeof tokenizeCardNames>) =>
    tokens.filter((t) => t.card).map((t) => t.card);

  it('chips a legend by the short form the model actually writes', () => {
    // Observed live: the model writes "Teferi" and "Vizier" beside full names,
    // so exact-match-only lit up an arbitrary half of one sentence.
    const tokens = tokenizeCardNames('Untap with Teferi, then Vizier, then Ioreth to close.', [
      'Teferi, Who Slows the Sunset',
      'Vizier of Remedies',
      'Ioreth of the Healing House',
    ]);
    expect(chipped(tokens)).toEqual([
      'Teferi, Who Slows the Sunset',
      'Vizier of Remedies',
      'Ioreth of the Healing House',
    ]);
    expect(text(tokens)).toBe('Untap with Teferi, then Vizier, then Ioreth to close.');
  });

  it('still prefers the full name when the model writes it out', () => {
    const tokens = tokenizeCardNames('Cast Teferi, Who Slows the Sunset on turn five.', [
      'Teferi, Who Slows the Sunset',
    ]);
    expect(tokens.filter((t) => t.card)).toHaveLength(1);
    expect(tokens.find((t) => t.card)?.text).toBe('Teferi, Who Slows the Sunset');
  });

  it('never chips a lowercase word that happens to be a legend short form', () => {
    // "Will, Scion of Peace" would otherwise turn every "will" into a chip.
    const tokens = tokenizeCardNames('You will win if Will resolves.', ['Will, Scion of Peace']);
    expect(chipped(tokens)).toEqual(['Will, Scion of Peace']);
    expect(text(tokens)).toBe('You will win if Will resolves.');
  });

  it('drops an ambiguous short form rather than guessing', () => {
    const tokens = tokenizeCardNames('Teferi untaps everything.', [
      'Teferi, Who Slows the Sunset',
      'Teferi, Temporal Archmage',
    ]);
    expect(chipped(tokens)).toEqual([]);
    expect(text(tokens)).toBe('Teferi untaps everything.');
  });

  it('never lets a short form shadow another card whose full name it is', () => {
    const tokens = tokenizeCardNames('Shadow blocks well.', ['Shadow', 'Shadow of the Grave']);
    expect(chipped(tokens)).toEqual(['Shadow']);
  });

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

function fullAnalysis(): DeckAnalysisResult {
  return {
    totalNonCommander: 99,
    expectedSize: 99,
    sizeDelta: 0,
    types: {
      creatures: 30,
      instants: 6,
      sorceries: 7,
      artifacts: 5,
      enchantments: 1,
      planeswalkers: 0,
      battles: 0,
      lands: 38,
      other: 12,
    },
    curve: {
      buckets: [{ cmc: 1, count: 9 }],
      averageCmc: 2.7,
      peak: 6,
      verdict: 'curve-ok',
      message: 'fine',
    },
    roles: [
      {
        key: 'ramp',
        label: 'Ramp',
        count: 8,
        range: [8, 12],
        status: 'ok',
        message: 'fine',
        contributingSlotIds: ['slot_1', 'slot_2'],
      },
    ],
    colorIdentity: { commanderColors: ['B', 'G'], offColorCards: [] },
    taggerReady: true,
  };
}

describe('toAiAnalysis', () => {
  it('drops every field renderAnalysis does not read', () => {
    const payload = toAiAnalysis(fullAnalysis());
    expect(payload).toEqual({
      totalNonCommander: 99,
      types: {
        lands: 38,
        creatures: 30,
        instants: 6,
        sorceries: 7,
        artifacts: 5,
        enchantments: 1,
        planeswalkers: 0,
        battles: 0,
      },
      curve: { averageCmc: 2.7, buckets: [{ cmc: 1, count: 9 }] },
      roles: [{ label: 'Ramp', count: 8 }],
    });
    // `expectedSize`, `sizeDelta`, `colorIdentity`, `taggerReady`, curve
    // verdict/message/peak, and role range/status/message/contributingSlotIds
    // never made it in.
    expect(payload).not.toHaveProperty('taggerReady');
    expect(
      (payload.roles[0] as unknown as Record<string, unknown>).contributingSlotIds
    ).toBeUndefined();
  });

  it('carries bracket through when at least one of target/estimate is set', () => {
    expect(toAiAnalysis(fullAnalysis(), { target: 2, estimate: 4 }).bracket).toEqual({
      target: 2,
      estimate: 4,
    });
    expect(toAiAnalysis(fullAnalysis(), { target: 2, estimate: null }).bracket).toEqual({
      target: 2,
      estimate: null,
    });
  });

  it('omits bracket entirely when both are absent', () => {
    expect(toAiAnalysis(fullAnalysis(), { target: null, estimate: null })).not.toHaveProperty(
      'bracket'
    );
    expect(toAiAnalysis(fullAnalysis())).not.toHaveProperty('bracket');
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

describe('fetchReviewHistory', () => {
  it('returns readings and encodes the deck id', async () => {
    const readings = [{ id: 'r1', content: 'prose', model: 'm', createdAt: 1 }];
    const mock = stubFetch(200, { readings });
    expect(await fetchReviewHistory('deck/1')).toEqual(readings);
    expect(mock.mock.calls[0][0]).toBe('/api/ai/history?deckId=deck%2F1');
  });

  it('degrades to empty when the feature is unavailable', async () => {
    stubFetch(404, { error: 'Not found.' });
    expect(await fetchReviewHistory('d1')).toEqual([]);
    stubFetch(401, { error: 'Not authenticated.' });
    expect(await fetchReviewHistory('d1')).toEqual([]);
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

describe('stripEmphasis', () => {
  it('removes markdown bold the model writes around card names', () => {
    // Nothing renders markdown here, so this reached the page verbatim as
    // "**Extraordinary Journey**" — seen in 18/35 live runs on prompt v9.
    expect(stripEmphasis('Add **Extraordinary Journey** now.')).toBe(
      'Add Extraordinary Journey now.'
    );
  });

  it('removes an unclosed marker mid-stream rather than showing it', () => {
    expect(stripEmphasis('Add **Extraordinary')).toBe('Add Extraordinary');
  });

  it('leaves a lone asterisk alone — MTG writes variable power that way', () => {
    expect(stripEmphasis('a */* creature')).toBe('a */* creature');
  });

  it('lets a bolded name still chip once stripped', () => {
    const tokens = tokenizeCardNames(stripEmphasis('Add **Sol Ring**.'), ['Sol Ring']);
    expect(tokens.filter((t) => t.card).map((t) => t.card)).toEqual(['Sol Ring']);
  });
});
