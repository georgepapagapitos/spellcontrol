/**
 * Real Scryfall data (name, cost, type line, oracle text) for the "Since" tests.
 * Not author-written approximations: copied from the cards as printed.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck } from '@/store/decks';

type Real = Pick<ScryfallCard, 'name' | 'mana_cost' | 'cmc' | 'type_line' | 'oracle_text'> &
  Partial<ScryfallCard>;

const REAL: Record<string, Real> = {
  'Sol Ring': {
    name: 'Sol Ring',
    mana_cost: '{1}',
    cmc: 1,
    type_line: 'Artifact',
    oracle_text: '{T}: Add {C}{C}.',
    colors: [],
    color_identity: [],
  },
  'Command Tower': {
    name: 'Command Tower',
    mana_cost: '',
    cmc: 0,
    type_line: 'Land',
    oracle_text: "{T}: Add one mana of any color in your commander's color identity.",
    colors: [],
    color_identity: [],
  },
  Forest: {
    name: 'Forest',
    mana_cost: '',
    cmc: 0,
    type_line: 'Basic Land — Forest',
    oracle_text: '({T}: Add {G}.)',
    colors: [],
    color_identity: ['G'],
  },
  Cultivate: {
    name: 'Cultivate',
    mana_cost: '{2}{G}',
    cmc: 3,
    type_line: 'Sorcery',
    oracle_text:
      'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
    colors: ['G'],
    color_identity: ['G'],
  },
  'Swords to Plowshares': {
    name: 'Swords to Plowshares',
    mana_cost: '{W}',
    cmc: 1,
    type_line: 'Instant',
    oracle_text: 'Exile target creature. Its controller gains life equal to its power.',
    colors: ['W'],
    color_identity: ['W'],
  },
  'Rhystic Study': {
    name: 'Rhystic Study',
    mana_cost: '{2}{U}',
    cmc: 3,
    type_line: 'Enchantment',
    oracle_text:
      'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
    colors: ['U'],
    color_identity: ['U'],
  },
  'Atraxa, Praetors’ Voice': {
    name: 'Atraxa, Praetors’ Voice',
    mana_cost: '{G}{W}{U}{B}',
    cmc: 4,
    type_line: 'Legendary Creature — Phyrexian Angel Horror',
    oracle_text:
      'Flying, vigilance, deathtouch, lifelink\nAt the beginning of your end step, proliferate.',
    colors: ['W', 'U', 'B', 'G'],
    color_identity: ['W', 'U', 'B', 'G'],
  },
};

export const realCard = (name: string): ScryfallCard => {
  const r = REAL[name];
  if (!r) throw new Error(`no fixture for ${name}`);
  return {
    id: `sf-${name}`,
    oracle_id: `oid-${name}`,
    rarity: 'rare',
    set: 'cmd',
    set_name: 'Commander',
    collector_number: '1',
    image_uris: { normal: 'https://example.com/img.jpg' },
    legalities: { commander: 'legal' },
    layout: 'normal',
    ...r,
  } as ScryfallCard;
};

let slot = 0;
export function makeDeck(names: string[], commander?: string, overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-since',
    name: 'Since',
    format: 'commander',
    source: 'manual',
    commander: commander ? realCard(commander) : null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: names.map((n) => ({
      slotId: `slot-${slot++}`,
      card: realCard(n),
      allocatedCopyId: null,
    })),
    sideboard: [],
    generationContext: null,
    color: '#888888',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Deck;
}
