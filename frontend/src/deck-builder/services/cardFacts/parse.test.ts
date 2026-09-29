import { describe, expect, it } from 'vitest';
import { GOLD } from './gold.fixtures';
import { TEST_CARDS } from './test-cards.fixtures';
import {
  costAtoms,
  facesOf,
  hitsOf,
  parseTrigger,
  polarityOf,
  spellHitsOf,
  splitAbilities,
} from './parse';
import { normalizeLine, numberless, parseCount, selfNames, sentences } from './normalize';
import type { FactsInputCard } from './schema';

const gold = (name: string): FactsInputCard => {
  const g = GOLD.find((x) => x.card.name === name);
  if (!g) throw new Error(`no gold card ${name}`);
  return g.card;
};
const abilitiesOf = (card: FactsInputCard) => facesOf(card).flatMap((f) => splitAbilities(card, f));
const tuple = (a: ReturnType<typeof abilitiesOf>[number]) =>
  `${a.trigger ? `${a.trigger.event}/${a.trigger.object}/${a.trigger.who}` : a.kind}>${a.effects
    .map((e) => `${e.verb}/${e.object}/${e.who}`)
    .join('+')}`;

describe('normalize', () => {
  it('folds the card name, a legendary short name and "this <type>" into cardname', () => {
    const names = selfNames('Liliana, Dreadhorde General', [], true);
    expect(names).toContain('liliana');
    expect(normalizeLine('When Liliana enters, this creature gets +1/+1.', names)).toBe(
      'when cardname enters, cardname gets +1/+1.'
    );
  });

  it('never gives a non-legendary card a short name', () => {
    expect(selfNames('Sword of Feast and Famine', [], false)).toEqual([
      'sword of feast and famine',
    ]);
  });

  it('strips reminder text and straightens the minus sign', () => {
    expect(normalizeLine('−4: Draw a card. (Reminder.)', [])).toBe('-4: draw a card.');
  });

  it('replaces every number with N for the similarity variant', () => {
    expect(numberless('deals 3 damage to two target creatures and x more')).toBe(
      'deals N damage to N target creatures and N more'
    );
  });

  it('parses count words', () => {
    expect(parseCount('three')).toBe(3);
    expect(parseCount('x')).toBe('X');
    expect(parseCount('12')).toBe(12);
    expect(parseCount('many')).toBeNull();
    expect(parseCount(undefined)).toBeNull();
  });

  it('splits sentences on periods', () => {
    expect(sentences('destroy target creature. draw a card.')).toEqual([
      'destroy target creature',
      'draw a card',
    ]);
  });
});

describe('clause-level tuples with controller polarity', () => {
  it('reads Grave Pact, Dictate of Erebos and Butcher of Malakir as the same tuple', () => {
    const expected = 'dies/creature/you>sacrifice/creature/opp';
    const pact = abilitiesOf(gold('Grave Pact'));
    const dictate = abilitiesOf(TEST_CARDS['Dictate of Erebos']);
    const butcher = abilitiesOf(TEST_CARDS['Butcher of Malakir']);
    expect(pact.map(tuple)).toEqual([expected]);
    expect(dictate.map(tuple)).toEqual([expected]);
    expect(butcher.map(tuple)).toEqual([expected]);
    // Dictate differs only in speed: it has flash.
    expect(dictate[0].speed).toBe('triggered');
    expect(facesOf(TEST_CARDS['Dictate of Erebos'])).toHaveLength(1);
  });

  it('models "dies" as a battlefield → graveyard zone change', () => {
    const [a] = abilitiesOf(gold('Grave Pact'));
    expect(a.trigger).toMatchObject({ event: 'dies', from: 'battlefield', to: 'graveyard' });
    expect(a.effects[0]).toMatchObject({ verb: 'sacrifice', from: 'battlefield', to: 'graveyard' });
  });

  it("tells your creatures from an opponent's and from any creature", () => {
    expect(parseTrigger('whenever a creature you control dies').who).toBe('you');
    expect(parseTrigger('whenever a creature an opponent controls dies').who).toBe('opp');
    expect(parseTrigger('whenever another creature dies').who).toBe('any');
    expect(parseTrigger('when cardname dies').who).toBe('self');
    expect(parseTrigger('whenever an opponent casts a noncreature spell')).toMatchObject({
      event: 'cast',
      object: 'spell:noncreature',
      who: 'opp',
    });
  });

  it('keeps landfall as a land entering under your control', () => {
    expect(parseTrigger('whenever a land you control enters')).toMatchObject({
      event: 'enters',
      to: 'battlefield',
      object: 'land',
      who: 'you',
    });
  });

  it('reads step triggers by whose step it is', () => {
    expect(parseTrigger('at the beginning of your upkeep')).toMatchObject({
      event: 'upkeep',
      who: 'you',
    });
    expect(parseTrigger("at the beginning of each opponent's upkeep")).toMatchObject({
      event: 'upkeep',
      who: 'opp',
    });
    expect(parseTrigger('at the beginning of each end step')).toMatchObject({
      event: 'end-step',
      who: 'each',
    });
  });

  it('does not split a trigger at the commas of a type list', () => {
    const card: FactsInputCard = {
      oracle_id: 'test',
      name: 'Test',
      type_line: 'Enchantment',
      oracle_text: 'Whenever you cast a creature, artifact, or enchantment spell, draw a card.',
    };
    const [a] = abilitiesOf(card);
    expect(a.trigger?.event).toBe('cast');
    expect(a.effects.map((e) => e.verb)).toEqual(['draw']);
  });

  it('splits an ETB whose effect starts with "creatures" (Craterhoof Behemoth)', () => {
    // "Haste" is a keyword line, so the ETB is the only ability.
    const [etb] = abilitiesOf(gold('Craterhoof Behemoth'));
    expect(etb.kind).toBe('etb');
    expect(etb.effects.find((e) => e.verb === 'pump')).toMatchObject({
      scope: 'mass',
      who: 'you',
      amount: 'X',
    });
  });

  it('skips keyword lines but not ability-word abilities (Tireless Tracker landfall)', () => {
    const abilities = abilitiesOf(gold('Tireless Tracker'));
    expect(abilities.map((a) => a.trigger?.event)).toEqual(['enters', 'sacrifice']);
    expect(abilities[0].effects[0]).toMatchObject({ verb: 'token', object: 'token:clue' });
  });

  it('attaches bullet modes to their header, including a "choose one." line (Jeska\'s Will)', () => {
    const abilities = abilitiesOf(gold("Jeska's Will"));
    expect(abilities).toHaveLength(2);
    expect(abilities.every((a) => a.modal && a.modalGroup === abilities[0].modalGroup)).toBe(true);
  });

  it('marks an ultimate from the starting loyalty', () => {
    const abilities = abilitiesOf(gold('Liliana, Dreadhorde General'));
    const loyalty = abilities.filter((a) => a.kind === 'loyalty');
    expect(loyalty.map((a) => a.loyalty)).toEqual([1, -4, -9]);
    expect(loyalty.map((a) => a.limits.includes('ultimate'))).toEqual([false, false, true]);
  });

  it('marks a transformed back face and a prepare spell face', () => {
    const norn = facesOf(gold('Elesh Norn // The Argent Etchings'));
    expect(norn[1].limits).toEqual(['transform']);
    const trio = facesOf(gold('Harmonized Trio // Brainstorm'));
    expect(trio[1].limits).toEqual(['prepare']);
    const fire = facesOf(gold('Fire // Ice'));
    expect(fire[1].limits).toEqual([]);
  });

  it('reads an activated cost into atoms, and a self-sacrifice as once', () => {
    expect(costAtoms('{t}, sacrifice a creature')).toEqual(['sac:creature', 'tap']);
    expect(costAtoms('{2}, {t}, sacrifice cardname')).toEqual(['mana', 'sac:self', 'tap']);
    const [deed] = abilitiesOf(gold('Pernicious Deed'));
    expect(deed.repeat).toBe('once');
    const [altar] = abilitiesOf(gold("Ashnod's Altar"));
    expect(altar.repeat).toBe('repeatable');
  });
});

describe('effect objects', () => {
  it('names the permanent types a removal phrase hits', () => {
    expect(hitsOf('artifact, enchantment, or nonbasic land an opponent controls')).toEqual([
      'artifact',
      'enchantment',
      'land',
    ]);
    expect(hitsOf('nonland permanent')).toEqual(['nonland-permanent']);
    expect(hitsOf('nonartifact creature')).toEqual(['creature']);
    expect(hitsOf('creature card in a graveyard')).toEqual([]);
  });

  it('names the spell kinds a counterspell hits', () => {
    expect(spellHitsOf('noncreature spell')).toEqual(['noncreature-spell']);
    expect(spellHitsOf('enchantment, instant, or sorcery spell')).toEqual([
      'instant-sorcery-spell',
      'noncreature-spell',
    ]);
    expect(spellHitsOf('activated or triggered ability')).toEqual(['ability']);
    expect(spellHitsOf('spell')).toEqual(['spell']);
  });

  it('reads whose object it is', () => {
    expect(polarityOf("target creature you don't control")).toBe('opp');
    expect(polarityOf('target creature you control')).toBe('you');
    expect(polarityOf('target creature')).toBe('any');
  });
});
