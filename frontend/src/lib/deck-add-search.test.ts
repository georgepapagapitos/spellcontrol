import { describe, it, expect } from 'vitest';
import {
  buildCollectionSearch,
  compareResults,
  hasQuerySyntax,
  type AddSort,
  type SortableResult,
} from './deck-add-search';
import type { EnrichedCard } from '../types';

function mkCard(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: 'c1',
    name: 'Divination',
    setCode: 'M20',
    setName: 'Core Set 2020',
    collectorNumber: '55',
    rarity: 'common',
    scryfallId: 's1',
    purchasePrice: 0.1,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    cmc: 3,
    typeLine: 'Sorcery',
    colorIdentity: ['U'],
    colors: ['U'],
    manaCost: '{2}{U}',
    oracleText: 'Draw two cards.',
    legalities: { commander: 'legal' },
    layout: 'normal',
    ...overrides,
  } as EnrichedCard;
}

describe('hasQuerySyntax', () => {
  it('detects operator clauses', () => {
    expect(hasQuerySyntax('t:instant')).toBe(true);
    expect(hasQuerySyntax('cmc<=2')).toBe(true);
    expect(hasQuerySyntax('-o:draw')).toBe(true);
    expect(hasQuerySyntax('!"Sol Ring"')).toBe(true);
    expect(hasQuerySyntax('t:creature OR t:land')).toBe(true);
  });

  it('treats plain names as non-syntax', () => {
    expect(hasQuerySyntax('sol ring')).toBe(false);
    expect(hasQuerySyntax('draw')).toBe(false);
    // Real card names with a colon-space read as plain text, not an operator.
    expect(hasQuerySyntax('Circle of Protection: Red')).toBe(false);
  });
});

describe('buildCollectionSearch — plain text', () => {
  it('empty query matches everything', () => {
    const s = buildCollectionSearch('   ');
    expect(s.kind).toBe('empty');
    expect(s.match(mkCard()).hit).toBe(true);
  });

  it('matches name (punctuation-agnostic) and flags nameHit', () => {
    const s = buildCollectionSearch('divination');
    expect(s.kind).toBe('name');
    expect(s.match(mkCard())).toEqual({ hit: true, nameHit: true });
  });

  it('matches oracle text without a nameHit', () => {
    const s = buildCollectionSearch('draw two');
    expect(s.match(mkCard())).toEqual({ hit: true, nameHit: false });
    expect(s.match(mkCard({ oracleText: 'Counter target spell.' })).hit).toBe(false);
  });
});

describe('buildCollectionSearch — syntax', () => {
  it('runs type/oracle/cmc clauses against the collection card', () => {
    expect(buildCollectionSearch('t:sorcery o:draw').match(mkCard()).hit).toBe(true);
    expect(buildCollectionSearch('t:instant').match(mkCard()).hit).toBe(false);
    expect(buildCollectionSearch('cmc<=2').match(mkCard()).hit).toBe(false);
    expect(buildCollectionSearch('cmc<=3').match(mkCard()).hit).toBe(true);
  });

  it('matches rarity', () => {
    expect(buildCollectionSearch('r:common').match(mkCard()).hit).toBe(true);
    expect(buildCollectionSearch('r:mythic').match(mkCard()).hit).toBe(false);
  });

  it('rewrites keyword: to an oracle-text match (collection rows carry no keywords)', () => {
    const flyer = mkCard({ oracleText: 'Flying\nWhen this enters, draw a card.' });
    expect(buildCollectionSearch('keyword:flying').match(flyer).hit).toBe(true);
    expect(buildCollectionSearch('keyword:trample').match(flyer).hit).toBe(false);
  });

  it('matches otag: through the supplied lookup and flags usesTags', () => {
    const tagsFor = (name: string) => (name === 'Divination' ? ['card-advantage'] : []);
    const s = buildCollectionSearch('otag:card-advantage', tagsFor);
    expect(s.usesTags).toBe(true);
    expect(s.match(mkCard()).hit).toBe(true);
    expect(s.match(mkCard({ name: 'Shock' })).hit).toBe(false);
  });

  it('degrades otag: to match-anything when no lookup is supplied', () => {
    const s = buildCollectionSearch('otag:ramp t:sorcery');
    expect(s.match(mkCard()).hit).toBe(true);
  });
});

describe('compareResults', () => {
  const rows: SortableResult[] = [
    { name: 'Beta', nameHit: false, cmc: 1, price: 5, inclusion: 40 },
    { name: 'Alpha', nameHit: false, cmc: 4, price: undefined, edhrecRank: 100 },
    { name: 'Zeta', nameHit: true, cmc: 2, price: 0.5, edhrecRank: 5 },
  ];
  const sortBy = (sort: AddSort) => [...rows].sort((a, b) => compareResults(a, b, sort));

  it('default ranks name hits first, then alphabetical', () => {
    expect(sortBy('default').map((r) => r.name)).toEqual(['Zeta', 'Alpha', 'Beta']);
  });

  it('name sorts alphabetically', () => {
    expect(sortBy('name').map((r) => r.name)).toEqual(['Alpha', 'Beta', 'Zeta']);
  });

  it('cmc sorts ascending with unknown last', () => {
    expect(sortBy('cmc').map((r) => r.name)).toEqual(['Beta', 'Zeta', 'Alpha']);
    const unknown = [...rows, { name: 'NoCmc' }].sort((a, b) => compareResults(a, b, 'cmc'));
    expect(unknown[unknown.length - 1].name).toBe('NoCmc');
  });

  it('price sorts descending with unknown last', () => {
    expect(sortBy('price').map((r) => r.name)).toEqual(['Beta', 'Zeta', 'Alpha']);
  });

  it('edhrec ranks inclusion above rank fallback, then rank ascending', () => {
    expect(sortBy('edhrec').map((r) => r.name)).toEqual(['Beta', 'Zeta', 'Alpha']);
  });
});
