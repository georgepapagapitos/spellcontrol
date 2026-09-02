import { describe, expect, it } from 'vitest';
import { buildFriendSearch, friendPayloadCaps } from './friend-search';
import type { FriendCard } from './cube/pool';

function card(overrides: Partial<FriendCard> = {}): FriendCard {
  return {
    name: 'Sol Ring',
    oracleId: 'o-sol',
    colors: [],
    colorIdentity: [],
    cmc: 1,
    typeLine: 'Artifact',
    rarity: 'uncommon',
    ...overrides,
  };
}

const forest = card({
  name: 'Llanowar Elves',
  oracleId: 'o-elf',
  colors: ['G'],
  colorIdentity: ['G'],
  cmc: 1,
  typeLine: 'Creature — Elf Druid',
  rarity: 'common',
});

describe('buildFriendSearch — answerable clauses', () => {
  it('matches everything on an empty query', () => {
    const s = buildFriendSearch('  ');
    expect(s.kind).toBe('empty');
    expect(s.match(forest)).toBe(true);
  });

  it('plain text is a name substring', () => {
    const s = buildFriendSearch('llanowar');
    expect(s.kind).toBe('name');
    expect(s.match(forest)).toBe(true);
    expect(s.match(card())).toBe(false);
  });

  it('supports t: and cmc comparisons', () => {
    expect(buildFriendSearch('t:artifact').match(card())).toBe(true);
    expect(buildFriendSearch('t:artifact').match(forest)).toBe(false);
    expect(buildFriendSearch('cmc<=1').match(forest)).toBe(true);
    expect(buildFriendSearch('cmc>=3').match(forest)).toBe(false);
  });

  it('supports r: now that rarity ships in the payload', () => {
    expect(buildFriendSearch('r:common').match(forest)).toBe(true);
    expect(buildFriendSearch('r:common').match(card())).toBe(false);
  });

  it('supports otag: via the name-keyed tag lookup', () => {
    const tagsFor = (n: string) => (n === 'Sol Ring' ? ['mana-rock'] : []);
    const s = buildFriendSearch('otag:mana-rock', tagsFor);
    expect(s.usesTags).toBe(true);
    expect(s.match(card())).toBe(true);
    expect(s.match(forest)).toBe(false);
  });
});

describe('buildFriendSearch — ci: is the bug this feature exists to fix', () => {
  it('does NOT match a green card against ci<=r', () => {
    // The engine matches `subset` by walking the colours ON THE CARD, so an
    // absent identity (empty set) vacuously satisfied every needle — the whole
    // collection came back for any ci: query.
    expect(buildFriendSearch('ci<=r').match(forest)).toBe(false);
  });

  it('matches a green card against ci<=g and colourless against anything', () => {
    expect(buildFriendSearch('ci<=g').match(forest)).toBe(true);
    expect(buildFriendSearch('ci<=r').match(card())).toBe(true); // truly colourless
  });

  it('falls back to `colors` when a cached payload predates the enrichment', () => {
    // Absent identity must NOT read as colourless — that is the original bug.
    const legacy: FriendCard = {
      name: 'Llanowar Elves',
      oracleId: 'o-elf',
      colors: ['G'],
      cmc: 1,
      typeLine: 'Creature — Elf Druid',
    };
    expect(buildFriendSearch('ci<=r').match(legacy)).toBe(false);
    expect(buildFriendSearch('ci<=g').match(legacy)).toBe(true);
  });
});

describe('buildFriendSearch — unanswerable clauses are stripped and reported', () => {
  it('reports o: instead of silently returning nothing', () => {
    const s = buildFriendSearch('o:draw');
    expect(s.ignored).toEqual(['o:']);
    // Every clause dropped → no results, so the UI never reads as a real hit
    // list; the `ignored` label is what explains it.
    expect(s.match(forest)).toBe(false);
  });

  it('keeps the answerable half of a mixed query working', () => {
    const s = buildFriendSearch('t:artifact o:draw');
    expect(s.ignored).toEqual(['o:']);
    expect(s.match(card())).toBe(true); // artifact survives
    expect(s.match(forest)).toBe(false); // creature still excluded
  });

  it('reports keyword: and f: too', () => {
    expect(buildFriendSearch('keyword:flying').ignored).toEqual(['keyword:']);
    expect(buildFriendSearch('f:commander').ignored).toEqual(['f:']);
  });

  it('dedupes repeated unanswerable clauses', () => {
    expect(buildFriendSearch('o:draw o:discard').ignored).toEqual(['o:']);
  });

  it('reports nothing when every clause is answerable', () => {
    expect(buildFriendSearch('t:creature cmc<=2').ignored).toEqual([]);
  });
});

describe('buildFriendSearch — an enriched payload answers o: and f:', () => {
  const rhystic = card({
    name: 'Rhystic Study',
    oracleId: 'o-rhystic',
    colors: ['U'],
    colorIdentity: ['U'],
    cmc: 3,
    typeLine: 'Enchantment',
    oracleText:
      'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
    legalities: { commander: 'legal', modern: 'not_legal' },
  });

  it('probes the payload for the optional facts', () => {
    expect(friendPayloadCaps([forest, rhystic])).toEqual({ oracleText: true, legalities: true });
    expect(friendPayloadCaps([forest])).toEqual({ oracleText: false, legalities: false });
  });

  it('answers o: and f: when the payload carries them, and still strips keyword:', () => {
    const caps = friendPayloadCaps([rhystic]);
    const draw = buildFriendSearch('o:draw', undefined, caps);
    expect(draw.ignored).toEqual([]);
    expect(draw.match(rhystic)).toBe(true);
    expect(draw.match(forest)).toBe(false);

    const cmdr = buildFriendSearch('f:commander keyword:flying', undefined, caps);
    expect(cmdr.ignored).toEqual(['keyword:']);
    expect(cmdr.match(rhystic)).toBe(true);
    expect(buildFriendSearch('f:modern', undefined, caps).match(rhystic)).toBe(false);
  });

  it('keeps stripping o: for a payload that predates the enrichment', () => {
    const s = buildFriendSearch('o:draw', undefined, friendPayloadCaps([forest]));
    expect(s.ignored).toEqual(['o:']);
  });
});
