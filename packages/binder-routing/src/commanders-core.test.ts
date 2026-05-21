import { describe, it, expect } from 'vitest';
import { isCommanderEligibleFrom, isCommanderEligible } from './commanders-core.js';
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
});
