import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { isUnsupportedSynergyPayoff, typeLineProducerAxes } from './synergyDependency';

function card(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'id',
    oracle_id: 'oracle',
    name: 'Card',
    cmc: 3,
    type_line: 'Enchantment',
    oracle_text: '',
    color_identity: [],
    keywords: [],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

const tevalsJudgment = card({
  name: "Teval's Judgment",
  oracle_text:
    "Whenever one or more cards leave your graveyard, choose one that hasn't been chosen this turn —\n• Draw a card.\n• Create a Treasure token.\n• Create a 2/2 black Zombie Druid creature token.",
});

describe('isUnsupportedSynergyPayoff', () => {
  it('rejects graveyard-leave payoffs when the commander/deck has no enabler', () => {
    const marchesa = card({
      name: 'Queen Marchesa',
      type_line: 'Legendary Creature — Human Assassin',
      oracle_text:
        'Deathtouch, haste\nWhen Queen Marchesa enters, you become the monarch.\nAt the beginning of your upkeep, if an opponent is the monarch, create a 1/1 black Assassin creature token with deathtouch and haste.',
    });

    expect(isUnsupportedSynergyPayoff(tevalsJudgment, [marchesa])).toBe(true);
  });

  it('allows graveyard-leave payoffs when the commander enables the trigger', () => {
    const teval = card({
      name: 'Teval, the Balanced Scale',
      type_line: 'Legendary Creature — Spirit Dragon',
      oracle_text:
        'Flying\nWhenever Teval attacks, mill three cards. Then you may return a land card from your graveyard to the battlefield tapped.\nWhenever one or more cards leave your graveyard, create a 2/2 black Zombie Druid creature token.',
    });

    expect(isUnsupportedSynergyPayoff(tevalsJudgment, [teval])).toBe(false);
  });

  it('does not treat incidental graveyard hate as real support', () => {
    const marchesa = card({
      name: 'Queen Marchesa',
      type_line: 'Legendary Creature — Human Assassin',
      oracle_text:
        'Deathtouch, haste\nWhen Queen Marchesa enters, you become the monarch.\nAt the beginning of your upkeep, if an opponent is the monarch, create a 1/1 black Assassin creature token with deathtouch and haste.',
    });
    const bojukaBog = card({
      name: 'Bojuka Bog',
      type_line: 'Land',
      oracle_text:
        "Bojuka Bog enters tapped.\nWhen Bojuka Bog enters, exile target player's graveyard.",
      cmc: 0,
    });
    const rakdosCharm = card({
      name: 'Rakdos Charm',
      type_line: 'Instant',
      oracle_text:
        "Choose one —\n• Exile target player's graveyard.\n• Destroy target artifact.\n• Each creature deals 1 damage to its controller.",
      cmc: 2,
    });
    const farewell = card({
      name: 'Farewell',
      type_line: 'Sorcery',
      oracle_text:
        'Choose one or more —\n• Exile all artifacts.\n• Exile all creatures.\n• Exile all enchantments.\n• Exile all graveyards.',
      cmc: 6,
    });

    expect(
      isUnsupportedSynergyPayoff(tevalsJudgment, [marchesa, bojukaBog, rakdosCharm, farewell])
    ).toBe(true);
  });

  it('allows payoffs when multiple credible noncommander enablers support the engine', () => {
    const marchesa = card({
      name: 'Queen Marchesa',
      type_line: 'Legendary Creature — Human Assassin',
      oracle_text:
        'Deathtouch, haste\nWhen Queen Marchesa enters, you become the monarch.\nAt the beginning of your upkeep, if an opponent is the monarch, create a 1/1 black Assassin creature token with deathtouch and haste.',
    });
    const underworldBreach = card({
      name: 'Underworld Breach',
      oracle_text:
        "Each nonland card in your graveyard has escape. The escape cost is equal to the card's mana cost plus exile three other cards from your graveyard.",
      keywords: ['Escape'],
      cmc: 2,
    });
    const crucible = card({
      name: 'Crucible of Worlds',
      type_line: 'Artifact',
      oracle_text: 'You may play lands from your graveyard.',
      cmc: 3,
    });

    expect(isUnsupportedSynergyPayoff(tevalsJudgment, [marchesa, underworldBreach, crucible])).toBe(
      false
    );
  });

  it('applies the same dependency rule to other engine payoffs', () => {
    const payoff = card({
      name: 'Lifegain Payoff',
      oracle_text: 'Whenever you gain life, draw a card.',
    });
    const producer = card({
      name: 'Soul Warden',
      type_line: 'Creature — Human Cleric',
      oracle_text: 'Whenever another creature enters, you gain 1 life.',
    });
    const secondProducer = card({
      name: 'Lunarch Veteran',
      type_line: 'Creature — Human Cleric',
      oracle_text: 'Whenever another creature enters under your control, you gain 1 life.',
    });
    const marchesa = card({
      name: 'Queen Marchesa',
      type_line: 'Legendary Creature — Human Assassin',
      oracle_text:
        'Deathtouch, haste\nWhen Queen Marchesa enters, you become the monarch.\nAt the beginning of your upkeep, if an opponent is the monarch, create a 1/1 black Assassin creature token with deathtouch and haste.',
    });

    expect(isUnsupportedSynergyPayoff(payoff, [])).toBe(true);
    expect(isUnsupportedSynergyPayoff(payoff, [marchesa, producer])).toBe(true);
    expect(isUnsupportedSynergyPayoff(payoff, [marchesa, producer, secondProducer])).toBe(false);
  });
});

describe('typeLineProducerAxes (E135)', () => {
  it('reads a plain artifact (mana rock) as an artifacts producer only', () => {
    const solRing = card({
      name: 'Sol Ring',
      type_line: 'Artifact',
      cmc: 1,
      oracle_text: '{T}: Add {C}{C}.',
    });
    expect(typeLineProducerAxes(solRing)).toEqual(['artifacts']);
  });

  it('reads Equipment as both the broad artifacts axis and its own narrower one', () => {
    const bonesplitter = card({
      name: 'Bonesplitter',
      type_line: 'Artifact — Equipment',
      cmc: 1,
      oracle_text: 'Equipped creature gets +2/+0.\nEquip {1}',
    });
    expect(typeLineProducerAxes(bonesplitter)).toEqual(['artifacts', 'equipment']);
  });

  it('reads a Vehicle as both the broad artifacts axis and its own narrower one', () => {
    const copter = card({
      name: "Smuggler's Copter",
      type_line: 'Artifact — Vehicle',
      cmc: 2,
      oracle_text: 'Flying\nCrew 1',
    });
    expect(typeLineProducerAxes(copter)).toEqual(['artifacts', 'vehicles']);
  });

  it('reads nothing off a plain creature', () => {
    const bear = card({ name: 'Grizzly Bears', type_line: 'Creature — Bear' });
    expect(typeLineProducerAxes(bear)).toEqual([]);
  });
});

describe('isUnsupportedSynergyPayoff — E135 type-line density support', () => {
  // Real mana rocks: none of their oracle text matches axes.ts's TEXT-based
  // `artifacts` producer predicate (no token-making language) — before the
  // fix, a rock-heavy deck registered zero artifacts-axis support.
  const solRing = card({
    name: 'Sol Ring',
    type_line: 'Artifact',
    cmc: 1,
    oracle_text: '{T}: Add {C}{C}.',
  });
  const mindStone = card({
    name: 'Mind Stone',
    type_line: 'Artifact',
    cmc: 2,
    oracle_text: '{T}: Add {C}.\n{1}, {T}, Sacrifice Mind Stone: Draw a card.',
  });
  const arcaneSignet = card({
    name: 'Arcane Signet',
    type_line: 'Artifact',
    cmc: 2,
    oracle_text: "{T}: Add one mana of any color in your commander's color identity.",
  });
  const fellwarStone = card({
    name: 'Fellwar Stone',
    type_line: 'Artifact',
    cmc: 2,
    oracle_text: '{T}: Add one mana of any color that a land an opponent controls could produce.',
  });
  // Equipment already classifies under the narrower `equipment` axis
  // (axes.ts checks type_line directly) — but not `artifacts`, pre-fix.
  const bonesplitter = card({
    name: 'Bonesplitter',
    type_line: 'Artifact — Equipment',
    cmc: 1,
    oracle_text: 'Equipped creature gets +2/+0.\nEquip {1}',
  });
  const lightningGreaves = card({
    name: 'Lightning Greaves',
    type_line: 'Legendary Artifact — Equipment',
    cmc: 2,
    oracle_text: 'Equipped creature has haste and shroud.\nEquip {0}',
  });
  const manaRocksAndEquipment = [
    solRing,
    mindStone,
    arcaneSignet,
    fellwarStone,
    bonesplitter,
    lightningGreaves,
  ];

  // Real metalcraft payoff — already classifies as an `artifacts` PAYOFF via
  // axes.ts's existing keyword/text check (payoff classification is
  // untouched by E135); only the SUPPORT side was broken.
  const etchedChampion = card({
    name: 'Etched Champion',
    type_line: 'Artifact Creature — Golem',
    cmc: 3,
    oracle_text:
      'Metalcraft — Etched Champion has protection from all colors as long as you control three or more artifacts.',
    keywords: ['Metalcraft'],
  });

  it('counts raw artifact permanents (mana rocks + equipment) as artifacts support', () => {
    // No commander in this pool — pure picked-cards density check.
    expect(isUnsupportedSynergyPayoff(etchedChampion, manaRocksAndEquipment, 0)).toBe(false);
  });

  it('a raw Equipment/Vehicle-only pool (no plain artifacts) still supports the artifacts axis', () => {
    const smugglersCopter = card({
      name: "Smuggler's Copter",
      type_line: 'Artifact — Vehicle',
      cmc: 2,
      oracle_text:
        'Flying\nWhenever Smuggler’s Copter attacks or blocks, you may draw a card. If you do, discard a card.\nCrew 1',
    });
    expect(
      isUnsupportedSynergyPayoff(
        etchedChampion,
        [bonesplitter, lightningGreaves, smugglersCopter],
        0
      )
    ).toBe(false);
  });

  it('a creature-only support pool still reads unsupported (no over-counting off type line)', () => {
    const grizzlyBears = card({ name: 'Grizzly Bears', type_line: 'Creature — Bear' });
    const ragingGoblin = card({ name: 'Raging Goblin', type_line: 'Creature — Goblin Berserker' });
    expect(isUnsupportedSynergyPayoff(etchedChampion, [grizzlyBears, ragingGoblin], 0)).toBe(true);
  });

  it('an empty support pool still reads unsupported', () => {
    expect(isUnsupportedSynergyPayoff(etchedChampion, [], 0)).toBe(true);
  });
});
