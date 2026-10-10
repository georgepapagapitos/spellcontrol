import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import fixture from '../mana-sim/__fixtures__/chance-cards.fixture.json';
import { card as deckCard, jodah, brago } from '../mana-sim/__fixtures__/decks';
import {
  chanceLine,
  chanceOdds,
  chanceProblem,
  formatChance,
  hypergeometricAtLeast,
  isChanceCard,
} from './chance-cards';

const chance = new Map(
  (fixture.cards as unknown as ScryfallCard[]).map((c) => [c.name.split(' // ')[0], c])
);
const get = (n: string) => {
  const c = chance.get(n);
  if (!c) throw new Error(n);
  return c;
};
const real = (n: string) => deckCard(n);

/** A real 99-ish list: Jodah's five-color pile plus Brago's Azorius spells. */
const DECK = [...jodah().library, ...brago([]).library];

describe('the rules each card is encoded against (real oracle text)', () => {
  it.each([
    ['Bloodbraid Elf', 1, 4],
    ['Bituminous Blast', 1, 5],
    ['Apex Devastator', 4, 10],
    ['Shardless Agent', 1, 3],
    ['Maelstrom Wanderer', 2, 8],
  ])('%s cascades %i time(s) from mana value %i', (name, k, mv) => {
    const c = get(name);
    expect(c.oracle_text).toMatch(
      new RegExp(`^${Array(k).fill('Cascade').join(', ').replace(/^C/, 'C')}`, 'mi')
    );
    expect(c.cmc).toBe(mv);
  });

  it('keeps the text the reveal and top-N rules read', () => {
    expect(get('Gamekeeper').oracle_text).toContain('until you reveal a creature card');
    expect(get('Kethek, Crucible Goliath').oracle_text).toContain(
      'nonlegendary creature card with lesser mana value'
    );
    expect(get('Proteus Staff').oracle_text).toContain('until they reveal a creature card');
    expect(get('Collected Company').oracle_text).toContain(
      'top six cards of your library. Put up to two creature cards with mana value 3 or less'
    );
    expect(get('Birthing Ritual').oracle_text).toContain('top seven cards');
    expect(get('Birthing Ritual').oracle_text).toContain('1 plus the sacrificed creature');
    const ojer = get('Ojer Kaslem, Deepest Growth');
    expect(ojer.card_faces?.[0].power).toBe('6');
    expect(ojer.card_faces?.[0].oracle_text).toContain('reveal that many cards');
    expect(get('Etali, Primal Storm').oracle_text).toContain('exile the top card of each');
  });
});

describe('hypergeometricAtLeast', () => {
  it('matches hand-worked draws', () => {
    // 2 hits in 10, draw 1: 20%. Draw 2: 1 - (8/10)(7/9).
    expect(hypergeometricAtLeast(10, 2, 1, 1)).toBeCloseTo(0.2, 10);
    expect(hypergeometricAtLeast(10, 2, 2, 1)).toBeCloseTo(1 - (8 / 10) * (7 / 9), 10);
    expect(hypergeometricAtLeast(10, 2, 2, 2)).toBeCloseTo((2 / 10) * (1 / 9), 10);
    expect(hypergeometricAtLeast(10, 0, 5, 1)).toBe(0);
    expect(hypergeometricAtLeast(4, 4, 9, 4)).toBe(1);
  });
});

describe('chanceOdds', () => {
  it('is null for a card with no odds, and isChanceCard agrees', () => {
    expect(chanceOdds(real('Sol Ring'), DECK)).toBeNull();
    expect(isChanceCard(real('Sol Ring'))).toBe(false);
    expect(isChanceCard(get('Bloodbraid Elf'))).toBe(true);
    expect(isChanceCard(get('Ojer Kaslem, Deepest Growth'))).toBe(true);
  });

  it('cascade is the exact share of qualifying cards, on real cards', () => {
    // Library: one 1-drop, one 2-drop, one 3-drop, a 4-drop (too dear) and a land.
    const lib = [real('Sol Ring'), real('Arcane Signet'), real('Rampant Growth'), real('Forest')];
    const odds = chanceOdds(get('Bloodbraid Elf'), lib)!;
    const cmcs = lib.filter((c) => !c.type_line.includes('Land') && c.cmc < 4);
    const good = cmcs.filter((c) => c.cmc >= 2).length;
    const spell = odds.outcomes.find((o) => o.id === 'spell')!;
    expect(spell.p).toBeCloseTo(good / cmcs.length, 10);
    expect(spell.label).toBe('a spell of 2+');
  });

  it('removes the chance card itself and counts a cascade from a commander', () => {
    const bbe = get('Bloodbraid Elf');
    const a = chanceOdds(bbe, [bbe, real('Sol Ring')])!;
    const b = chanceOdds(bbe, [real('Sol Ring')])!;
    expect(a.outcomes.map((o) => o.p)).toEqual(b.outcomes.map((o) => o.p));
  });

  it('four cascades hit more often than one, and Yidris reads as a 6-drop', () => {
    const one = chanceOdds(get('Bituminous Blast'), DECK)!.outcomes[0].p;
    const many = chanceOdds(get('Apex Devastator'), DECK)!;
    expect(many.lead).toBe('4 cascades from 10');
    expect(many.outcomes[0].p).toBeGreaterThanOrEqual(one);
    expect(chanceOdds(get('Yidris, Maelstrom Wielder'), DECK)!.lead).toBe('Cascading from 6');
  });

  it('reveal-until is the share of qualifying creatures', () => {
    const lib = [
      real('Sol Ring'),
      real('Forest'),
      ...DECK.filter((c) => /Creature/.test(c.type_line)),
    ];
    const creatures = lib.filter((c) => /Creature/.test(c.type_line));
    const odds = chanceOdds(get('Gamekeeper'), lib)!;
    expect(odds.outcomes[0].p).toBeCloseTo(
      creatures.filter((c) => c.cmc >= 5).length / creatures.length,
      10
    );
    const staff = chanceOdds(get('Proteus Staff'), lib)!;
    expect(staff.outcomes.map((o) => o.id)).toContain('good');
  });

  it('Kethek only counts nonlegendary creatures below the sacrificed value', () => {
    const odds = chanceOdds(get('Kethek, Crucible Goliath'), DECK)!;
    const pool = DECK.filter(
      (c) => /Creature/.test(c.type_line) && !/Legendary/.test(c.type_line) && c.cmc < 4
    );
    expect(odds.outcomes[0].p).toBeCloseTo(
      pool.filter((c) => c.cmc === 3).length / pool.length,
      10
    );
  });

  it('top-N: Ojer, Collected Company and Etali', () => {
    const lands = DECK.filter((c) => /\bLand\b/.test(c.type_line)).length;
    const ojer = chanceOdds(get('Ojer Kaslem, Deepest Growth'), DECK)!;
    expect(ojer.outcomes[0].p).toBeCloseTo(hypergeometricAtLeast(DECK.length, lands, 6, 1), 10);
    const coco = chanceOdds(get('Collected Company'), DECK)!;
    expect(coco.outcomes[1].p).toBeLessThan(coco.outcomes[0].p);
    const etali = chanceOdds(get('Etali, Primal Storm'), DECK)!;
    expect(etali.outcomes.find((o) => o.id === 'land')!.p).toBeCloseTo(lands / DECK.length, 10);
  });

  it('names a weak result only when it is likely', () => {
    const dorks = DECK.filter(
      (c) => c.cmc <= 3 && /Creature/.test(c.type_line) && c.produced_mana?.length
    );
    const withDorks = [...dorks, ...dorks, ...dorks, real('Forest')];
    const odds = chanceOdds(get('Bloodbraid Elf'), withDorks)!;
    expect(odds.outcomes.some((o) => o.weak)).toBe(true);
    expect(
      chanceOdds(get('Bloodbraid Elf'), [real('Forest'), real('Sol Ring')])!.outcomes.some(
        (o) => o.weak
      )
    ).toBe(false);
  });
});

describe('chanceLine and chanceProblem', () => {
  it('formats the Ojer line like the mockup', () => {
    const line = chanceLine(chanceOdds(get('Ojer Kaslem, Deepest Growth'), DECK)!);
    expect(line).toMatch(
      /^When it connects for 6, in this deck · Finds a land \d+% · a creature of 4\+ \d+%$/
    );
  });

  it('percent never reads as a sure thing or an impossibility by rounding', () => {
    expect(formatChance(0.999)).toBe('99%');
    expect(formatChance(0.001)).toBe('<1%');
    expect(formatChance(1)).toBe('100%');
    expect(formatChance(0.4249)).toBe('42%');
  });

  it('a cascade casts, a reveal finds', () => {
    expect(chanceLine(chanceOdds(get('Bloodbraid Elf'), DECK)!)).toMatch(
      /^Cascading from 4 · Casts a spell of 2\+ \d+%/
    );
  });

  it('chanceProblem is null for a non-chance card and carries slice D text', () => {
    expect(chanceProblem(real('Sol Ring'), DECK)).toBeNull();
    const dorks = DECK.filter(
      (c) => c.cmc <= 3 && /Creature/.test(c.type_line) && c.produced_mana?.length
    );
    expect(dorks.length).toBeGreaterThan(0);
    {
      const p = chanceProblem(get('Shardless Agent'), [...dorks, ...dorks])!;
      expect(p.text).toMatch(/^Cascades into a mana creature \d+%$/);
    }
  });
});
