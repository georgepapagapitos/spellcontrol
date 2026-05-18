import { describe, it, expect } from 'vitest';
import { isValidCommander, isCommanderEligibleFrom, isCommanderEligible } from './commanders';
import type { ScryfallCard } from '../deck-builder/types';
import type { EnrichedCard } from '../types';

function card(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'sf-1',
    oracle_id: 'oid-1',
    name: 'Test Card',
    cmc: 1,
    type_line: 'Legendary Creature — Human',
    oracle_text: '',
    color_identity: [],
    keywords: [],
    rarity: 'mythic',
    set: 'tst',
    set_name: 'Test',
    legalities: { commander: 'legal' },
    prices: {},
    ...overrides,
  } as ScryfallCard;
}

describe('isValidCommander', () => {
  it('accepts a legendary creature that is commander-legal', () => {
    expect(isValidCommander(card())).toBe(true);
  });

  it('accepts a non-legendary card whose text says "can be your commander"', () => {
    expect(
      isValidCommander(
        card({
          type_line: 'Planeswalker — Daretti',
          oracle_text: 'Daretti can be your commander.',
        })
      )
    ).toBe(true);
  });

  it('rejects a non-legendary creature with no commander clause', () => {
    expect(isValidCommander(card({ type_line: 'Creature — Beast', oracle_text: '' }))).toBe(false);
  });

  it('rejects a legendary creature that is banned in commander', () => {
    expect(isValidCommander(card({ legalities: { commander: 'banned' } }))).toBe(false);
  });

  it('rejects a legendary creature with no commander legality entry', () => {
    // Cast: the type insists on a `commander` key, but we want to exercise
    // the "missing key" branch which can happen with non-Scryfall data.
    expect(isValidCommander(card({ legalities: {} as ScryfallCard['legalities'] }))).toBe(false);
  });

  it('accepts restricted as a legal commander status', () => {
    expect(isValidCommander(card({ legalities: { commander: 'restricted' } }))).toBe(true);
  });

  it('falls back to card_faces type_line / oracle_text when top-level missing', () => {
    const c = card({
      type_line: undefined,
      oracle_text: undefined,
      card_faces: [
        { type_line: 'Legendary Creature — God', oracle_text: '' },
        { type_line: 'Legendary Land', oracle_text: '' },
      ] as ScryfallCard['card_faces'],
    });
    expect(isValidCommander(c)).toBe(true);
  });
});

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
});
