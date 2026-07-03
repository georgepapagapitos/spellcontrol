import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { nonboFindings } from './nonbo';

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
