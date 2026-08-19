import { describe, it, expect, afterEach, vi } from 'vitest';
import { RulesIndex, parseComprehensiveRules } from './index';
import { extractTxtUrl, refreshRules } from './ingest';

describe('extractTxtUrl', () => {
  it('finds the txt link, literal space and all', () => {
    const html =
      '<a href="https://media.wizards.com/2026/downloads/MagicCompRules 20260808.txt">TXT</a>';
    expect(extractTxtUrl(html)).toBe(
      'https://media.wizards.com/2026/downloads/MagicCompRules 20260808.txt'
    );
  });

  it('ignores the pdf/docx links and returns null when absent', () => {
    const html =
      '<a href="https://media.wizards.com/2026/downloads/MagicCompRules 20260807.pdf">PDF</a>';
    expect(extractTxtUrl(html)).toBeNull();
  });
});

describe('refreshRules', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const TXT_URL = 'https://media.wizards.com/2026/downloads/MagicCompRules 20260808.txt';
  const PAGE = `<a href="${TXT_URL}">TXT</a>`;

  /** A rules document big enough to clear the sanity floor. */
  const bigDocument = (): string => {
    const lines = ['These rules are effective as of August 7, 2026.', '', '100. General', ''];
    for (let i = 1; i <= 1100; i++) lines.push(`100.${i}. Rule number ${i}.`, '');
    return lines.join('\n');
  };

  const stubFetch = (byUrl: Record<string, string>) => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      const body = byUrl[decodeURI(url)];
      if (body === undefined) return { ok: false, status: 404, text: async () => '' };
      return { ok: true, status: 200, text: async () => body };
    });
    return calls;
  };

  it('ingests a new document and stamps its meta', async () => {
    const calls = stubFetch({
      'https://magic.wizards.com/en/rules': PAGE,
      [TXT_URL]: bigDocument(),
    });
    const index = new RulesIndex(':memory:');
    expect(await refreshRules(index)).toBe(true);
    const status = index.status();
    expect(status.count).toBeGreaterThan(1000);
    expect(status.sourceUrl).toBe(TXT_URL);
    expect(status.effectiveDate).toBe('August 7, 2026');
    // The literal space must be encoded before the fetch goes out.
    expect(calls[1]).toContain('MagicCompRules%2020260808.txt');
  });

  it('skips the download entirely when the published URL has not moved', async () => {
    const index = new RulesIndex(':memory:');
    index.replaceAll(parseComprehensiveRules(bigDocument()), {
      sourceUrl: TXT_URL,
      effectiveDate: 'August 7, 2026',
    });
    const calls = stubFetch({ 'https://magic.wizards.com/en/rules': PAGE });
    expect(await refreshRules(index)).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('throws rather than ingesting a suspiciously small parse', async () => {
    stubFetch({
      'https://magic.wizards.com/en/rules': PAGE,
      [TXT_URL]: '100. General\n100.1. Just one rule.',
    });
    const index = new RulesIndex(':memory:');
    await expect(refreshRules(index)).rejects.toThrow(/format changed/);
    expect(index.status().count).toBe(0);
  });

  it('throws when the rules page has no txt link', async () => {
    stubFetch({ 'https://magic.wizards.com/en/rules': '<p>nothing here</p>' });
    await expect(refreshRules(new RulesIndex(':memory:'))).rejects.toThrow(/no MagicCompRules/);
  });
});
