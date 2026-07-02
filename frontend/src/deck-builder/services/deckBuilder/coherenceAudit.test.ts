import { describe, expect, it } from 'vitest';
import type { DetectedCombo, ScryfallCard } from '@/deck-builder/types';
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
