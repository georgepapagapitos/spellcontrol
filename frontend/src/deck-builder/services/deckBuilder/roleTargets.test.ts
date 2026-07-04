import { describe, it, expect } from 'vitest';
import { inferArchetype, getDynamicRoleTargets } from './roleTargets';
import { Archetype } from '@/deck-builder/types';
import type { ThemeResult } from '@/deck-builder/types';

function theme(name: string, isSelected = true): ThemeResult {
  return { name, source: 'edhrec', isSelected };
}

describe('inferArchetype', () => {
  it('returns GOODSTUFF with no fallback and no themes (historical behavior)', () => {
    expect(inferArchetype(undefined)).toBe(Archetype.GOODSTUFF);
    expect(inferArchetype([])).toBe(Archetype.GOODSTUFF);
  });

  it('falls back to the given archetype (e.g. a tribal commander profile) when there are no themes', () => {
    expect(inferArchetype(undefined, Archetype.TRIBAL)).toBe(Archetype.TRIBAL);
    expect(inferArchetype([], Archetype.TRIBAL)).toBe(Archetype.TRIBAL);
  });

  it('falls back when the only themes present are unselected', () => {
    expect(inferArchetype([theme('tokens', false)], Archetype.TRIBAL)).toBe(Archetype.TRIBAL);
  });

  it('lets a selected theme that maps to a real archetype win over the fallback', () => {
    expect(inferArchetype([theme('tokens')], Archetype.TRIBAL)).toBe(Archetype.TOKENS);
  });

  it('falls back when the selected theme maps to GOODSTUFF (unknown theme name)', () => {
    expect(inferArchetype([theme('some-unmapped-theme')], Archetype.ENCHANTRESS)).toBe(
      Archetype.ENCHANTRESS
    );
  });

  it('falls back even when the theme explicitly carries an archetype of GOODSTUFF', () => {
    const explicit: ThemeResult = {
      name: 'whatever',
      source: 'edhrec',
      isSelected: true,
      archetype: Archetype.GOODSTUFF,
    };
    expect(inferArchetype([explicit], Archetype.TRIBAL)).toBe(Archetype.TRIBAL);
  });
});

describe('getDynamicRoleTargets archetype threading', () => {
  it('uses GOODSTUFF role math when no themes and no primaryArchetype are given', () => {
    const result = getDynamicRoleTargets(99, undefined);
    expect(result.archetype).toBe(Archetype.GOODSTUFF);
  });

  it('falls back to the commander profile archetype (e.g. tribal) when no themes are selected', () => {
    const result = getDynamicRoleTargets(
      99,
      undefined,
      undefined,
      null,
      null,
      null,
      Archetype.TRIBAL
    );
    expect(result.archetype).toBe(Archetype.TRIBAL);
  });

  it('still lets a selected theme win over the primaryArchetype fallback', () => {
    const result = getDynamicRoleTargets(
      99,
      [theme('spellslinger')],
      undefined,
      null,
      null,
      null,
      Archetype.TRIBAL
    );
    expect(result.archetype).toBe(Archetype.SPELLSLINGER);
  });
});
