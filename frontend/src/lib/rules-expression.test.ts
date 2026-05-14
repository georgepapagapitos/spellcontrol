import { describe, it, expect } from 'vitest';
import {
  compileExpression,
  exactMatchesExpression,
  isExpressionEmpty,
  setMatchesExpression,
  substringMatchesExpression,
} from './rules';
import type { ChipExpression } from '../types';

/**
 * Tiny builder so test expressions read close to how a user would say them:
 *
 *   expr('IS Creature AND IS Land OR IS Sorcery')
 *
 * Tokens: IS / IS NOT followed by a value, joiners AND / OR between them.
 */
function expr(spec: string): ChipExpression {
  const chips: ChipExpression['chips'] = [];
  const joiners: ChipExpression['joiners'] = [];
  const tokens = spec.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length) {
    let negate = false;
    if (tokens[i] === 'IS' && tokens[i + 1] === 'NOT') {
      negate = true;
      i += 2;
    } else if (tokens[i] === 'IS') {
      i += 1;
    } else {
      throw new Error(`Expected IS / IS NOT at token ${i}: ${spec}`);
    }
    const value = tokens[i++];
    if (!value) throw new Error(`Missing value after operator in: ${spec}`);
    chips.push({ value, negate });
    if (i < tokens.length) {
      const j = tokens[i++];
      if (j !== 'AND' && j !== 'OR') throw new Error(`Expected AND/OR, got ${j}`);
      joiners.push(j);
    }
  }
  return { chips, joiners };
}

describe('isExpressionEmpty', () => {
  it('treats undefined as empty', () => {
    expect(isExpressionEmpty(undefined)).toBe(true);
  });
  it('treats no chips as empty', () => {
    expect(isExpressionEmpty({ chips: [], joiners: [] })).toBe(true);
  });
  it('treats all-blank chips as empty', () => {
    expect(isExpressionEmpty({ chips: [{ value: '   ', negate: false }], joiners: [] })).toBe(true);
  });
  it('treats a single non-blank chip as non-empty', () => {
    expect(isExpressionEmpty(expr('IS A'))).toBe(false);
  });
});

describe('compileExpression', () => {
  it('returns undefined for empty expression', () => {
    expect(compileExpression(undefined)).toBeUndefined();
    expect(compileExpression({ chips: [], joiners: [] })).toBeUndefined();
  });

  it('lowercases and trims chip values', () => {
    const out = compileExpression(expr('IS Creature'));
    expect(out).toEqual({ groups: [{ is: ['creature'], not: [] }] });
  });

  it('AND keeps chips in one group', () => {
    const out = compileExpression(expr('IS Creature AND IS Land'));
    expect(out).toEqual({ groups: [{ is: ['creature', 'land'], not: [] }] });
  });

  it('OR splits chips into separate groups', () => {
    const out = compileExpression(expr('IS Creature OR IS Land'));
    expect(out).toEqual({
      groups: [
        { is: ['creature'], not: [] },
        { is: ['land'], not: [] },
      ],
    });
  });

  it('AND binds tighter than OR — "a OR b AND c" is "a OR (b AND c)"', () => {
    const out = compileExpression(expr('IS A OR IS B AND IS C'));
    expect(out).toEqual({
      groups: [
        { is: ['a'], not: [] },
        { is: ['b', 'c'], not: [] },
      ],
    });
  });

  it('IS NOT lands in the `not` bucket of its group', () => {
    const out = compileExpression(expr('IS A AND IS NOT B'));
    expect(out).toEqual({ groups: [{ is: ['a'], not: ['b'] }] });
  });

  it('skips blank chips but preserves joiner positions', () => {
    const e: ChipExpression = {
      chips: [
        { value: 'creature', negate: false },
        { value: '   ', negate: false },
        { value: 'land', negate: false },
      ],
      joiners: ['AND', 'OR'],
    };
    // Blank chip is dropped from its AND-group; the OR after still splits.
    expect(compileExpression(e)).toEqual({
      groups: [
        { is: ['creature'], not: [] },
        { is: ['land'], not: [] },
      ],
    });
  });

  it('returns undefined if every chip is blank', () => {
    const e: ChipExpression = {
      chips: [
        { value: '   ', negate: false },
        { value: '', negate: false },
      ],
      joiners: ['OR'],
    };
    expect(compileExpression(e)).toBeUndefined();
  });

  it('tolerates a short joiners array (pads with AND)', () => {
    const e: ChipExpression = {
      chips: [
        { value: 'a', negate: false },
        { value: 'b', negate: false },
      ],
      joiners: [],
    };
    expect(compileExpression(e)).toEqual({ groups: [{ is: ['a', 'b'], not: [] }] });
  });
});

describe('substringMatchesExpression', () => {
  const e = (s: string) => compileExpression(expr(s))!;

  it('single IS chip matches when haystack contains it', () => {
    expect(substringMatchesExpression('Legendary Creature', e('IS Creature'))).toBe(true);
    expect(substringMatchesExpression('Sorcery', e('IS Creature'))).toBe(false);
  });

  it('AND requires every IS in the group to be present', () => {
    const compiled = e('IS Creature AND IS Land');
    expect(substringMatchesExpression('Creature Land — Forest', compiled)).toBe(true);
    expect(substringMatchesExpression('Creature — Beast', compiled)).toBe(false);
  });

  it('OR matches if any group matches', () => {
    const compiled = e('IS Creature OR IS Sorcery');
    expect(substringMatchesExpression('Creature — Goblin', compiled)).toBe(true);
    expect(substringMatchesExpression('Sorcery', compiled)).toBe(true);
    expect(substringMatchesExpression('Land', compiled)).toBe(false);
  });

  it('AND-tighter-than-OR: "a OR b AND c" is "a OR (b AND c)"', () => {
    // Use non-overlapping tokens so substring matching doesn't cross-contaminate.
    const compiled = e('IS xxx OR IS yyy AND IS zzz');
    // Matches: contains xxx (group 1), OR contains both yyy and zzz (group 2)
    expect(substringMatchesExpression('xxx solo', compiled)).toBe(true);
    expect(substringMatchesExpression('yyy zzz together', compiled)).toBe(true);
    expect(substringMatchesExpression('yyy solo', compiled)).toBe(false); // missing zzz
    expect(substringMatchesExpression('zzz solo', compiled)).toBe(false); // missing yyy
    expect(substringMatchesExpression('q r s', compiled)).toBe(false);
  });

  it('IS NOT inside an AND-group excludes haystacks that contain it', () => {
    const compiled = e('IS Creature AND IS NOT Legendary');
    expect(substringMatchesExpression('Creature — Beast', compiled)).toBe(true);
    expect(substringMatchesExpression('Legendary Creature — Dragon', compiled)).toBe(false);
  });

  it('different groups have independent IS NOT scopes', () => {
    const compiled = e('IS A AND IS NOT B OR IS C');
    // Group 1: contains a, not b. Group 2: contains c.
    expect(substringMatchesExpression('a only', compiled)).toBe(true);
    expect(substringMatchesExpression('a and b', compiled)).toBe(false);
    // Group 2 doesn't care about b — a card containing "c b" matches via group 2.
    expect(substringMatchesExpression('c and b', compiled)).toBe(true);
  });

  it('empty haystack with any IS chip fails', () => {
    expect(substringMatchesExpression('', e('IS Creature'))).toBe(false);
    expect(substringMatchesExpression(undefined, e('IS Creature'))).toBe(false);
  });

  it('empty haystack with only IS NOT chips passes (nothing to exclude matches)', () => {
    expect(substringMatchesExpression('', e('IS NOT Creature'))).toBe(true);
  });
});

describe('exactMatchesExpression', () => {
  const e = (s: string) => compileExpression(expr(s))!;

  it('matches when the single value equals an IS chip', () => {
    expect(exactMatchesExpression('rare', e('IS Rare'))).toBe(true);
    expect(exactMatchesExpression('common', e('IS Rare'))).toBe(false);
  });

  it('OR across single-valued fields matches when value equals any group', () => {
    const compiled = e('IS Rare OR IS Mythic');
    expect(exactMatchesExpression('rare', compiled)).toBe(true);
    expect(exactMatchesExpression('mythic', compiled)).toBe(true);
    expect(exactMatchesExpression('common', compiled)).toBe(false);
  });

  it('AND across two positives in a group is unsatisfiable on single-valued data', () => {
    const compiled = e('IS Rare AND IS Mythic');
    // A card has one rarity. By design no rarity can equal both — group fails;
    // since this is the only group, expression fails.
    expect(exactMatchesExpression('rare', compiled)).toBe(false);
    expect(exactMatchesExpression('mythic', compiled)).toBe(false);
  });

  it('IS NOT in a group rejects matching values', () => {
    const compiled = e('IS NOT Common');
    expect(exactMatchesExpression('rare', compiled)).toBe(true);
    expect(exactMatchesExpression('common', compiled)).toBe(false);
  });
});

describe('setMatchesExpression', () => {
  const e = (s: string) => compileExpression(expr(s))!;

  it('AND inside a group requires all members in the card set', () => {
    const compiled = e('IS Foil AND IS Etched');
    expect(setMatchesExpression(['foil', 'etched'], compiled)).toBe(true);
    expect(setMatchesExpression(['foil'], compiled)).toBe(false);
  });

  it('OR matches when any group is satisfied', () => {
    const compiled = e('IS Foil OR IS Etched');
    expect(setMatchesExpression(['foil'], compiled)).toBe(true);
    expect(setMatchesExpression(['etched'], compiled)).toBe(true);
    expect(setMatchesExpression(['nonfoil'], compiled)).toBe(false);
  });

  it('IS NOT excludes when the value is present in the set', () => {
    const compiled = e('IS Foil AND IS NOT Etched');
    expect(setMatchesExpression(['foil'], compiled)).toBe(true);
    expect(setMatchesExpression(['foil', 'etched'], compiled)).toBe(false);
  });

  it('accepts a Set directly', () => {
    const compiled = e('IS Foil');
    expect(setMatchesExpression(new Set(['foil']), compiled)).toBe(true);
    expect(setMatchesExpression(new Set([]), compiled)).toBe(false);
  });
});
