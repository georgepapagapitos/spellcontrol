import { describe, it, expect } from 'vitest';
import { filterCards, matchesQuery, parseQuery } from './scryfall-query';
import type { SlimCard } from './types';

function mkCard(overrides: Partial<SlimCard> = {}): SlimCard {
  return {
    oracleId: 'o-1',
    scryfallId: 's-1',
    name: 'Test Card',
    cmc: 3,
    typeLine: 'Legendary Creature — Human Wizard',
    oracleText: 'Whenever you cast a spell, draw a card.',
    colors: ['U'],
    colorIdentity: ['U'],
    keywords: ['flying'],
    legalities: { commander: 'legal', modern: 'legal' },
    set: 'xyz',
    layout: 'normal',
    ...overrides,
  };
}

describe('parseQuery', () => {
  it('groups AND clauses into a single group', () => {
    const q = parseQuery('t:creature f:commander');
    expect(q.groups).toHaveLength(1);
    expect(q.groups[0]).toHaveLength(2);
  });

  it('splits OR into separate groups at top level', () => {
    const q = parseQuery('t:creature OR t:land');
    expect(q.groups).toHaveLength(2);
  });

  it('treats parentheses as no-ops', () => {
    const q = parseQuery('(t:creature f:commander)');
    expect(q.groups).toHaveLength(1);
    expect(q.groups[0]).toHaveLength(2);
  });

  it('preserves quoted oracle phrases as a single token', () => {
    const q = parseQuery('o:"draw a card"');
    expect(q.groups[0][0]).toMatchObject({ kind: 'oracle', value: 'draw a card' });
  });

  it('handles negation prefix', () => {
    const q = parseQuery('-t:land');
    expect(q.groups[0][0]).toMatchObject({ kind: 'type', value: 'land', neg: true });
  });
});

describe('matchesQuery', () => {
  it('matches type:creature on a creature', () => {
    expect(matchesQuery(mkCard(), parseQuery('t:creature'))).toBe(true);
  });

  it('rejects type:land on a creature', () => {
    expect(matchesQuery(mkCard(), parseQuery('t:land'))).toBe(false);
  });

  it('matches oracle text fragment case-insensitively', () => {
    expect(matchesQuery(mkCard(), parseQuery('o:"DRAW A CARD"'))).toBe(true);
  });

  it('honors negation', () => {
    expect(matchesQuery(mkCard(), parseQuery('-t:land'))).toBe(true);
    expect(matchesQuery(mkCard(), parseQuery('-t:creature'))).toBe(false);
  });

  it('color identity subset (id<=)', () => {
    const card = mkCard({ colorIdentity: ['U'] });
    expect(matchesQuery(card, parseQuery('id<=WU'))).toBe(true);
    expect(matchesQuery(card, parseQuery('id<=W'))).toBe(false);
  });

  it('color identity equals (id=)', () => {
    expect(matchesQuery(mkCard({ colorIdentity: ['U', 'B'] }), parseQuery('id=UB'))).toBe(true);
    expect(matchesQuery(mkCard({ colorIdentity: ['U'] }), parseQuery('id=UB'))).toBe(false);
  });

  it('cmc comparisons', () => {
    expect(matchesQuery(mkCard({ cmc: 2 }), parseQuery('cmc<=3'))).toBe(true);
    expect(matchesQuery(mkCard({ cmc: 5 }), parseQuery('cmc<=3'))).toBe(false);
    expect(matchesQuery(mkCard({ cmc: 3 }), parseQuery('cmc=3'))).toBe(true);
  });

  it('is:commander requires legendary + creature', () => {
    const commander = mkCard();
    expect(matchesQuery(commander, parseQuery('is:commander'))).toBe(true);
    const nonLegendary = mkCard({ typeLine: 'Creature — Human Wizard' });
    expect(matchesQuery(nonLegendary, parseQuery('is:commander'))).toBe(false);
  });

  it('f:format checks legalities map', () => {
    expect(matchesQuery(mkCard(), parseQuery('f:commander'))).toBe(true);
    expect(
      matchesQuery(mkCard({ legalities: { commander: 'banned' } }), parseQuery('f:commander'))
    ).toBe(false);
  });

  it('banned:format flips the legality check', () => {
    const banned = mkCard({ legalities: { commander: 'banned' } });
    expect(matchesQuery(banned, parseQuery('banned:commander'))).toBe(true);
    expect(matchesQuery(mkCard(), parseQuery('banned:commander'))).toBe(false);
  });

  it('OR groups: either clause group can match', () => {
    expect(matchesQuery(mkCard(), parseQuery('t:land OR t:creature'))).toBe(true);
    expect(matchesQuery(mkCard(), parseQuery('t:land OR t:enchantment'))).toBe(false);
  });

  it('treats unknown clauses as no-op (degrade gracefully)', () => {
    // `unique:prints` is unsupported; should not bring the whole query to false
    expect(matchesQuery(mkCard(), parseQuery('t:creature unique:prints'))).toBe(true);
  });

  it('exact name matches case-insensitively', () => {
    expect(matchesQuery(mkCard(), parseQuery('!"test card"'))).toBe(true);
    expect(matchesQuery(mkCard(), parseQuery('!"other card"'))).toBe(false);
  });
});

describe('filterCards', () => {
  it('returns only matching cards', () => {
    const cards: SlimCard[] = [
      mkCard({ name: 'Forest', typeLine: 'Basic Land — Forest', colorIdentity: ['G'] }),
      mkCard({ name: 'Bear', typeLine: 'Creature — Bear', colorIdentity: ['G'] }),
      mkCard({ name: 'Counterspell', typeLine: 'Instant', colorIdentity: ['U'] }),
    ];
    const out = filterCards(cards, 't:land');
    expect(out.map((c) => c.name)).toEqual(['Forest']);
  });
});
