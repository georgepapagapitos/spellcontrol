import type { ScryfallCard } from './types';

/**
 * Real Scryfall card JSON (trimmed to the fields the app reads), copied from a
 * bulk-ingested cache. Multi-face layouts keep their rules text per face, so
 * top-level oracle_text is absent on all of these. Do not hand-write oracle text.
 */
export const DELVER_TRANSFORM: ScryfallCard = {
  id: '11bf83bb-c95b-4b4f-9a56-ce7a1816307a',
  oracle_id: 'edd531b9-f615-4399-8c8c-1c5e18c4acbf',
  name: 'Delver of Secrets // Insectile Aberration',
  layout: 'transform',
  rarity: 'common',
  set: 'isd',
  set_name: 'Innistrad',
  collector_number: '51',
  type_line: 'Creature — Human Wizard // Creature — Human Insect',
  card_faces: [
    {
      name: 'Delver of Secrets',
      mana_cost: '{U}',
      type_line: 'Creature — Human Wizard',
      oracle_text:
        'At the beginning of your upkeep, look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform this creature.',
    },
    {
      name: 'Insectile Aberration',
      mana_cost: '',
      type_line: 'Creature — Human Insect',
      oracle_text: 'Flying',
    },
  ],
};

export const AGADEEM_MDFC: ScryfallCard = {
  id: '499c2b20-e83e-40ff-919e-1d134ad50c0a',
  oracle_id: '562d71b9-1646-474e-9293-55da6947a758',
  name: "Agadeem's Awakening // Agadeem, the Undercrypt",
  layout: 'modal_dfc',
  rarity: 'mythic',
  set: 'znr',
  set_name: 'Zendikar Rising',
  collector_number: '336',
  type_line: 'Sorcery // Land',
  card_faces: [
    {
      name: "Agadeem's Awakening",
      mana_cost: '{X}{B}{B}{B}',
      type_line: 'Sorcery',
      oracle_text:
        'Return from your graveyard to the battlefield any number of target creature cards that each have a different mana value X or less.',
    },
    {
      name: 'Agadeem, the Undercrypt',
      mana_cost: '',
      type_line: 'Land',
      oracle_text:
        "As this land enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {B}.",
    },
  ],
};

export const BONECRUSHER_ADVENTURE: ScryfallCard = {
  id: '09fd2d9c-1793-4beb-a3fb-7a869f660cd4',
  oracle_id: 'd6d72f5f-8f5d-4180-b514-f22ff5482902',
  name: 'Bonecrusher Giant // Stomp',
  layout: 'adventure',
  rarity: 'rare',
  set: 'eld',
  set_name: 'Throne of Eldraine',
  collector_number: '115',
  mana_cost: '{2}{R} // {1}{R}',
  type_line: 'Creature — Giant // Instant — Adventure',
  card_faces: [
    {
      name: 'Bonecrusher Giant',
      mana_cost: '{2}{R}',
      type_line: 'Creature — Giant',
      oracle_text:
        "Whenever this creature becomes the target of a spell, this creature deals 2 damage to that spell's controller.",
    },
    {
      name: 'Stomp',
      mana_cost: '{1}{R}',
      type_line: 'Instant — Adventure',
      oracle_text: "Damage can't be prevented this turn. Stomp deals 2 damage to any target.",
    },
  ],
};

export const FIRE_ICE_SPLIT: ScryfallCard = {
  id: '04cb4e4e-8275-4132-8f1a-84b486725400',
  oracle_id: 'ae92942b-919c-4ea9-b693-85fcef765d5a',
  name: 'Fire // Ice',
  layout: 'split',
  rarity: 'rare',
  set: 'f06',
  set_name: 'Friday Night Magic 2006',
  collector_number: '12a',
  mana_cost: '{1}{R} // {1}{U}',
  type_line: 'Instant // Instant',
  card_faces: [
    {
      name: 'Fire',
      mana_cost: '{1}{R}',
      type_line: 'Instant',
      oracle_text: 'Fire deals 2 damage divided as you choose among one or two targets.',
    },
    {
      name: 'Ice',
      mana_cost: '{1}{U}',
      type_line: 'Instant',
      oracle_text: 'Tap target permanent.\nDraw a card.',
    },
  ],
};
