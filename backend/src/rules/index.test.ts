import { describe, it, expect, beforeEach } from 'vitest';
import { RulesIndex, compareRuleRefs, parseComprehensiveRules } from './index';

/**
 * A miniature Comprehensive Rules document with every structural feature the
 * parser handles: intro, a TOC that repeats section titles, sections, rules,
 * subrules, an attached Example line, a Glossary, and Credits.
 */
const FIXTURE = [
  'Magic: The Gathering Comprehensive Rules',
  '',
  'These rules are effective as of August 7, 2026.',
  '',
  'Contents',
  '',
  '1. Game Concepts',
  '601. Casting Spells',
  '704. State-Based Actions',
  'Glossary',
  'Credits',
  '',
  '601. Casting Spells',
  '',
  '601.1. Previously, the action of casting a spell was referred to on cards as "playing" that spell.',
  '',
  '601.2. To cast a spell is to take it from where it is, put it on the stack, and pay its costs.',
  '',
  '601.2a To propose the casting of a spell, a player first moves that card to the stack.',
  'Example: A player casts a spell by moving it to the stack.',
  '',
  '601.2b If the spell is modal, the player announces the mode choice.',
  '',
  '704. State-Based Actions',
  '',
  '704.5. The state-based actions are as follows:',
  '',
  '704.5g A creature with toughness greater than 0 that has been dealt damage equal to its toughness is destroyed.',
  '',
  'Glossary',
  '',
  'Deathtouch',
  'A keyword ability that causes damage dealt by an object to be especially effective. See rule 702.2, "Deathtouch."',
  '',
  'Ability',
  '1. Text on an object that explains what that object does.',
  '2. An activated or triggered ability on the stack.',
  '',
  'Credits',
  '',
  'Wizards of the Coast.',
].join('\r\n');

describe('parseComprehensiveRules', () => {
  const entries = parseComprehensiveRules(FIXTURE);
  const byRef = new Map(entries.map((e) => [e.ref, e.body]));

  it('captures sections, rules and subrules by their numbers', () => {
    expect(byRef.get('601')).toBe('Casting Spells');
    expect(byRef.get('601.2')).toMatch(/^To cast a spell/);
    expect(byRef.get('601.2b')).toMatch(/modal/);
    expect(byRef.get('704.5g')).toMatch(/destroyed/);
  });

  it('dedupes the TOC repeat of a section title', () => {
    expect(entries.filter((e) => e.ref === '601')).toHaveLength(1);
  });

  it('attaches Example lines to the rule above them', () => {
    expect(byRef.get('601.2a')).toContain('Example: A player casts a spell');
  });

  it('parses glossary terms with multi-line definitions', () => {
    expect(byRef.get('Deathtouch')).toMatch(/keyword ability/);
    expect(byRef.get('Ability')).toContain('2. An activated or triggered ability');
  });

  it('does not index the credits as glossary entries', () => {
    expect(byRef.has('Wizards of the Coast.')).toBe(false);
  });
});

describe('compareRuleRefs', () => {
  it('orders numerically, not lexicographically', () => {
    expect(['601.10', '601.2', '601.2b', '601.2a', '601'].sort(compareRuleRefs)).toEqual([
      '601',
      '601.2',
      '601.2a',
      '601.2b',
      '601.10',
    ]);
  });
});

describe('RulesIndex', () => {
  let index: RulesIndex;

  beforeEach(() => {
    index = new RulesIndex(':memory:');
    index.replaceAll(parseComprehensiveRules(FIXTURE), {
      sourceUrl: 'https://example.com/rules.txt',
      effectiveDate: 'August 7, 2026',
    });
  });

  it('search finds rules by their words, best match first', () => {
    const hits = index.search('state-based actions');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.ref)).toContain('704.5');
  });

  it('search survives FTS syntax in the query instead of throwing', () => {
    expect(() => index.search('cast* "a (spell)')).not.toThrow();
  });

  it('search returns [] for an unsearchable query', () => {
    expect(index.search('***')).toEqual([]);
  });

  it('get on a rule number returns the rule and its subrules in order', () => {
    expect(index.get('601.2').map((r) => r.ref)).toEqual(['601.2', '601.2a', '601.2b']);
  });

  it('get on a subrule returns just that subrule', () => {
    expect(index.get('704.5g').map((r) => r.ref)).toEqual(['704.5g']);
  });

  it('get on a bare section returns the title and its top-level rules only', () => {
    expect(index.get('601').map((r) => r.ref)).toEqual(['601', '601.1', '601.2']);
  });

  it('get resolves glossary terms case-insensitively', () => {
    expect(index.get('deathtouch')).toHaveLength(1);
    expect(index.getExact('DEATHTOUCH')?.ref).toBe('Deathtouch');
  });

  it('get returns [] for an unknown ref', () => {
    expect(index.get('999.9')).toEqual([]);
    expect(index.getExact('999.9')).toBeNull();
  });

  it('tolerates a trailing dot on the ref', () => {
    expect(index.get('601.2.').map((r) => r.ref)).toContain('601.2');
  });

  it('status reports counts and meta; replaceAll swaps atomically', () => {
    const before = index.status();
    expect(before.count).toBeGreaterThan(5);
    expect(before.sourceUrl).toBe('https://example.com/rules.txt');
    expect(before.effectiveDate).toBe('August 7, 2026');
    expect(before.ingestedAt).toBeTypeOf('number');

    index.replaceAll([{ ref: '100', body: 'General' }], {
      sourceUrl: 'https://example.com/rules-2.txt',
      effectiveDate: null,
    });
    const after = index.status();
    expect(after.count).toBe(1);
    expect(after.sourceUrl).toBe('https://example.com/rules-2.txt');
  });
});
