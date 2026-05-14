import { describe, it, expect } from 'vitest';
import { isValidCommander } from './commanders';
import type { ScryfallCard } from '../deck-builder/types';

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
    expect(isValidCommander(card({ legalities: {} }))).toBe(false);
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
