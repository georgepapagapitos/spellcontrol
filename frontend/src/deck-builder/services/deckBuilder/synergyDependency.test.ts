import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { isUnsupportedSynergyPayoff } from './synergyDependency';

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
