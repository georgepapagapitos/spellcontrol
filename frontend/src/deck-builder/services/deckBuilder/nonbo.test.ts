import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { nonboFindings, qualifiedTriggerFindings } from './nonbo';

function card(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'id',
    oracle_id: 'oracle',
    name: 'Card',
    cmc: 2,
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

// ── Real card texts ──
const restInPeace = card({
  name: 'Rest in Peace',
  oracle_text:
    'When Rest in Peace enters the battlefield, exile all cards from all graveyards.\nIf a card or token would be put into a graveyard from anywhere, exile it instead.',
});
const leylineOfTheVoid = card({
  name: 'Leyline of the Void',
  oracle_text:
    "If Leyline of the Void is in your opening hand, you may begin the game with it on the battlefield.\nIf a card would be put into an opponent's graveyard from anywhere, exile it instead.",
});
const torporOrb = card({
  name: 'Torpor Orb',
  type_line: 'Artifact',
  oracle_text: "Creatures entering the battlefield don't cause abilities to trigger.",
});
const hushbringer = card({
  name: 'Hushbringer',
  type_line: 'Creature — Faerie',
  oracle_text: "Creatures entering the battlefield or dying don't cause abilities to trigger.",
});
const everlastingTorment = card({
  name: 'Everlasting Torment',
  oracle_text:
    "Players can't gain life.\nDamage isn't removed from creatures during cleanup steps.\nAll damage is dealt as though its source had wither.",
});
const skullcrack = card({
  name: 'Skullcrack',
  type_line: 'Instant',
  oracle_text:
    "Damage can't be prevented this turn. Players can't gain life this turn.\nSkullcrack deals 3 damage to target player or planeswalker.",
});
const stonySilence = card({
  name: 'Stony Silence',
  oracle_text: "Activated abilities of artifacts can't be activated.",
});
const karn = card({
  name: 'Karn, the Great Creator',
  type_line: 'Legendary Planeswalker — Karn',
  oracle_text: "Activated abilities of artifacts your opponents control can't be activated.",
});
const wrath = card({
  name: 'Wrath of God',
  type_line: 'Sorcery',
  oracle_text: "Destroy all creatures. They can't be regenerated.",
});
const garruksWake = card({
  name: "In Garruk's Wake",
  type_line: 'Sorcery',
  oracle_text: "Destroy all creatures you don't control and all planeswalkers you don't control.",
});
const baneOfProgress = card({
  name: 'Bane of Progress',
  type_line: 'Creature — Elemental',
  oracle_text:
    'When Bane of Progress enters the battlefield, destroy all artifacts and enchantments. It gets a +1/+1 counter for each permanent destroyed this way.',
});
const relic = card({
  name: 'Relic of Progenitus',
  type_line: 'Artifact',
  oracle_text:
    '{T}: Target player exiles a card from their graveyard.\n{1}, Exile Relic of Progenitus: Exile all cards from all graveyards. Draw a card.',
});
const cruxOfFate = card({
  name: 'Crux of Fate',
  type_line: 'Sorcery',
  oracle_text: 'Choose one —\n• Destroy all Dragon creatures.\n• Destroy all non-Dragon creatures.',
});
const sivitri = card({
  name: 'Sivitri, Dragon Master',
  type_line: 'Legendary Planeswalker — Sivitri',
  oracle_text:
    "+1: Until your next turn, creatures can't attack you or planeswalkers you control unless their controller pays 2 life for each of those creatures.\n" +
    '−3: Search your library for a Dragon card, reveal it, put it into your hand, then shuffle.\n' +
    '−7: Destroy all non-Dragon creatures.',
});
const livingDeath = card({
  name: 'Living Death',
  type_line: 'Sorcery',
  oracle_text:
    'Each player exiles all creature cards from their graveyard, then sacrifices all creatures they control, then puts all cards they exiled this way onto the battlefield.',
});
const damn = card({
  name: 'Damn',
  type_line: 'Sorcery',
  oracle_text:
    'Destroy target creature. A creature destroyed this way can\'t be regenerated.\nOverload {2}{W}{W} (You may cast this spell for its overload cost. If you do, change "target" in its text to "each.")',
});

const dragon = (name: string) => card({ name, type_line: 'Creature — Dragon' });
const dragonTribalBoard = [
  ...Array.from({ length: 22 }, (_, i) => dragon(`Dragon ${i}`)),
  ...Array.from({ length: 6 }, (_, i) =>
    card({ name: `Support ${i}`, type_line: 'Creature — Human' })
  ),
];
const nonTribalBoard = Array.from({ length: 20 }, (_, i) =>
  card({ name: `Beater ${i}`, type_line: 'Creature — Human' })
);
const aggroBoard = Array.from({ length: 20 }, (_, i) =>
  card({ name: `Aggro ${i}`, type_line: 'Creature — Human' })
);

const invested = (...axes: string[]) => new Set(axes);

describe('nonboFindings — hard nonbos (warn)', () => {
  it('flags Rest in Peace in a graveyard deck', () => {
    const findings = nonboFindings([restInPeace], invested('graveyard'));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'nonbo',
      severity: 'warn',
      card: 'Rest in Peace',
    });
    expect(findings[0].message).toContain('Graveyard');
  });

  it('does not flag opponent-only hate (Leyline of the Void)', () => {
    expect(nonboFindings([leylineOfTheVoid], invested('graveyard', 'mill'))).toHaveLength(0);
  });

  it('flags Torpor Orb beside a blink engine, silent otherwise', () => {
    expect(nonboFindings([torporOrb], invested('blink'))).toHaveLength(1);
    expect(nonboFindings([torporOrb], invested('tokens', 'lifegain'))).toHaveLength(0);
  });

  it('Hushbringer additionally opposes death triggers (sacrifice)', () => {
    const findings = nonboFindings([hushbringer], invested('sacrifice'));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    // Torpor Orb has no "or dying" clause — sacrifice-only investment stays silent
    expect(nonboFindings([torporOrb], invested('sacrifice'))).toHaveLength(0);
  });

  it('flags continuous lifegain denial, not one-turn Skullcrack', () => {
    expect(nonboFindings([everlastingTorment], invested('lifegain'))).toHaveLength(1);
    expect(nonboFindings([skullcrack], invested('lifegain'))).toHaveLength(0);
  });

  it('flags Stony Silence over an artifact engine, not opponent-only Karn', () => {
    const findings = nonboFindings([stonySilence], invested('artifacts'));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(nonboFindings([karn], invested('artifacts', 'equipment'))).toHaveLength(0);
  });
});

describe('nonboFindings — tensions (info)', () => {
  it('notes a symmetric creature wipe in a token deck, silent one-sided', () => {
    const findings = nonboFindings([wrath], invested('tokens'));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('Tokens');
    expect(nonboFindings([garruksWake], invested('tokens'))).toHaveLength(0);
  });

  it('notes Bane of Progress in an enchantress deck', () => {
    const findings = nonboFindings([baneOfProgress], invested('enchantress'));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('Enchantress');
  });

  it('notes a one-shot symmetric graveyard wipe in a graveyard deck', () => {
    const findings = nonboFindings([relic], invested('graveyard'));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('loses its fuel');
  });

  it('emits one finding per card — the hard nonbo outranks the wipe tension', () => {
    // RIP matches both the continuous lock and the one-shot gy wipe.
    const findings = nonboFindings([restInPeace], invested('graveyard'));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
  });
});

describe('nonboFindings — positive-evidence gates', () => {
  it('says nothing with no investment, blank oracle text, or a must-include', () => {
    expect(nonboFindings([restInPeace, torporOrb, wrath], new Set())).toHaveLength(0);
    const blanks = Array.from({ length: 20 }, (_, i) => card({ name: `Blank ${i}` }));
    expect(nonboFindings(blanks, invested('graveyard', 'tokens', 'blink'))).toHaveLength(0);
    expect(
      nonboFindings([{ ...restInPeace, isMustInclude: true }], invested('graveyard'))
    ).toHaveLength(0);
  });

  it('a wipe in a deck not invested in what it sweeps is just a wipe', () => {
    expect(nonboFindings([wrath], invested('graveyard', 'spellslinger'))).toHaveLength(0);
  });
});

describe('nonboFindings — tribal-dodge, reanimator, and Overload exceptions', () => {
  it('does not flag a modal non-tribe wipe in a deck that IS that tribe', () => {
    expect(nonboFindings([...dragonTribalBoard, cruxOfFate], invested('tokens'))).toHaveLength(0);
    expect(nonboFindings([...dragonTribalBoard, sivitri], invested('tokens'))).toHaveLength(0);
  });

  it('still flags the same modal wipe in a deck that is not that tribe', () => {
    const findings = nonboFindings([...nonTribalBoard, cruxOfFate], invested('tokens'));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ card: 'Crux of Fate', severity: 'info' });
  });

  it('does not flag a reanimation wipe (Living Death) in a graveyard-recursion deck', () => {
    expect(nonboFindings([livingDeath], invested('graveyard', 'tokens'))).toHaveLength(0);
  });

  it('still flags the same reanimation wipe when the deck has no graveyard investment', () => {
    const findings = nonboFindings([livingDeath], invested('tokens'));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ card: 'Living Death', severity: 'info' });
  });

  it("catches Damn's Overload-granted board wipe like Farewell/Blasphemous Act", () => {
    const findings = nonboFindings([...aggroBoard, damn], invested('tokens'));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ card: 'Damn', severity: 'info' });
  });

  it('leaves Damn silent outside its overload mode when no board is invested in tokens', () => {
    expect(nonboFindings([damn], invested('graveyard'))).toHaveLength(0);
  });
});

describe('qualifiedTriggerFindings — color/type-qualified ETB & death triggers (E106)', () => {
  // Real oracle text (verified against Scryfall) — never quote from memory.
  const ayara = card({
    name: 'Ayara, First of Locthwain',
    type_line: 'Legendary Creature — Elf Noble',
    colors: ['B'],
    oracle_text:
      'Whenever Ayara or another black creature you control enters, each opponent loses 1 life and you gain 1 life.\n{T}, Sacrifice another black creature: Draw a card.',
  });
  const securitron = (i: number) =>
    card({
      name: `Securitron ${i}`,
      type_line: 'Artifact Creature — Robot',
      colors: [],
    });
  const blackBeater = (i: number) =>
    card({ name: `Black Beater ${i}`, type_line: 'Creature — Zombie', colors: ['B'] });
  const mrHouseTokenMaker = card({
    name: 'Mr. House, President and CEO',
    type_line: 'Legendary Artifact Creature — Human',
    oracle_text:
      'Whenever you roll a 4 or higher, create a 3/3 colorless Robot artifact creature token. If you rolled 6 or higher, instead create that token and a Treasure token.',
  });
  const blackTokenMaker = card({
    name: 'Bad Moon Rising',
    type_line: 'Sorcery',
    oracle_text: 'Create two 2/2 black Zombie creature tokens.',
  });
  // Real oracle text — a real die-roll deck staple with ONE marginal (1-in-6)
  // matching mode beside an otherwise-colorless token engine (E106 regression:
  // this alone must not grant Ayara full credit).
  const nightShift = card({
    name: 'Night Shift of the Living Dead',
    type_line: 'Enchantment',
    colors: ['B'],
    oracle_text:
      'After you roll a die, you may pay 1 life. If you do, increase or decrease the result by 1. Do this only once each turn.\nWhenever you roll a 6, create a 2/2 black Zombie Employee creature token.',
  });
  const colorlessTokenProducer = (i: number) =>
    card({
      name: `Colorless Producer ${i}`,
      type_line: 'Artifact',
      oracle_text: 'Create a 1/1 colorless Servo artifact creature token.',
    });

  // Real oracle text for the creature-TYPE-qualified branch ("another Elf").
  const miara = card({
    name: 'Miara, Thorn of the Glade',
    type_line: 'Legendary Creature — Elf Druid',
    oracle_text:
      'Whenever Miara or another Elf you control dies, you may pay {1} and 1 life. If you do, draw a card.',
  });
  const elf = (i: number) =>
    card({ name: `Elf Warrior ${i}`, type_line: 'Creature — Elf Warrior' });
  const human = (i: number) => card({ name: `Human ${i}`, type_line: 'Creature — Human' });

  const zulaportCutthroat = card({
    name: 'Zulaport Cutthroat',
    type_line: 'Creature — Human Cleric',
    oracle_text:
      'Whenever Zulaport Cutthroat or another creature you control dies, each opponent loses 1 life and you gain 1 life.',
  });

  it('flags Ayara seated in an all-colorless-token, thin-black-creature deck', () => {
    const deck = [ayara, ...Array.from({ length: 18 }, (_, i) => securitron(i)), mrHouseTokenMaker];
    const findings = qualifiedTriggerFindings(deck);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'qualified-payoff',
      severity: 'info',
      card: 'Ayara, First of Locthwain',
    });
    expect(findings[0].message).toContain('black');
  });

  it('does not flag Ayara in a deck with real black-creature/token support', () => {
    // Enough black creatures to clear the share floor on their own.
    const withCreatures = [ayara, ...Array.from({ length: 6 }, (_, i) => blackBeater(i))];
    expect(qualifiedTriggerFindings(withCreatures)).toHaveLength(0);

    // Few black creatures, but a matching black token engine covers it.
    const withTokenEngine = [
      ayara,
      ...Array.from({ length: 18 }, (_, i) => securitron(i)),
      blackTokenMaker,
    ];
    expect(qualifiedTriggerFindings(withTokenEngine)).toHaveLength(0);
  });

  it('still flags Ayara when only ONE marginal (1-in-6) producer matches inside a mostly-colorless token engine (real Mr. House/Night Shift case)', () => {
    const deck = [
      ayara,
      ...Array.from({ length: 24 }, (_, i) => (i < 4 ? blackBeater(i) : securitron(i))),
      nightShift,
      ...Array.from({ length: 5 }, (_, i) => colorlessTokenProducer(i)),
    ];
    const findings = qualifiedTriggerFindings(deck);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'qualified-payoff',
      severity: 'info',
      card: 'Ayara, First of Locthwain',
    });
    expect(findings[0].message).toContain('almost nothing makes a matching token');
  });

  it('does not flag an Elf-qualified payoff in an actual Elf tribal deck (Lathril)', () => {
    const elfDeck = [miara, ...Array.from({ length: 15 }, (_, i) => elf(i))];
    expect(qualifiedTriggerFindings(elfDeck)).toHaveLength(0);
  });

  it('still flags the same Elf-qualified payoff outside an Elf deck', () => {
    const nonElfDeck = [miara, ...Array.from({ length: 15 }, (_, i) => human(i))];
    const findings = qualifiedTriggerFindings(nonElfDeck);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ card: 'Miara, Thorn of the Glade' });
  });

  it('leaves an unqualified "another creature" death payoff untouched (Zulaport Cutthroat)', () => {
    // Thin creature count either way — an unqualified trigger feeds off
    // anything, so it must never be flagged regardless of composition.
    expect(
      qualifiedTriggerFindings([
        zulaportCutthroat,
        ...Array.from({ length: 18 }, (_, i) => securitron(i)),
      ])
    ).toHaveLength(0);
  });

  it('recognizes the type-qualified ETB branch too (Marwyn, the Nurturer — real oracle text)', () => {
    const marwyn = card({
      name: 'Marwyn, the Nurturer',
      type_line: 'Legendary Creature — Elf Druid',
      oracle_text: 'Whenever another Elf you control enters, put a +1/+1 counter on Marwyn.',
    });
    expect(
      qualifiedTriggerFindings([marwyn, ...Array.from({ length: 15 }, (_, i) => human(i))])
    ).toHaveLength(1);
    expect(
      qualifiedTriggerFindings([marwyn, ...Array.from({ length: 15 }, (_, i) => elf(i))])
    ).toHaveLength(0);
  });

  it('says nothing for a must-include or a blank oracle', () => {
    expect(
      qualifiedTriggerFindings([
        { ...ayara, isMustInclude: true },
        ...Array.from({ length: 18 }, (_, i) => securitron(i)),
      ])
    ).toHaveLength(0);
    expect(qualifiedTriggerFindings([card({ name: 'Blank' })])).toHaveLength(0);
  });
});
