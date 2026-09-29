/**
 * Real cards (Scryfall oracle_cards, 2026-09-29) for unit tests that the gold
 * sets don't already carry. Text copied verbatim; no labels here.
 */
import type { FactsInputCard } from './schema';

export const TEST_CARDS: Record<string, FactsInputCard> = {
  'Dictate of Erebos': {
    oracle_id: '7c777a41-e40a-4b40-96bf-8ddd5c12924c',
    name: 'Dictate of Erebos',
    layout: 'normal',
    type_line: 'Enchantment',
    mana_cost: '{3}{B}{B}',
    oracle_text:
      'Flash\nWhenever a creature you control dies, each opponent sacrifices a creature of their choice.',
    keywords: ['Flash'],
    cmc: 5,
  },
  'Butcher of Malakir': {
    oracle_id: 'a85197ab-dc94-4b72-9716-8dbdbbe90ff8',
    name: 'Butcher of Malakir',
    layout: 'normal',
    type_line: 'Creature — Vampire Warrior',
    mana_cost: '{5}{B}{B}',
    oracle_text:
      'Flying\nWhenever this creature or another creature you control dies, each opponent sacrifices a creature of their choice.',
    keywords: ['Flying'],
    power: '5',
    toughness: '4',
    cmc: 7,
  },
  'Savra, Queen of the Golgari': {
    oracle_id: '641db975-cf94-44c6-a391-f540a952e0d8',
    name: 'Savra, Queen of the Golgari',
    layout: 'normal',
    type_line: 'Legendary Creature — Elf Shaman',
    mana_cost: '{2}{B}{G}',
    oracle_text:
      'Whenever you sacrifice a black creature, you may pay 2 life. If you do, each other player sacrifices a creature of their choice.\nWhenever you sacrifice a green creature, you may gain 2 life.',
    keywords: [],
    power: '2',
    toughness: '2',
    cmc: 4,
  },
  'Falkenrath Noble': {
    oracle_id: '3739b179-bc81-4737-8376-66a57e16b942',
    name: 'Falkenrath Noble',
    layout: 'normal',
    type_line: 'Creature — Vampire Noble',
    mana_cost: '{3}{B}',
    oracle_text:
      'Flying\nWhenever this creature or another creature dies, target player loses 1 life and you gain 1 life.',
    keywords: ['Flying'],
    power: '2',
    toughness: '2',
    cmc: 4,
  },
  'Day of Judgment': {
    oracle_id: 'd057289d-5e28-43d5-8ff3-4a1bc723477d',
    name: 'Day of Judgment',
    layout: 'normal',
    type_line: 'Sorcery',
    mana_cost: '{2}{W}{W}',
    oracle_text: 'Destroy all creatures.',
    keywords: [],
    cmc: 4,
  },
};
