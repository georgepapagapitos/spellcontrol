import { describe, expect, it } from 'vitest';
import type { DetectedCombo, ManabaseSummary, ScryfallCard } from '@/deck-builder/types';
import { auditDeckCoherence } from './coherenceAudit';

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

const commander = card({
  name: 'Test Commander',
  type_line: 'Legendary Creature — Human Soldier',
  oracle_text: 'Vigilance',
});

const lifegainPayoff = card({
  name: "Ajani's Pridemate",
  type_line: 'Creature — Cat Soldier',
  oracle_text: "Whenever you gain life, put a +1/+1 counter on Ajani's Pridemate.",
});

const lifegainProducer = (name: string) =>
  card({
    name,
    cmc: 2,
    type_line: 'Enchantment',
    oracle_text: 'At the beginning of your upkeep, you gain 1 life.',
  });

// EDHREC-justified vanilla body: no axis hits, but an inclusion signal.
const vanilla = card({
  name: 'Vanilla Beast',
  type_line: 'Creature — Beast',
  oracle_text: '',
});

function audit(
  nonLandCards: ScryfallCard[],
  extra: Partial<Parameters<typeof auditDeckCoherence>[0]> = {}
) {
  return auditDeckCoherence({ nonLandCards, commanders: [commander], ...extra });
}

describe('auditDeckCoherence', () => {
  it('flags a payoff whose engine has no support in the final deck', () => {
    const findings = audit([lifegainPayoff]);
    const dead = findings.filter((f) => f.kind === 'dead-payoff');
    expect(dead).toHaveLength(1);
    expect(dead[0].card).toBe("Ajani's Pridemate");
    expect(dead[0].severity).toBe('warn');
    expect(dead[0].message).toContain('Lifegain');
  });

  it('does not flag the same payoff once producers feed it', () => {
    const findings = audit([
      lifegainPayoff,
      lifegainProducer('Soul Chant'),
      lifegainProducer('Restful Idol'),
    ]);
    expect(findings.filter((f) => f.kind === 'dead-payoff')).toHaveLength(0);
  });

  it('never double-flags a dead payoff as an unjustified slot', () => {
    const findings = audit([lifegainPayoff]);
    expect(findings.filter((f) => f.card === "Ajani's Pridemate")).toHaveLength(1);
  });

  it('flags a card with no EDHREC, lift, axis, role, or combo tie', () => {
    const findings = audit([vanilla]);
    const flagged = findings.filter((f) => f.kind === 'unjustified-slot');
    expect(flagged).toHaveLength(1);
    expect(flagged[0].card).toBe('Vanilla Beast');
  });

  it.each([
    ['EDHREC inclusion', { cardInclusionMap: { 'Vanilla Beast': 12 } }],
    ['lift connectivity', { liftedByMap: { 'vanilla beast': ['Test Commander'] } }],
    ['a tagger role', { roleOf: () => 'removal' }],
  ])('accepts %s as slot justification', (_label, extra) => {
    expect(audit([vanilla], extra)).toHaveLength(0);
  });

  it('accepts membership in a complete combo as justification', () => {
    const combo: DetectedCombo = {
      comboId: 'c1',
      cards: ['Vanilla Beast', 'Other Piece'],
      results: ['Infinite value'],
      isComplete: true,
      missingCards: [],
      deckCount: 100,
      bracket: null,
      cardCount: 2,
    };
    expect(audit([vanilla], { detectedCombos: [combo] })).toHaveLength(0);
    // An incomplete combo justifies nothing.
    expect(
      audit([vanilla], {
        detectedCombos: [{ ...combo, isComplete: false, missingCards: ['Other Piece'] }],
      })
    ).toHaveLength(1);
  });

  it('skips must-include cards — a forced pick is never flagged', () => {
    expect(audit([{ ...vanilla, isMustInclude: true }])).toHaveLength(0);
  });

  it('surfaces lopsided-engine warnings as deck-level info findings, after card flags', () => {
    const producers = Array.from({ length: 5 }, (_, i) => lifegainProducer(`Chant ${i}`));
    const findings = audit([...producers, vanilla]);
    const lopsided = findings.filter((f) => f.kind === 'lopsided-engine');
    expect(lopsided).toHaveLength(1);
    expect(lopsided[0].severity).toBe('info');
    expect(lopsided[0].card).toBeUndefined();
    expect(lopsided[0].message).toContain('Lifegain');
    expect(findings[findings.length - 1].kind).toBe('lopsided-engine');
  });

  it('returns no findings for a coherent deck', () => {
    expect(
      audit([lifegainPayoff, lifegainProducer('Soul Chant'), lifegainProducer('Restful Idol')], {
        cardInclusionMap: {
          "Ajani's Pridemate": 40,
          'Soul Chant': 20,
          'Restful Idol': 15,
        },
      })
    ).toHaveLength(0);
  });
});

// ── Land sanity (E78 phase 2) ──

const floodedStrand = card({
  name: 'Flooded Strand',
  type_line: 'Land',
  oracle_text:
    '{T}, Pay 1 life, Sacrifice Flooded Strand: Search your library for a Plains or Island card, put it onto the battlefield, then shuffle.',
});
const evolvingWilds = card({
  name: 'Evolving Wilds',
  type_line: 'Land',
  oracle_text:
    '{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
});
const island = card({
  name: 'Island',
  type_line: 'Basic Land — Island',
  produced_mana: ['U'],
});
const snowPlains = card({
  name: 'Snow-Covered Plains',
  type_line: 'Basic Snow Land — Plains',
  produced_mana: ['W'],
});
const triome = card({
  name: 'Raugrin Triome',
  type_line: 'Land — Island Mountain Plains',
  oracle_text: 'Raugrin Triome enters the battlefield tapped.',
  produced_mana: ['U', 'R', 'W'],
});
const pathOfAncestry = card({
  name: 'Path of Ancestry',
  type_line: 'Land',
  oracle_text:
    "Path of Ancestry enters the battlefield tapped.\n{T}: Add one mana of any color in your commander's color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1.",
  produced_mana: ['W', 'U', 'B', 'R', 'G'],
});
const cavern = card({
  name: 'Cavern of Souls',
  type_line: 'Land',
  oracle_text:
    'As Cavern of Souls enters the battlefield, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type.',
});
const colorlessUtility = (name: string) =>
  card({ name, type_line: 'Land', oracle_text: '{T}: Add {C}.', produced_mana: ['C'] });

const shortWhiteManabase: ManabaseSummary = {
  lines: [
    { color: 'W', pips: 24, sources: 4, target: 12, short: true },
    { color: 'U', pips: 10, sources: 12, target: 8, short: false },
  ],
  totalLands: 34,
  nonlandSources: 2,
};

const creature = (name: string, subtypes: string) =>
  card({ name, type_line: `Creature — ${subtypes}` });

describe('auditDeckCoherence — land sanity', () => {
  it('flags a typed fetch with no matching basic type to find', () => {
    const findings = audit([vanilla], {
      cardInclusionMap: { 'Vanilla Beast': 10 },
      lands: [floodedStrand],
      manabase: shortWhiteManabase,
    });
    const dead = findings.filter((f) => f.kind === 'land-sanity');
    expect(dead).toHaveLength(1);
    expect(dead[0].card).toBe('Flooded Strand');
    expect(dead[0].severity).toBe('warn');
    expect(dead[0].message).toContain('Plains or Island');
    // repairable: prefers the short color among the fetch's named types
    expect(dead[0].basicFixColor).toBe('W');
  });

  it.each([
    ['a basic', island],
    ['a Snow-Covered basic', snowPlains],
    ['a typed nonbasic (Triome)', triome],
  ])('does not flag a typed fetch when %s provides the type', (_label, target) => {
    const findings = audit([vanilla], {
      cardInclusionMap: { 'Vanilla Beast': 10 },
      lands: [floodedStrand, target],
    });
    expect(findings.filter((f) => f.kind === 'land-sanity')).toHaveLength(0);
  });

  it('flags an any-basic fetch only when the deck runs zero basics', () => {
    const none = audit([vanilla], {
      cardInclusionMap: { 'Vanilla Beast': 10 },
      lands: [evolvingWilds, triome],
    });
    expect(none.filter((f) => f.kind === 'land-sanity')).toHaveLength(1);
    expect(none[0].message).toContain('basic');

    const withBasic = audit([vanilla], {
      cardInclusionMap: { 'Vanilla Beast': 10 },
      lands: [evolvingWilds, island],
    });
    expect(withBasic.filter((f) => f.kind === 'land-sanity')).toHaveLength(0);
  });

  it('warns on Path of Ancestry when nothing shares a commander creature type', () => {
    // commander is Human Soldier; Beasts share nothing
    const findings = audit([creature('Beast A', 'Beast'), creature('Beast B', 'Beast')], {
      cardInclusionMap: { 'Beast A': 10, 'Beast B': 10 },
      lands: [pathOfAncestry],
    });
    const typal = findings.filter((f) => f.kind === 'land-sanity');
    expect(typal).toHaveLength(1);
    expect(typal[0].severity).toBe('warn');
    expect(typal[0].basicFixColor).toBeUndefined(); // report-only
  });

  it('info-flags Path of Ancestry under the share floor, silent at or above it', () => {
    const beasts = Array.from({ length: 9 }, (_, i) => creature(`Beast ${i}`, 'Beast'));
    const incl = Object.fromEntries([...beasts.map((b) => [b.name, 10]), ['Cat Soldier', 10]]);
    const low = audit([...beasts, creature('Cat Soldier', 'Cat Soldier')], {
      cardInclusionMap: incl,
      lands: [pathOfAncestry],
    });
    const flagged = low.filter((f) => f.kind === 'land-sanity');
    expect(flagged).toHaveLength(1);
    expect(flagged[0].severity).toBe('info');

    // 2 of 4 share → 50% ≥ floor → silent (changeling counts as sharing)
    const changeling = card({
      name: 'Shapeshifter',
      type_line: 'Creature — Shapeshifter',
      keywords: ['Changeling'],
    });
    const ok = audit(
      [
        creature('Cat Soldier', 'Cat Soldier'),
        changeling,
        creature('Beast A', 'Beast'),
        creature('Beast B', 'Beast'),
      ],
      {
        cardInclusionMap: {
          'Cat Soldier': 10,
          Shapeshifter: 10,
          'Beast A': 10,
          'Beast B': 10,
        },
        lands: [pathOfAncestry],
      }
    );
    expect(ok.filter((f) => f.kind === 'land-sanity')).toHaveLength(0);
  });

  it('flags a choose-a-type land when no single type carries the deck', () => {
    const scattered = ['Beast', 'Cat', 'Dog', 'Elf', 'Goblin', 'Wizard', 'Zombie'].map((t) =>
      creature(`${t} One`, t)
    );
    const findings = audit(scattered, {
      cardInclusionMap: Object.fromEntries(scattered.map((c) => [c.name, 10])),
      lands: [cavern],
    });
    expect(findings.filter((f) => f.kind === 'land-sanity')).toHaveLength(1);

    const tribal = Array.from({ length: 5 }, (_, i) => creature(`Elf ${i}`, 'Elf Druid'));
    const ok = audit(tribal, {
      cardInclusionMap: Object.fromEntries(tribal.map((c) => [c.name, 10])),
      lands: [cavern],
    });
    expect(ok.filter((f) => f.kind === 'land-sanity')).toHaveLength(0);
  });

  it('flags colorless-only utility lands only when a color is short AND they pile up', () => {
    const utilities = [colorlessUtility('Tower A'), colorlessUtility('Tower B')];
    const flagged = audit([vanilla], {
      cardInclusionMap: { 'Vanilla Beast': 10 },
      lands: [...utilities, island],
      manabase: shortWhiteManabase,
    });
    const util = flagged.filter((f) => f.kind === 'land-sanity');
    expect(util).toHaveLength(2);
    expect(util.every((f) => f.severity === 'info' && f.basicFixColor === 'W')).toBe(true);
    expect(util[0].message).toContain('Plains');

    // one colorless land is normal — silent
    expect(
      audit([vanilla], {
        cardInclusionMap: { 'Vanilla Beast': 10 },
        lands: [colorlessUtility('Tower A'), island],
        manabase: shortWhiteManabase,
      }).filter((f) => f.kind === 'land-sanity')
    ).toHaveLength(0);

    // nothing short — silent
    expect(
      audit([vanilla], {
        cardInclusionMap: { 'Vanilla Beast': 10 },
        lands: [...utilities, island],
        manabase: {
          ...shortWhiteManabase,
          lines: shortWhiteManabase.lines.map((l) => ({ ...l, short: false })),
        },
      }).filter((f) => f.kind === 'land-sanity')
    ).toHaveLength(0);
  });

  it('never flags a must-include land', () => {
    const findings = audit([vanilla], {
      cardInclusionMap: { 'Vanilla Beast': 10 },
      lands: [{ ...floodedStrand, isMustInclude: true }],
    });
    expect(findings.filter((f) => f.kind === 'land-sanity')).toHaveLength(0);
  });

  it('emits no land findings when lands are not provided (back-compat)', () => {
    expect(
      audit([vanilla], { cardInclusionMap: { 'Vanilla Beast': 10 } }).filter(
        (f) => f.kind === 'land-sanity'
      )
    ).toHaveLength(0);
  });
});

// ── Win-condition check (E77) ──

const winCombo: DetectedCombo = {
  comboId: 'wc1',
  cards: ['Piece A', 'Piece B'],
  results: ['Win the game'],
  isComplete: true,
  missingCards: [],
  deckCount: 100,
  bracket: null,
  cardCount: 2,
};

const altWinCard = card({
  name: 'Grand Finale',
  type_line: 'Enchantment',
  oracle_text: 'At the beginning of your upkeep, if you control ten permanents, you win the game.',
});

describe('auditDeckCoherence — win-condition (E77)', () => {
  it('warns first when the deck has no way to win', () => {
    const findings = audit([vanilla], {
      cardInclusionMap: { 'Vanilla Beast': 10 },
      format: 'commander',
    });
    const wc = findings.filter((f) => f.kind === 'win-condition');
    expect(wc).toHaveLength(1);
    expect(wc[0].severity).toBe('warn');
    expect(wc[0].card).toBeUndefined(); // deck-level
    expect(findings[0].kind).toBe('win-condition'); // the headline flag leads
  });

  it('info-flags a single win path, naming it', () => {
    const findings = audit([vanilla], {
      cardInclusionMap: { 'Vanilla Beast': 10 },
      detectedCombos: [winCombo],
      format: 'commander',
    });
    const wc = findings.filter((f) => f.kind === 'win-condition');
    expect(wc).toHaveLength(1);
    expect(wc[0].severity).toBe('info');
    expect(wc[0].message).toContain('Infinite combo');
  });

  it('stays silent with two win paths', () => {
    const findings = audit([vanilla, altWinCard], {
      cardInclusionMap: { 'Vanilla Beast': 10, 'Grand Finale': 8 },
      detectedCombos: [winCombo],
      format: 'commander',
    });
    expect(findings.filter((f) => f.kind === 'win-condition')).toHaveLength(0);
  });

  it('ignores incomplete combos — a plan to have a plan is not a win path', () => {
    const findings = audit([vanilla], {
      cardInclusionMap: { 'Vanilla Beast': 10 },
      detectedCombos: [{ ...winCombo, isComplete: false, missingCards: ['Piece B'] }],
      format: 'commander',
    });
    const wc = findings.filter((f) => f.kind === 'win-condition');
    expect(wc).toHaveLength(1);
    expect(wc[0].severity).toBe('warn');
  });

  it('does not run without a format (back-compat with existing callers)', () => {
    expect(
      audit([vanilla], { cardInclusionMap: { 'Vanilla Beast': 10 } }).filter(
        (f) => f.kind === 'win-condition'
      )
    ).toHaveLength(0);
  });
});

// ── Answer coverage (E79) ──

const swords = card({
  name: 'Swords to Plowshares',
  type_line: 'Instant',
  oracle_text: 'Exile target creature. Its controller gains life equal to its power.',
});
const bojukaBog = card({
  name: 'Bojuka Bog',
  type_line: 'Land',
  oracle_text: "When this land enters, exile target player's graveyard.\n{T}: Add {B}.",
});

describe('auditDeckCoherence — answer coverage (E79)', () => {
  const coverage = (findings: ReturnType<typeof audit>) =>
    findings.filter((f) => f.kind === 'answer-coverage');

  it('does not run without a colorIdentity (back-compat with existing callers)', () => {
    const findings = audit([swords], { cardInclusionMap: { 'Swords to Plowshares': 60 } });
    expect(coverage(findings)).toHaveLength(0);
  });

  it('stays silent when nothing classifies — blank oracle text is never a hole (golden guard)', () => {
    const findings = audit([vanilla], {
      cardInclusionMap: { 'Vanilla Beast': 10 },
      colorIdentity: ['W', 'G'],
    });
    expect(coverage(findings)).toHaveLength(0);
  });

  it('warns on a color-fillable hole as a deck-level finding', () => {
    const findings = audit([swords], {
      cardInclusionMap: { 'Swords to Plowshares': 60 },
      colorIdentity: ['W', 'G'],
    });
    const enchantmentHole = coverage(findings).find((f) => f.message.includes('enchantment'));
    expect(enchantmentHole?.severity).toBe('warn');
    expect(enchantmentHole?.card).toBeUndefined(); // deck-level → repair never acts on it
  });

  it('scans lands too — Bojuka Bog clears the graveyard note', () => {
    const base = {
      cardInclusionMap: { 'Swords to Plowshares': 60 },
      colorIdentity: ['W', 'B'],
    };
    const without = audit([swords], base);
    expect(coverage(without).some((f) => f.message.includes('graveyard'))).toBe(true);
    const withBog = audit([swords], { ...base, lands: [bojukaBog] });
    expect(coverage(withBog).some((f) => f.message.includes('graveyard'))).toBe(false);
  });
});
