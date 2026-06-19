import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  searchGlossary,
  searchKeywords,
  searchRules,
  subrulesFor,
  type GlossaryEntry,
  type KeywordEntry,
  type RuleEntry,
} from './comprehensive-rules';

const keywords: KeywordEntry[] = [
  { name: 'Deathtouch', rule: '702.2', kind: 'ability' },
  { name: 'Double Strike', rule: '702.4', kind: 'ability' },
  { name: 'Scry', rule: '701.18', kind: 'action' },
];

const glossary: GlossaryEntry[] = [
  { term: 'Deathtouch', definition: 'A keyword ability. See rule 702.2.' },
  { term: 'Lethal Damage', definition: 'Damage equal to a creature toughness; deathtouch counts.' },
  { term: 'Scry', definition: 'Look at the top N cards of your library.' },
];

const rules: RuleEntry[] = [
  { number: '702.2', text: 'Deathtouch' },
  { number: '702.2a', text: 'Deathtouch is a static ability.' },
  { number: '702.2b', text: 'A creature dealt damage by deathtouch is destroyed.' },
  { number: '702.20', text: 'Trample' },
  { number: '702.20a', text: 'Trample is a static ability.' },
  { number: '104.1', text: 'A game ends in one of the ways listed here.' },
];

describe('searchKeywords', () => {
  it('returns all when query is blank', () => {
    expect(searchKeywords(keywords, '  ')).toHaveLength(3);
  });
  it('matches by name, case-insensitive', () => {
    expect(searchKeywords(keywords, 'death').map((k) => k.name)).toEqual(['Deathtouch']);
  });
});

describe('searchGlossary', () => {
  it('ranks term matches above definition-only matches', () => {
    const out = searchGlossary(glossary, 'deathtouch');
    expect(out.map((g) => g.term)).toEqual(['Deathtouch', 'Lethal Damage']);
  });
  it('returns all when blank', () => {
    expect(searchGlossary(glossary, '')).toHaveLength(3);
  });
});

describe('searchRules', () => {
  it('matches rule numbers by prefix for numeric queries', () => {
    expect(searchRules(rules, '702.2').map((r) => r.number)).toEqual([
      '702.2',
      '702.2a',
      '702.2b',
      '702.20',
      '702.20a',
    ]);
  });
  it('does a text search for non-numeric queries', () => {
    expect(searchRules(rules, 'trample').map((r) => r.number)).toEqual(['702.20', '702.20a']);
  });
  it('caps results at the limit', () => {
    expect(searchRules(rules, 'static', 1)).toHaveLength(1);
  });
});

describe('subrulesFor', () => {
  it('returns the rule and its lettered subrules only (not 702.20)', () => {
    expect(subrulesFor(rules, '702.2').map((r) => r.number)).toEqual(['702.2', '702.2a', '702.2b']);
  });
});

describe('loadRulesBundle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('fetches and caches the bundle', async () => {
    const bundle = { meta: {}, sections: [], rules, glossary, keywords };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => bundle });
    vi.stubGlobal('fetch', fetchMock);
    const mod = await import('./comprehensive-rules');
    expect((await mod.loadRulesBundle()).keywords).toHaveLength(3);
    await mod.loadRulesBundle();
    expect(fetchMock).toHaveBeenCalledTimes(1); // cached
  });

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const mod = await import('./comprehensive-rules');
    await expect(mod.loadRulesBundle()).rejects.toThrow('404');
  });
});
