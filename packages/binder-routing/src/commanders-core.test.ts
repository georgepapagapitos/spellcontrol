import { describe, it, expect } from 'vitest';
import {
  canBeCommanderByType,
  isCommanderEligibleFrom,
  isCommanderEligible,
} from './commanders-core.js';
import type { EnrichedCard } from './types.js';

describe('isCommanderEligibleFrom', () => {
  it('accepts a commander-legal legendary creature', () => {
    expect(isCommanderEligibleFrom('Legendary Creature — Elf', '', 'legal')).toBe(true);
  });

  it('accepts a planeswalker whose text says "can be your commander"', () => {
    expect(
      isCommanderEligibleFrom(
        'Legendary Planeswalker — Daretti',
        'Daretti can be your commander.',
        'legal'
      )
    ).toBe(true);
  });

  it('accepts restricted as eligible', () => {
    expect(isCommanderEligibleFrom('Legendary Creature — God', '', 'restricted')).toBe(true);
  });

  it('rejects a legendary creature banned in commander', () => {
    expect(isCommanderEligibleFrom('Legendary Creature — Human', '', 'banned')).toBe(false);
  });

  it('rejects a legendary creature with no commander legality', () => {
    expect(isCommanderEligibleFrom('Legendary Creature — Human', '', undefined)).toBe(false);
  });

  it('rejects a non-legendary card with no commander clause', () => {
    expect(isCommanderEligibleFrom('Creature — Beast', 'flying', 'legal')).toBe(false);
  });

  it('is case-insensitive on type and text', () => {
    expect(isCommanderEligibleFrom('LEGENDARY CREATURE — DRAGON', '', 'legal')).toBe(true);
    expect(isCommanderEligibleFrom('planeswalker', 'X CAN BE YOUR COMMANDER.', 'legal')).toBe(true);
  });
});

describe('isCommanderEligible (EnrichedCard)', () => {
  function ec(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
    return {
      copyId: 'c1',
      name: 'Test',
      setCode: 'tst',
      setName: 'Test',
      collectorNumber: '1',
      rarity: 'mythic',
      scryfallId: 'sf1',
      purchasePrice: 0,
      sourceCategory: '',
      sourceFormat: 'plain',
      finish: 'nonfoil',
      foil: false,
      typeLine: 'Legendary Creature — Human',
      oracleText: '',
      legalities: { commander: 'legal' },
      ...overrides,
    } as EnrichedCard;
  }

  it('accepts a commander-legal legendary creature', () => {
    expect(isCommanderEligible(ec())).toBe(true);
  });

  it('accepts a planeswalker-commander via oracle text', () => {
    expect(
      isCommanderEligible(
        ec({
          typeLine: 'Legendary Planeswalker — Teferi',
          oracleText: 'teferi can be your commander.',
        })
      )
    ).toBe(true);
  });

  it('rejects a banned legend', () => {
    expect(isCommanderEligible(ec({ legalities: { commander: 'banned' } }))).toBe(false);
  });

  it('rejects a vanilla creature', () => {
    expect(isCommanderEligible(ec({ typeLine: 'Creature — Bear', oracleText: '' }))).toBe(false);
  });

  it('rejects when type/oracle/legality are missing', () => {
    expect(
      isCommanderEligible(ec({ typeLine: undefined, oracleText: undefined, legalities: undefined }))
    ).toBe(false);
  });

  it('reads the front face: a land whose back face is a legendary creature is no commander', () => {
    // Westvale Abbey // Ormendahl, Profane Prince, as the binder path stores it.
    expect(
      isCommanderEligible(
        ec({
          typeLine: 'Land // Legendary Creature — Demon',
          oracleText:
            '{t}: add {c}.\n{5}, {t}, pay 1 life: create a 1/1 white and black human cleric creature token.\n{5}, {t}, sacrifice five creatures: transform this land, then untap it.\nflying, lifelink, indestructible, haste',
        })
      )
    ).toBe(false);
  });
});

// CR 903.3 (the rules snapshot, 2026): a legendary creature, Vehicle, or
// Spacecraft with a power/toughness box, or "can be your commander". Real
// Scryfall type lines; oracle text quoted from the real cards (the Spacecraft
// in full, the rest trimmed to lines that don't bear on the rule).
describe('canBeCommanderByType', () => {
  const STATION_PT =
    "Whenever one or more charge counters are put on U.S.S. Enterprise-D for the first time each turn, exile the top card of your library. You may play that card this turn.\nStation (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 7+.)\n7+ | Flying, vigilance";
  const STATION_NO_PT =
    '{T}: Add {C}{C}{C}.\nStation (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery.)\n20+ | {T}: Add X mana of any one color, where X is the number of charge counters on The Eternity Elevator.';

  it('accepts a legendary Vehicle (Weatherlight)', () => {
    expect(canBeCommanderByType('Legendary Artifact — Vehicle', 'Flying\nCrew 3')).toBe(true);
  });

  it('accepts a Spacecraft with a power/toughness box, from its text or its power', () => {
    expect(canBeCommanderByType('Legendary Artifact — Spacecraft', STATION_PT)).toBe(true);
    expect(canBeCommanderByType('Legendary Artifact — Spacecraft', '', { power: '5' })).toBe(true);
  });

  it('rejects a Spacecraft with none (The Eternity Elevator)', () => {
    expect(canBeCommanderByType('Legendary Artifact — Spacecraft', STATION_NO_PT)).toBe(false);
  });

  it('accepts Grist, a creature card everywhere but the battlefield', () => {
    expect(
      canBeCommanderByType(
        'Legendary Planeswalker — Grist',
        "As long as Grist isn't on the battlefield, it's a 1/1 Insect creature in addition to its other types."
      )
    ).toBe(true);
  });

  it('takes any legendary planeswalker in Brawl only', () => {
    const liliana = 'Whenever a creature you control dies, draw a card.';
    expect(canBeCommanderByType('Legendary Planeswalker — Liliana', liliana)).toBe(false);
    expect(
      canBeCommanderByType('Legendary Planeswalker — Liliana', liliana, { format: 'brawl' })
    ).toBe(true);
  });

  it('rejects a non-legendary Vehicle', () => {
    expect(canBeCommanderByType('Artifact — Vehicle', 'Crew 1')).toBe(false);
  });
});
