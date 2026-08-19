import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchRulesHistory, requestRulesAnswer, tokenizeRuleRefs } from './ai-rules';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(status: number, body: string, contentType = 'application/json') {
  const mock = vi
    .fn()
    .mockResolvedValue(new Response(body, { status, headers: { 'Content-Type': contentType } }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

const ndjson = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join('\n');

describe('requestRulesAnswer', () => {
  it('streams deltas and returns the authoritative done payload', async () => {
    const done = {
      content: 'Yes (704.5g).',
      cached: false,
      rules: [{ ref: '704.5g', text: 'Lethal damage destroys.' }],
      fetched: ['Blood Moon'],
    };
    stubFetch(
      200,
      ndjson([{ delta: 'Yes ' }, { delta: '(704.5g).' }, { done }]),
      'application/x-ndjson'
    );
    const seen: string[] = [];
    const result = await requestRulesAnswer('Does it die?', (t) => seen.push(t));
    expect(seen).toEqual(['Yes ', 'Yes (704.5g).']);
    expect(result).toEqual(done);
  });

  it('throws the streamed error, not the partial prose', async () => {
    stubFetch(
      200,
      ndjson([
        { delta: 'Half an ans' },
        { error: 'The answer could not be generated. Try again.' },
      ]),
      'application/x-ndjson'
    );
    await expect(requestRulesAnswer('q')).rejects.toThrow(/could not be generated/);
  });

  it('treats a stream that ends without done as a failure', async () => {
    stubFetch(200, ndjson([{ delta: 'trailing off' }]), 'application/x-ndjson');
    await expect(requestRulesAnswer('q')).rejects.toThrow(/ended early/);
  });

  it('surfaces pre-stream failures via their JSON body', async () => {
    stubFetch(429, JSON.stringify({ error: 'Daily limit reached.' }));
    await expect(requestRulesAnswer('q')).rejects.toThrow(/Daily limit/);
  });
});

describe('fetchRulesHistory', () => {
  it('returns the history payload', async () => {
    const payload = {
      effectiveDate: 'August 7, 2026',
      questions: [{ id: '1', question: 'Q?', content: 'A.', createdAt: 5, rules: [] }],
    };
    stubFetch(200, JSON.stringify(payload));
    expect(await fetchRulesHistory()).toEqual(payload);
  });

  it('degrades 404/401 to an empty history', async () => {
    stubFetch(404, JSON.stringify({ error: 'Not found.' }));
    expect(await fetchRulesHistory()).toEqual({ effectiveDate: null, questions: [] });
  });
});

describe('tokenizeRuleRefs', () => {
  it('marks only verified refs, keeping surrounding prose intact', () => {
    const runs = tokenizeRuleRefs('See 704.5g and 999.9x for details.', ['704.5g']);
    expect(runs).toEqual([
      { text: 'See ' },
      { text: '704.5g', ref: '704.5g' },
      { text: ' and 999.9x for details.' },
    ]);
  });

  it('returns the whole text as one run when nothing is verified', () => {
    expect(tokenizeRuleRefs('Plain prose (601.2b).', [])).toEqual([
      { text: 'Plain prose (601.2b).' },
    ]);
  });
});
