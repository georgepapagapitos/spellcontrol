// Pure-part tests for keyword-glossary.mjs — no network, no fs. The rule and
// glossary text below is copied from the Comprehensive Rules (April 2026), so
// each case is the real shape the derivation meets, not an invented one.
import { describe, it, expect } from 'vitest';
import { deriveKeywordGlossary, operativeText, sentences } from './keyword-glossary.mjs';

const RULES = [
  { number: '702.9', text: 'Flying' },
  { number: '702.9a', text: 'Flying is an evasion ability.' },
  {
    number: '702.9b',
    text: 'A creature with flying can’t be blocked except by creatures with flying and/or reach. A creature with flying can block a creature with or without flying. (See rule 509, “Declare Blockers Step,” and rule 702.17, “Reach.”)',
  },
  { number: '702.9c', text: 'Multiple instances of flying on the same creature are redundant.' },
  { number: '702.61', text: 'Split Second' },
  {
    number: '702.61a',
    text: 'Split second is a static ability that functions only while the spell with split second is on the stack. “Split second” means “As long as this spell is on the stack, players can’t cast other spells or activate abilities that aren’t mana abilities.”',
  },
  { number: '702.4', text: 'Double Strike' },
  {
    number: '702.4a',
    text: 'Double strike is a static ability that modifies the rules for the combat damage step. (See rule 510, “Combat Damage Step.”)',
  },
  {
    number: '702.4b',
    text: 'If at least one attacking or blocking creature has first strike (see rule 702.7) or double strike as the combat damage step begins, the only creatures that assign combat damage in that step are those with first strike or double strike.',
  },
  { number: '702.143', text: 'Foretell' },
  {
    number: '702.143a',
    text: 'Foretell is a keyword that functions while the card with foretell is in a player’s hand. Any time a player has priority during their turn, that player may pay {2} and exile a card with foretell from their hand face down.',
  },
  {
    number: '702.143c',
    text: 'If an effect refers to foretelling a card, it means performing the special action associated with a foretell ability.',
  },
  { number: '702.164', text: 'Toxic' },
  {
    number: '702.164a',
    text: 'Toxic is a static ability. It is written “toxic N,” where N is a number.',
  },
  {
    number: '702.164b',
    text: 'Some rules and effects refer to a creature’s “total toxic value.” A creature’s total toxic value is the sum of all N values of toxic abilities that creature has.',
  },
  {
    number: '702.164c',
    text: 'Combat damage dealt to a player by a creature with toxic causes that creature’s controller to give the player a number of poison counters equal to that creature’s total toxic value, in addition to the damage’s other results. See rule 120.3.',
  },
  { number: '702.179', text: 'Max Speed' },
  {
    number: '702.179a',
    text: 'Max speed is a static ability. “Max speed — [Ability]” means “As long as your speed is 4, this object has ‘[Ability].’” See rule 702.179, “Start Your Engines!”',
  },
];

const kw = (name, rule, kind = 'ability') => ({ name, rule, kind });

describe('sentences', () => {
  it('does not end a sentence at a period inside quotes or parentheses', () => {
    expect(
      sentences(
        'Split second is a static ability. “Split second” means “As long as this spell is on the stack, players can’t cast other spells.”'
      )
    ).toEqual([
      'Split second is a static ability.',
      '“Split second” means “As long as this spell is on the stack, players can’t cast other spells.”',
    ]);
  });

  it('ends a sentence at a closing quote after a nested single quote', () => {
    expect(sentences('It means “this object has ‘[Ability].’” See rule 702.179.')).toEqual([
      'It means “this object has ‘[Ability].’”',
      'See rule 702.179.',
    ]);
  });
});

describe('operativeText', () => {
  it('prefers the rule’s own definition sentence', () => {
    expect(operativeText(RULES, kw('Split Second', '702.61'))).toBe(
      '“Split second” means “As long as this spell is on the stack, players can’t cast other spells or activate abilities that aren’t mana abilities.”'
    );
  });

  it('skips a classification ("… is an evasion ability.") and drops cross-references', () => {
    expect(operativeText(RULES, kw('Flying', '702.9'))).toBe(
      'A creature with flying can’t be blocked except by creatures with flying and/or reach. A creature with flying can block a creature with or without flying.'
    );
  });

  it('reads "it means" in an aside as prose, not as the definition', () => {
    const text = operativeText(RULES, kw('Foretell', '702.143'));
    expect(text).toMatch(/^Any time a player has priority during their turn/);
    expect(text).not.toMatch(/it means performing/);
  });

  it('follows an override to the subrule that says what the keyword does', () => {
    expect(operativeText(RULES, kw('Toxic', '702.164'))).toBe(
      'Combat damage dealt to a player by a creature with toxic causes that creature’s controller to give the player a number of poison counters equal to that creature’s total toxic value, in addition to the damage’s other results.'
    );
  });

  it('cuts a trailing "See rule …" off a definition', () => {
    expect(operativeText(RULES, kw('Max Speed', '702.179'))).toBe(
      '“Max speed — [Ability]” means “As long as your speed is 4, this object has ‘[Ability].’”'
    );
  });
});

describe('deriveKeywordGlossary', () => {
  const bundle = {
    meta: { effective: 'April 17, 2026', fetchedAt: '2026-09-14T00:00:00.000Z' },
    rules: RULES,
    glossary: [
      {
        term: 'Double Strike',
        definition:
          'A keyword ability that lets a creature deal its combat damage twice. See rule 702.4, “Double Strike.”',
      },
      { term: 'Gift', definition: 'A keyword ability. See rule 702.174, “Gift.”' },
    ],
    keywords: [
      kw('Flying', '702.9'),
      kw('Double Strike', '702.4'),
      kw('Gift', '702.174'),
      kw('Unknown', '702.999'),
    ],
  };
  const out = deriveKeywordGlossary(bundle);

  it('uses the glossary line where it is pinned, without its "See rule"', () => {
    expect(out.keywords.find((k) => k.name === 'Double Strike')?.text).toBe(
      'A keyword ability that lets a creature deal its combat damage twice.'
    );
  });

  it('falls back to the glossary when the rules have nothing to show, and drops a keyword with neither', () => {
    expect(out.keywords.find((k) => k.name === 'Gift')?.text).toBe('A keyword ability.');
    expect(out.keywords.some((k) => k.name === 'Unknown')).toBe(false);
  });

  it('carries the rule number, kind and edition through', () => {
    expect(out.meta).toEqual({
      effective: 'April 17, 2026',
      fetchedAt: '2026-09-14T00:00:00.000Z',
    });
    expect(out.keywords[0]).toMatchObject({ name: 'Flying', rule: '702.9', kind: 'ability' });
  });
});
