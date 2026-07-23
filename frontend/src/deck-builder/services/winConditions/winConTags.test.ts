import { describe, it, expect } from 'vitest';
import { tagOnlyWinCons, toggleWinConTag } from './winConTags';
import type { WinConditionAnalysis, WinCondition } from './types';

function wincon(overrides: Partial<WinCondition> = {}): WinCondition {
  return {
    category: 'burn',
    label: 'Burn',
    summary: '5 direct-damage spells',
    evidence: [],
    score: 5,
    ...overrides,
  };
}

function analysis(overrides: Partial<WinConditionAnalysis> = {}): WinConditionAnalysis {
  return {
    primary: null,
    secondary: [],
    noClearWinCondition: true,
    ...overrides,
  };
}

// ── tagOnlyWinCons ────────────────────────────────────────────────────────

describe('tagOnlyWinCons', () => {
  it('returns nothing when there are no tags', () => {
    const result = tagOnlyWinCons(analysis(), []);
    expect(result).toEqual([]);
  });

  it('excludes a tag already covered by the primary path (dedupe: engine wins)', () => {
    const result = tagOnlyWinCons(
      analysis({
        primary: wincon({ evidence: ['Fireball', 'Comet Storm'] }),
        noClearWinCondition: false,
      }),
      ['Fireball']
    );
    expect(result).toEqual([]);
  });

  it('excludes a tag already covered by a secondary path', () => {
    const result = tagOnlyWinCons(
      analysis({
        primary: wincon({ category: 'aristocrats', evidence: ['Blood Artist'] }),
        secondary: [wincon({ evidence: ['Exsanguinate'] })],
        noClearWinCondition: false,
      }),
      ['Exsanguinate']
    );
    expect(result).toEqual([]);
  });

  it('keeps a tagged card the engine never surfaced', () => {
    const result = tagOnlyWinCons(
      analysis({
        primary: wincon({ evidence: ['Fireball'] }),
        noClearWinCondition: false,
      }),
      ['Craterhoof Behemoth']
    );
    expect(result).toEqual(['Craterhoof Behemoth']);
  });

  it('surfaces tags even when the engine found no clear win condition', () => {
    const result = tagOnlyWinCons(analysis(), ['Triumph of the Hordes']);
    expect(result).toEqual(['Triumph of the Hordes']);
  });

  it('splits a mixed tag set into tag-only vs. engine-covered', () => {
    const result = tagOnlyWinCons(
      analysis({
        primary: wincon({ evidence: ['Fireball'] }),
        secondary: [wincon({ evidence: ['Exsanguinate'] })],
        noClearWinCondition: false,
      }),
      ['Fireball', 'Craterhoof Behemoth', 'Exsanguinate', 'Villainous Wealth']
    );
    expect(result).toEqual(['Craterhoof Behemoth', 'Villainous Wealth']);
  });

  it('de-duplicates and preserves first-seen order', () => {
    const result = tagOnlyWinCons(analysis(), [
      'Craterhoof Behemoth',
      'Overrun',
      'Craterhoof Behemoth',
    ]);
    expect(result).toEqual(['Craterhoof Behemoth', 'Overrun']);
  });
});

// ── toggleWinConTag ───────────────────────────────────────────────────────

describe('toggleWinConTag', () => {
  it('adds a name to an undefined list', () => {
    expect(toggleWinConTag(undefined, 'Craterhoof Behemoth')).toEqual(['Craterhoof Behemoth']);
  });

  it('appends a new name to an existing list', () => {
    expect(toggleWinConTag(['Fireball'], 'Craterhoof Behemoth')).toEqual([
      'Fireball',
      'Craterhoof Behemoth',
    ]);
  });

  it('removes a name already in the list (toggle off)', () => {
    expect(toggleWinConTag(['Fireball', 'Craterhoof Behemoth'], 'Fireball')).toEqual([
      'Craterhoof Behemoth',
    ]);
  });

  it('does not mutate the input array', () => {
    const input = ['Fireball'];
    toggleWinConTag(input, 'Craterhoof Behemoth');
    expect(input).toEqual(['Fireball']);
  });
});
