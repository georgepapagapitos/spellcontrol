import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { answerCoverageFindings, classifyAnswer, type AnswerProfile } from './answerCoverage';

function card(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'id',
    oracle_id: 'oracle',
    name: 'Card',
    cmc: 2,
    type_line: 'Sorcery',
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

// ── Real card texts, one per matrix cell ──
const swords = card({
  name: 'Swords to Plowshares',
  type_line: 'Instant',
  oracle_text: 'Exile target creature. Its controller gains life equal to its power.',
});
const krosanGrip = card({
  name: 'Krosan Grip',
  type_line: 'Instant',
  oracle_text:
    "Split second (As long as this spell is on the stack, players can't cast spells or activate abilities that aren't mana abilities.)\nDestroy target artifact or enchantment.",
});
const counterspell = card({
  name: 'Counterspell',
  type_line: 'Instant',
  oracle_text: 'Counter target spell.',
});
const bojukaBog = card({
  name: 'Bojuka Bog',
  type_line: 'Land',
  oracle_text:
    "This land enters tapped.\nWhen this land enters, exile target player's graveyard.\n{T}: Add {B}.",
});
const chaosWarp = card({
  name: 'Chaos Warp',
  type_line: 'Instant',
  oracle_text:
    'The owner of target permanent shuffles it into their library, then reveals the top card of their library. If it’s a permanent card, they put it onto the battlefield.',
});
const preyUpon = card({
  name: 'Prey Upon',
  type_line: 'Sorcery',
  oracle_text:
    "Target creature you control fights target creature you don't control. (Each deals damage equal to its power to the other.)",
});
const lightningBolt = card({
  name: 'Lightning Bolt',
  type_line: 'Instant',
  oracle_text: 'Lightning Bolt deals 3 damage to any target.',
});
const toxicDeluge = card({
  name: 'Toxic Deluge',
  type_line: 'Sorcery',
  oracle_text:
    'As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn.',
});
const cyclonicRift = card({
  name: 'Cyclonic Rift',
  type_line: 'Instant',
  oracle_text:
    "Return target nonland permanent you don't control to its owner's hand.\nOverload {6}{U}",
});
const wrath = card({
  name: 'Wrath of God',
  type_line: 'Sorcery',
  oracle_text: "Destroy all creatures. They can't be regenerated.",
});
const beastWithin = card({
  name: 'Beast Within',
  type_line: 'Instant',
  oracle_text: 'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.',
});
const grievousEdict = card({
  name: 'Grievous Edict', // Diabolic Edict wording
  type_line: 'Instant',
  oracle_text: 'Target player sacrifices a creature of their choice.',
});
const unsummon = card({
  name: 'Unsummon',
  type_line: 'Instant',
  oracle_text: "Return target creature to its owner's hand.",
});

const answers = (c: ScryfallCard): AnswerProfile['answers'] => classifyAnswer(c)?.answers ?? [];

describe('classifyAnswer — calibration matrix', () => {
  it('Swords to Plowshares = instant / creature / exile', () => {
    const p = classifyAnswer(swords)!;
    expect(p.instantSpeed).toBe(true);
    expect(p.answers).toEqual([{ threat: 'creature', mode: 'exile' }]);
  });

  it('Krosan Grip = instant / artifact + enchantment / destroy', () => {
    const p = classifyAnswer(krosanGrip)!;
    expect(p.instantSpeed).toBe(true);
    expect(p.answers).toEqual(
      expect.arrayContaining([
        { threat: 'artifact', mode: 'destroy' },
        { threat: 'enchantment', mode: 'destroy' },
      ])
    );
  });

  it('Counterspell = stack', () => {
    expect(answers(counterspell)).toEqual([{ threat: 'stack', mode: 'counter' }]);
  });

  it('Bojuka Bog = graveyard hate, not instant-speed', () => {
    const p = classifyAnswer(bojukaBog)!;
    expect(p.instantSpeed).toBe(false);
    expect(p.answers).toEqual([{ threat: 'graveyard', mode: 'exile' }]);
  });

  it('Chaos Warp = any-permanent, tuck counts as exile-grade', () => {
    expect(answers(chaosWarp)).toEqual([{ threat: 'any-permanent', mode: 'exile' }]);
  });

  it('fight spells = creature / damage-or-fight (reminder text ignored)', () => {
    expect(answers(preyUpon)).toEqual([{ threat: 'creature', mode: 'damage-or-fight' }]);
  });

  it('"any target" burn covers creatures and planeswalkers', () => {
    expect(answers(lightningBolt)).toEqual(
      expect.arrayContaining([
        { threat: 'creature', mode: 'damage-or-fight' },
        { threat: 'planeswalker', mode: 'damage-or-fight' },
      ])
    );
  });

  it('Toxic Deluge = creature / -X/-X', () => {
    expect(answers(toxicDeluge)).toEqual([{ threat: 'creature', mode: 'minus-x' }]);
  });

  it('Cyclonic Rift = any-permanent / bounce', () => {
    expect(answers(cyclonicRift)).toEqual([{ threat: 'any-permanent', mode: 'bounce' }]);
  });

  it('boardwipes classify like targeted removal (Wrath = creature / destroy)', () => {
    expect(answers(wrath)).toEqual([{ threat: 'creature', mode: 'destroy' }]);
  });

  it('Beast Within = any-permanent / destroy', () => {
    expect(answers(beastWithin)).toEqual([{ threat: 'any-permanent', mode: 'destroy' }]);
  });

  it('edicts = creature / destroy-grade (sacrifice beats indestructible)', () => {
    expect(answers(grievousEdict)).toEqual([{ threat: 'creature', mode: 'destroy' }]);
  });

  it('flash grants instant speed to a noninstant', () => {
    const p = classifyAnswer(
      card({
        type_line: 'Creature — Elemental',
        keywords: ['Flash'],
        oracle_text: 'Flash\nWhen this creature enters, destroy target artifact.',
      })
    )!;
    expect(p.instantSpeed).toBe(true);
  });

  it.each<[string, Partial<ScryfallCard>]>([
    ['empty oracle text (golden fixtures)', { oracle_text: '' }],
    ['a vanilla creature', { type_line: 'Creature — Beast', oracle_text: 'Trample' }],
    [
      'ramp',
      {
        oracle_text:
          'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
      },
    ],
    [
      'graveyard recursion (not removal)',
      { oracle_text: 'Return target creature card from your graveyard to your hand.' },
    ],
    [
      'self-blink (exile-and-return is not an answer)',
      {
        oracle_text:
          'Exile up to one target creature you control, then return that card to the battlefield under its owner’s control.',
      },
    ],
    [
      'delve-style self-graveyard exile',
      { oracle_text: 'As an additional cost, exile any number of cards from your graveyard.' },
    ],
  ])('returns null for %s — positive evidence only', (_label, overrides) => {
    expect(classifyAnswer(card(overrides))).toBeNull();
  });
});

describe('answerCoverageFindings', () => {
  const kinds = (findings: ReturnType<typeof answerCoverageFindings>) =>
    findings.map((f) => `${f.severity}:${f.message}`);

  it('says nothing when zero cards classify — thin data is not a hole (golden guard)', () => {
    const deck = Array.from({ length: 30 }, (_, i) => card({ name: `Blank ${i}` }));
    expect(answerCoverageFindings(deck, ['G'])).toEqual([]);
  });

  it('warns on a fillable class with zero answers (Selesnya, no enchantment answer)', () => {
    const findings = answerCoverageFindings([swords, wrath], ['W', 'G']);
    expect(findings.some((f) => f.severity === 'warn' && f.message.includes('enchantment'))).toBe(
      true
    );
    // Deck-level by construction: the repair pass must never act on these.
    expect(findings.every((f) => f.kind === 'answer-coverage' && f.card === undefined)).toBe(true);
  });

  it('never flags a hole the colors cannot fill (mono-red, no enchantment answer)', () => {
    const findings = answerCoverageFindings([lightningBolt], ['R']);
    expect(findings.some((f) => f.message.includes('enchantment'))).toBe(false);
  });

  it('flags all-fight creature coverage as fragile (the mono-green failure)', () => {
    const fights = [preyUpon, { ...preyUpon, name: 'Epic Confrontation' }];
    const findings = answerCoverageFindings(fights, ['G']);
    const fragile = findings.find((f) => f.message.includes('indestructible'));
    expect(fragile?.severity).toBe('info');
  });

  it('flags all-bounce coverage as temporary', () => {
    const findings = answerCoverageFindings([unsummon, cyclonicRift], ['U']);
    expect(findings.some((f) => f.message.includes('comes right back'))).toBe(true);
  });

  it('does not call solid coverage fragile', () => {
    const findings = answerCoverageFindings([swords, preyUpon], ['G', 'W']);
    expect(findings.some((f) => f.message.includes('indestructible'))).toBe(false);
  });

  it('notes a single answer to a class as thin, but not a doubly-covered one', () => {
    const findings = answerCoverageFindings([swords, krosanGrip, wrath], ['W', 'G']);
    const thin = findings.filter((f) => f.message.startsWith('Only one answer'));
    // Artifact and enchantment lean on Krosan Grip alone; creature has two answers.
    expect(thin).toHaveLength(2);
    expect(thin.every((f) => f.severity === 'info')).toBe(true);
    expect(findings.some((f) => f.message.includes('opposing creature'))).toBe(false);
  });

  it('notes missing graveyard interaction at info, and Bojuka Bog clears it', () => {
    const without = answerCoverageFindings([swords], ['W', 'B']);
    expect(without.some((f) => f.message.includes('graveyard'))).toBe(true);
    const withBog = answerCoverageFindings([swords, bojukaBog], ['W', 'B']);
    expect(withBog.some((f) => f.message.includes('graveyard'))).toBe(false);
  });

  it('notes zero counterspells only when blue is in the identity', () => {
    const blue = answerCoverageFindings([unsummon], ['U']);
    expect(blue.some((f) => f.message.includes('counter a spell'))).toBe(true);
    const white = answerCoverageFindings([swords], ['W']);
    expect(white.some((f) => f.message.includes('counter a spell'))).toBe(false);
    const covered = answerCoverageFindings([unsummon, counterspell], ['U']);
    expect(covered.some((f) => f.message.includes('counter a spell'))).toBe(false);
  });

  it('notes an all-sorcery-speed answer suite', () => {
    const sorceries = answerCoverageFindings([wrath, toxicDeluge], ['W', 'B']);
    expect(sorceries.some((f) => f.message.includes('sorcery-speed'))).toBe(true);
    const mixed = answerCoverageFindings([wrath, swords], ['W', 'B']);
    expect(mixed.some((f) => f.message.includes('sorcery-speed'))).toBe(false);
  });

  it('treats a colorless identity as able to fill every battlefield class', () => {
    const findings = answerCoverageFindings(
      [card({ oracle_text: 'Destroy target creature.' })],
      []
    );
    expect(findings.some((f) => f.severity === 'warn' && f.message.includes('enchantment'))).toBe(
      true
    );
    expect(kinds(findings).some((k) => k.includes('counter a spell'))).toBe(false);
  });

  it('any-permanent answers cover every battlefield class', () => {
    const findings = answerCoverageFindings([beastWithin, chaosWarp], ['G', 'R']);
    expect(findings.some((f) => f.severity === 'warn')).toBe(false);
  });
});
