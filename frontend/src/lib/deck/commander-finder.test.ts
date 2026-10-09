import { describe, expect, it } from 'vitest';
import {
  buildScryfallQuery,
  colorComboName,
  colorIdentityMatches,
  colorModeHint,
  compareEntries,
  effectiveSort,
  filterSummary,
  isSearching,
  matchReason,
  relaxations,
  sortColors,
  type CompareContext,
  type FinderEntry,
  type FinderQuery,
} from './commander-finder';
import { playstyleById } from './commander-playstyle-index';

const q = (over: Partial<FinderQuery> = {}): FinderQuery => ({
  text: '',
  colors: new Set(),
  colorMode: 'exact',
  playstyleIds: [],
  ...over,
});

describe('colors', () => {
  it('sorts WUBRG with colorless last and names the combination', () => {
    expect(sortColors(['G', 'B'])).toEqual(['B', 'G']);
    expect(colorComboName(['G', 'B'])).toBe('Golgari');
    expect(colorComboName(['B'])).toBe('Mono-black');
    expect(colorComboName(['W', 'U', 'B', 'R', 'G'])).toBe('Five-color');
    expect(colorComboName([])).toBe('');
  });

  it('exact matches the identity itself', () => {
    const bg = new Set(['B', 'G']);
    expect(colorIdentityMatches(['B', 'G'], bg, 'exact')).toBe(true);
    expect(colorIdentityMatches(['B'], bg, 'exact')).toBe(false);
    expect(colorIdentityMatches(['W', 'B', 'G'], bg, 'exact')).toBe(false);
  });

  it('within lets anything castable in the colors through, colorless included', () => {
    const bg = new Set(['B', 'G']);
    expect(colorIdentityMatches(['B'], bg, 'within')).toBe(true);
    expect(colorIdentityMatches([], bg, 'within')).toBe(true);
    expect(colorIdentityMatches(['W', 'B', 'G'], bg, 'within')).toBe(false);
  });

  it('reads an empty identity as colorless and passes everything with no filter', () => {
    expect(colorIdentityMatches([], new Set(['C']), 'exact')).toBe(true);
    expect(colorIdentityMatches(['R'], new Set(), 'exact')).toBe(true);
  });

  it('spells out the mode in words', () => {
    expect(colorModeHint(new Set(['G', 'B']), 'exact')).toBe('Black-green commanders only');
    expect(colorModeHint(new Set(['B']), 'exact')).toBe('Mono-black commanders only');
    expect(colorModeHint(new Set(['G', 'B']), 'within')).toBe(
      'Anything you can play in black-green'
    );
    expect(colorModeHint(new Set(['C']), 'within')).toBe('Colorless commanders only');
    expect(colorModeHint(new Set(), 'exact')).toBe('');
  });
});

describe('buildScryfallQuery', () => {
  it('reads plain words as a name, type or rules-text search', () => {
    expect(buildScryfallQuery(q({ text: 'sacrifice' }))).toBe(
      '((sacrifice) OR t:"sacrifice" OR o:"sacrifice")'
    );
  });

  it('passes Scryfall syntax through as typed', () => {
    expect(buildScryfallQuery(q({ text: 'o:"dies" pow>=5' }))).toBe('(o:"dies" pow>=5)');
  });

  it('adds the color identity clause for each mode', () => {
    const bg = new Set(['G', 'B']);
    expect(buildScryfallQuery(q({ colors: bg }))).toBe('id=bg');
    expect(buildScryfallQuery(q({ colors: bg, colorMode: 'within' }))).toBe('id<=bg');
    expect(buildScryfallQuery(q({ colors: new Set(['C']), colorMode: 'within' }))).toBe('id=c');
  });

  it("ORs the playstyles' clauses together", () => {
    const aristocrats = playstyleById('aristocrats')!.oracle;
    expect(buildScryfallQuery(q({ playstyleIds: ['aristocrats'] }))).toBe(`o:/${aristocrats}/`);
    expect(buildScryfallQuery(q({ playstyleIds: ['aristocrats', 'tribal'] }))).toBe(
      `(o:/${aristocrats}/ OR otag:typal)`
    );
  });

  it('leaves the playstyles out for the offline catalog', () => {
    expect(buildScryfallQuery(q({ text: 'elf', playstyleIds: ['tokens'] }), false)).toBe(
      '((elf) OR t:"elf" OR o:"elf")'
    );
  });

  it('ignores a one-letter search and strips quotes from plain words', () => {
    expect(buildScryfallQuery(q({ text: 'a' }))).toBe('');
    expect(buildScryfallQuery(q({ text: 'draw "a" card' }))).toBe(
      '((draw a card) OR t:"draw a card" OR o:"draw a card")'
    );
  });

  it('knows when anything beyond colors is being searched', () => {
    expect(isSearching({ text: '', playstyleIds: [] })).toBe(false);
    expect(isSearching({ text: 'e', playstyleIds: [] })).toBe(false);
    expect(isSearching({ text: 'elf', playstyleIds: [] })).toBe(true);
    expect(isSearching({ text: '', playstyleIds: ['tokens'] })).toBe(true);
  });
});

describe('matchReason', () => {
  const chatterfang = {
    name: 'Chatterfang, Squirrel General',
    typeLine: 'Legendary Creature — Squirrel Warrior',
    oracleText:
      'Forestwalk\nIf one or more tokens would be created under your control, those tokens plus that many 1/1 green Squirrel creature tokens are created instead.\n{B}, Sacrifice X Squirrels: Target creature gets +X/-X until end of turn.',
  };

  it('prefers the name, then the type line', () => {
    expect(matchReason(chatterfang, 'chatter')?.field).toBe('name');
    const type = matchReason(chatterfang, 'warrior')!;
    expect(type.field).toBe('type');
    expect(type.text.slice(type.start, type.end)).toBe('Warrior');
  });

  it('quotes the rules sentence that matched, with the span to highlight', () => {
    const r = matchReason(chatterfang, 'sacrifice')!;
    expect(r.field).toBe('rules');
    expect(r.text).toBe(
      '{B}, Sacrifice X Squirrels: Target creature gets +X/-X until end of turn.'
    );
    expect(r.text.slice(r.start, r.end)).toBe('Sacrifice');
  });

  it('clips a long sentence around the match', () => {
    const long = {
      name: 'Long',
      oracleText: `${'word '.repeat(40)}sacrifice ${'tail '.repeat(40)}end.`,
    };
    const r = matchReason(long, 'sacrifice')!;
    expect(r.text.startsWith('…')).toBe(true);
    expect(r.text.endsWith('…')).toBe(true);
    expect(r.text.slice(r.start, r.end)).toBe('sacrifice');
  });

  it('has no reason for syntax, a miss, or a one-letter query', () => {
    expect(matchReason(chatterfang, 'o:sacrifice')).toBeNull();
    expect(matchReason(chatterfang, 'dragon')).toBeNull();
    expect(matchReason(chatterfang, 's')).toBeNull();
  });
});

describe('compareEntries', () => {
  const entry = (name: string, over: Partial<FinderEntry> = {}): FinderEntry => ({
    key: name,
    name,
    colors: ['B'],
    playstyleIds: [],
    ...over,
  });
  const ctx = (over: Partial<CompareContext> = {}): CompareContext => ({
    sort: 'match',
    text: '',
    selectedPlaystyles: [],
    readiness: () => undefined,
    ...over,
  });
  const order = (list: FinderEntry[], c: CompareContext) =>
    [...list].sort((a, b) => compareEntries(a, b, c)).map((e) => e.name);

  it('ranks commanders matching more chosen playstyles first', () => {
    const both = entry('Both', { playstyleIds: ['tokens', 'aristocrats'], popularity: 50 });
    const one = entry('One', { playstyleIds: ['tokens'], popularity: 1 });
    expect(order([one, both], ctx({ selectedPlaystyles: ['tokens', 'aristocrats'] }))).toEqual([
      'Both',
      'One',
    ]);
  });

  it("puts EDHREC's crowd list ahead of rules-text-only hits, then name over rules text", () => {
    const listed = entry('Listed', { playstyleIds: ['tokens'], tagRank: 3, popularity: 90 });
    const unlisted = entry('Unlisted', { playstyleIds: ['tokens'], popularity: 1 });
    expect(order([unlisted, listed], ctx({ selectedPlaystyles: ['tokens'] }))).toEqual([
      'Listed',
      'Unlisted',
    ]);
    const byName = entry('Elf King', { popularity: 90 });
    const byText = entry('Other', {
      oracleText: 'Elf creatures you control get +1/+1.',
      popularity: 1,
    });
    expect(order([byText, byName], ctx({ text: 'elf' }))).toEqual(['Elf King', 'Other']);
  });

  it('sorts popular, name and mana value with unknowns last', () => {
    const a = entry('A', { popularity: 2, cmc: 5 });
    const b = entry('B', { popularity: 1 });
    const c = entry('C', { popularity: undefined, cmc: 2 });
    expect(order([c, a, b], ctx({ sort: 'popular' }))).toEqual(['B', 'A', 'C']);
    expect(order([b, c, a], ctx({ sort: 'name' }))).toEqual(['A', 'B', 'C']);
    expect(order([b, a, c], ctx({ sort: 'mv' }))).toEqual(['C', 'A', 'B']);
  });

  it('sorts by how much of the deck you own, unscored last', () => {
    const pct: Record<string, number> = { high: 80, low: 20 };
    const c = ctx({ sort: 'owned', readiness: (n) => pct[n] });
    expect(order([entry('Unscored'), entry('Low'), entry('High')], c)).toEqual([
      'High',
      'Low',
      'Unscored',
    ]);
  });
});

describe('effectiveSort', () => {
  it('defaults to best match while searching and popular otherwise', () => {
    expect(effectiveSort(null, true)).toBe('match');
    expect(effectiveSort(null, false)).toBe('popular');
    expect(effectiveSort('match', false)).toBe('popular');
    expect(effectiveSort('name', true)).toBe('name');
  });
});

describe('relaxations and filterSummary', () => {
  const full = {
    ...q({
      text: 'sac',
      colors: new Set(['G', 'B']),
      playstyleIds: ['aristocrats', 'tokens'],
    }),
    source: 'owned' as const,
  };

  it('offers each filter an empty result could drop', () => {
    expect(relaxations(full).map((r) => r.label)).toEqual([
      'Search all commanders',
      'Within black-green',
      'Remove Aristocrats',
      'Remove Tokens',
      'Clear the search',
    ]);
    expect(relaxations({ ...q(), source: 'all' })).toEqual([]);
  });

  it('summarizes the filters on one line', () => {
    expect(filterSummary(full)).toBe('Golgari · Aristocrats or Tokens · “sac”');
    expect(filterSummary({ ...full, colorMode: 'within', text: '' })).toBe(
      'within black-green · Aristocrats or Tokens'
    );
    expect(filterSummary(q())).toBe('');
  });
});
