import { describe, it, expect } from 'vitest';
import {
  CREATURE_TYPES,
  creatureTypePlurals,
  parseCard,
  resolveCreatureType,
  typalFinderType,
  typalPayoffType,
} from './text';

const oracle = (text: string) => parseCard({ name: 'Probe', oracle_text: text }).oracle;

describe('creature types (E511)', () => {
  it('lists every type once', () => {
    expect(new Set(CREATURE_TYPES).size).toBe(CREATURE_TYPES.length);
    expect(CREATURE_TYPES).toContain('Time Lord');
    expect(CREATURE_TYPES).toContain('C’tan');
  });

  it('spells plurals the way Oracle text and EDHREC do', () => {
    expect(creatureTypePlurals('Elf')).toEqual(['Elves']);
    expect(creatureTypePlurals('Fungus')[0]).toBe('Fungi');
    expect(creatureTypePlurals('Octopus')[0]).toBe('Octopuses');
    expect(creatureTypePlurals('Sphinx')).toEqual(['Sphinxes']);
    expect(creatureTypePlurals('Ally')).toEqual(['Allies']);
    expect(creatureTypePlurals('Monkey')).toEqual(['Monkeys']);
    expect(creatureTypePlurals('Hero')).toEqual(['Heroes']);
    expect(creatureTypePlurals('Kor')).toEqual(['Kor']);
    expect(creatureTypePlurals('Time Lord')).toEqual(['Time Lords']);
  });

  it('resolves a name in any case, number or apostrophe', () => {
    expect(resolveCreatureType('Elves')).toBe('Elf');
    expect(resolveCreatureType('elf')).toBe('Elf');
    expect(resolveCreatureType('MICE')).toBe('Mouse');
    expect(resolveCreatureType('Pegasi')).toBe('Pegasus');
    expect(resolveCreatureType("C'tan")).toBe('C’tan');
    expect(resolveCreatureType('time lords')).toBe('Time Lord');
    expect(resolveCreatureType('Legends')).toBeUndefined();
    expect(resolveCreatureType('Spacecraft')).toBeUndefined();
  });
});

describe('typal payoffs and finders (E511)', () => {
  it('reads lords, counts, triggers and cost reducers for a named tribe', () => {
    // Real Oracle text: Elvish Archdruid, Priest of Titania, Spellstutter
    // Sprite, Dragonspeaker Shaman.
    expect(typalPayoffType(oracle('Other Elf creatures you control get +1/+1.'))).toBe('Elf');
    expect(typalPayoffType(oracle('{T}: Add {G} for each Elf on the battlefield.'))).toBe('Elf');
    expect(
      typalPayoffType(
        oracle(
          'When this creature enters, counter target spell with mana value X or less, where X is the number of Faeries you control.'
        )
      )
    ).toBe('Faerie');
    expect(typalPayoffType(oracle('Dragon spells you cast cost {2} less to cast.'))).toBe('Dragon');
  });

  it('never reads a hate piece, a non-Human clause or a card name as a payoff', () => {
    // Real Oracle text: Mikaeus, the Unhallowed; Seven Dwarves; Whelming Wave.
    expect(
      typalPayoffType(
        oracle(
          'Whenever a Human deals damage to you, destroy it.\nOther non-Human creatures you control get +1/+1 and have undying.'
        )
      )
    ).toBeUndefined();
    expect(
      typalPayoffType(
        oracle('This creature gets +1/+1 for each other creature named Seven Dwarves you control.')
      )
    ).toBeUndefined();
    expect(
      typalPayoffType(
        oracle(
          "Return all creatures to their owners' hands except for Krakens, Leviathans, Octopuses, and Serpents."
        )
      )
    ).toBeUndefined();
  });

  it('reads a tutor or recursion for a named tribe as a finder', () => {
    // Real Oracle text: Goblin Matron, Lord of the Undead.
    expect(
      typalFinderType(
        oracle(
          'When this creature enters, you may search your library for a Goblin card, reveal that card, put it into your hand, then shuffle.'
        )
      )
    ).toBe('Goblin');
    expect(
      typalFinderType(
        oracle('{1}{B}, {T}: Return target Zombie card from your graveyard to your hand.')
      )
    ).toBe('Zombie');
    expect(
      typalFinderType(
        oracle('Search your library for a creature card, reveal it, put it into your hand.')
      )
    ).toBeUndefined();
  });
});
