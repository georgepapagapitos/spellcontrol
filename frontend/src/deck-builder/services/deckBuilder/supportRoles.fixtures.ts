/**
 * Real Scryfall oracle text (oracle_cards bulk, 2026-10-24), copied verbatim,
 * not author-written. Keyed by card name.
 */
export const REAL: Record<string, { name: string; oracle_text: string; type_line: string }> = {
  'Bojuka Bog': {
    name: 'Bojuka Bog',
    oracle_text:
      "This land enters tapped.\nWhen this land enters, exile target player's graveyard.\n{T}: Add {B}.",
    type_line: 'Land',
  },
  'Rest in Peace': {
    name: 'Rest in Peace',
    oracle_text:
      'When this enchantment enters, exile all graveyards.\nIf a card or token would be put into a graveyard from anywhere, exile it instead.',
    type_line: 'Enchantment',
  },
  Gravecrawler: {
    name: 'Gravecrawler',
    oracle_text:
      "This creature can't block.\nYou may cast this card from your graveyard as long as you control a Zombie.",
    type_line: 'Creature — Zombie',
  },
  Gravebind: {
    name: 'Gravebind',
    oracle_text:
      "Target creature can't be regenerated this turn.\nDraw a card at the beginning of the next turn's upkeep.",
    type_line: 'Instant',
  },
  "Teferi's Protection": {
    name: "Teferi's Protection",
    oracle_text:
      "Until your next turn, your life total can't change and you gain protection from everything. All permanents you control phase out. (While they're phased out, they're treated as though they don't exist. They phase in before you untap during your untap step.)\nExile Teferi's Protection.",
    type_line: 'Instant',
  },
  'Aurelia, the Warleader': {
    name: 'Aurelia, the Warleader',
    oracle_text:
      'Flying, vigilance, haste\nWhenever Aurelia attacks for the first time each turn, untap all creatures you control. After this phase, there is an additional combat phase.',
    type_line: 'Legendary Creature — Angel',
  },
  'Thrun, the Last Troll': {
    name: 'Thrun, the Last Troll',
    oracle_text:
      "This spell can't be countered.\nHexproof (This creature can't be the target of spells or abilities your opponents control.)\n{1}{G}: Regenerate Thrun.",
    type_line: 'Legendary Creature — Troll Shaman',
  },
  "Tormod's Crypt": {
    name: "Tormod's Crypt",
    oracle_text: "{T}, Sacrifice this artifact: Exile target player's graveyard.",
    type_line: 'Artifact',
  },
  'Sorcerer Class': {
    name: 'Sorcerer Class',
    oracle_text:
      '(Gain the next level as a sorcery to add its ability.)\nWhen this Class enters, draw two cards, then discard two cards.\n{U}{R}: Level 2\nCreatures you control have "{T}: Add {U} or {R}. Spend this mana only to cast an instant or sorcery spell or to gain a Class level."\n{3}{U}{R}: Level 3\nWhenever you cast an instant or sorcery spell, that spell deals damage to each opponent equal to the number of instant and sorcery spells you\'ve cast this turn.',
    type_line: 'Enchantment — Class',
  },
  "Thassa's Oracle": {
    name: "Thassa's Oracle",
    oracle_text:
      'When this creature enters, look at the top X cards of your library, where X is your devotion to blue. Put up to one of them on top of your library and the rest on the bottom of your library in a random order. If X is greater than or equal to the number of cards in your library, you win the game. (Each {U} in the mana costs of permanents you control counts toward your devotion to blue.)',
    type_line: 'Creature — Merfolk Wizard',
  },
  'Scavenging Ooze': {
    name: 'Scavenging Ooze',
    oracle_text:
      '{G}: Exile target card from a graveyard. If it was a creature card, put a +1/+1 counter on this creature and you gain 1 life.',
    type_line: 'Creature — Ooze',
  },
  Victimize: {
    name: 'Victimize',
    oracle_text:
      'Choose two target creature cards in your graveyard. Sacrifice a creature. If you do, return the chosen cards to the battlefield tapped.',
    type_line: 'Sorcery',
  },
  'Heroic Intervention': {
    name: 'Heroic Intervention',
    oracle_text: 'Permanents you control gain hexproof and indestructible until end of turn.',
    type_line: 'Instant',
  },
  'Eternal Witness': {
    name: 'Eternal Witness',
    oracle_text:
      'When this creature enters, you may return target card from your graveyard to your hand.',
    type_line: 'Creature — Human Shaman',
  },
  'Gray Merchant of Asphodel': {
    name: 'Gray Merchant of Asphodel',
    oracle_text:
      'When this creature enters, each opponent loses X life, where X is your devotion to black. You gain life equal to the life lost this way. (Each {B} in the mana costs of permanents you control counts toward your devotion to black.)',
    type_line: 'Creature — Zombie',
  },
  'Sol Ring': {
    name: 'Sol Ring',
    oracle_text: '{T}: Add {C}{C}.',
    type_line: 'Artifact',
  },
  'Steel Hellkite': {
    name: 'Steel Hellkite',
    oracle_text:
      'Flying\n{2}: This creature gets +1/+0 until end of turn.\n{X}: Destroy each nonland permanent with mana value X whose controller was dealt combat damage by this creature this turn. Activate only once each turn.',
    type_line: 'Artifact Creature — Dragon',
  },
  'Beast Within': {
    name: 'Beast Within',
    oracle_text:
      'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.',
    type_line: 'Instant',
  },
  'Murktide Regent': {
    name: 'Murktide Regent',
    oracle_text:
      'Delve (Each card you exile from your graveyard while casting this spell pays for {1}.)\nFlying\nThis creature enters with a +1/+1 counter on it for each instant and sorcery card exiled with it.\nWhenever an instant or sorcery card leaves your graveyard, put a +1/+1 counter on this creature.',
    type_line: 'Creature — Dragon',
  },
  Exsanguinate: {
    name: 'Exsanguinate',
    oracle_text: 'Each opponent loses X life. You gain life equal to the life lost this way.',
    type_line: 'Sorcery',
  },
  'Demonic Tutor': {
    name: 'Demonic Tutor',
    oracle_text: 'Search your library for a card, put that card into your hand, then shuffle.',
    type_line: 'Sorcery',
  },
  'Rampant Growth': {
    name: 'Rampant Growth',
    oracle_text:
      'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
    type_line: 'Sorcery',
  },
  'Dread Wanderer': {
    name: 'Dread Wanderer',
    oracle_text:
      'This creature enters tapped.\n{2}{B}: Return this card from your graveyard to the battlefield. Activate only as a sorcery and only if you have one or fewer cards in hand.',
    type_line: 'Creature — Zombie Jackal',
  },
  'Nessian Asp': {
    name: 'Nessian Asp',
    oracle_text:
      "Reach\n{6}{G}: Monstrosity 4. (If this creature isn't monstrous, put four +1/+1 counters on it and it becomes monstrous.)",
    type_line: 'Creature — Snake',
  },
  Cultivate: {
    name: 'Cultivate',
    oracle_text:
      'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
    type_line: 'Sorcery',
  },
  'Craterhoof Behemoth': {
    name: 'Craterhoof Behemoth',
    oracle_text:
      'Haste\nWhen this creature enters, creatures you control gain trample and get +X/+X until end of turn, where X is the number of creatures you control.',
    type_line: 'Creature — Beast',
  },
  'Final Fortune': {
    name: 'Final Fortune',
    oracle_text:
      "Take an extra turn after this one. At the beginning of that turn's end step, you lose the game.",
    type_line: 'Instant',
  },
  "Rishkar's Expertise": {
    name: "Rishkar's Expertise",
    oracle_text:
      'Draw cards equal to the greatest power among creatures you control.\nYou may cast a spell with mana value 5 or less from your hand without paying its mana cost.',
    type_line: 'Sorcery',
  },
  Reanimate: {
    name: 'Reanimate',
    oracle_text:
      "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to that card's mana value.",
    type_line: 'Sorcery',
  },
  'Evolving Wilds': {
    name: 'Evolving Wilds',
    oracle_text:
      '{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
    type_line: 'Land',
  },
  'Swords to Plowshares': {
    name: 'Swords to Plowshares',
    oracle_text: 'Exile target creature. Its controller gains life equal to its power.',
    type_line: 'Instant',
  },
  'Animate Dead': {
    name: 'Animate Dead',
    oracle_text:
      'Enchant creature card in a graveyard\nWhen this Aura enters, if it\'s on the battlefield, it loses "enchant creature card in a graveyard" and gains "enchant creature put onto the battlefield with this Aura." Return enchanted creature card to the battlefield under your control and attach this Aura to it. When this Aura leaves the battlefield, that creature\'s controller sacrifices it.\nEnchanted creature gets -1/-0.',
    type_line: 'Enchantment — Aura',
  },
  'Swiftfoot Boots': {
    name: 'Swiftfoot Boots',
    oracle_text:
      "Equipped creature has hexproof and haste. (It can't be the target of spells or abilities your opponents control. It can attack and {T} no matter when it came under your control.)\nEquip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)",
    type_line: 'Artifact — Equipment',
  },
  'Lightning Greaves': {
    name: 'Lightning Greaves',
    oracle_text:
      "Equipped creature has haste and shroud. (It can't be the target of spells or abilities.)\nEquip {0}",
    type_line: 'Artifact — Equipment',
  },
  'Spider Spawning': {
    name: 'Spider Spawning',
    oracle_text:
      'Create a 1/2 green Spider creature token with reach for each creature card in your graveyard.\nFlashback {6}{B} (You may cast this card from your graveyard for its flashback cost. Then exile it.)',
    type_line: 'Sorcery',
  },
  Pestilence: {
    name: 'Pestilence',
    oracle_text:
      'At the beginning of the end step, if no creatures are on the battlefield, sacrifice this enchantment.\n{B}: This enchantment deals 1 damage to each creature and each player.',
    type_line: 'Enchantment',
  },
  'Sakura-Tribe Elder': {
    name: 'Sakura-Tribe Elder',
    oracle_text:
      'Sacrifice this creature: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
    type_line: 'Creature — Snake Shaman',
  },
  'Worldly Tutor': {
    name: 'Worldly Tutor',
    oracle_text:
      'Search your library for a creature card, reveal it, then shuffle and put the card on top.',
    type_line: 'Instant',
  },
  'Burn Bright': {
    name: 'Burn Bright',
    oracle_text: 'Creatures you control get +2/+0 until end of turn.',
    type_line: 'Instant',
  },
  'Vampiric Tutor': {
    name: 'Vampiric Tutor',
    oracle_text:
      'Search your library for a card, then shuffle and put that card on top. You lose 2 life.',
    type_line: 'Instant',
  },
  'Thrashing Wumpus': {
    name: 'Thrashing Wumpus',
    oracle_text: '{B}: This creature deals 1 damage to each creature and each player.',
    type_line: 'Creature — Beast',
  },
};
