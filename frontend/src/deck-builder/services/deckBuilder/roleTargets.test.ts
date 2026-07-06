import { describe, it, expect } from 'vitest';
import {
  inferArchetype,
  inferArchetypeFromEdhrecThemes,
  getDynamicRoleTargets,
  isBoardCentricPlan,
} from './roleTargets';
import { Archetype } from '@/deck-builder/types';
import type { ThemeResult, EDHRECTheme } from '@/deck-builder/types';

function theme(name: string, isSelected = true): ThemeResult {
  return { name, source: 'edhrec', isSelected };
}

function edhrecTheme(name: string, count: number): EDHRECTheme {
  return {
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    count,
    url: '',
    popularityPercent: 0,
  };
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

  it('sticks with GOODSTUFF when the theme explicitly carries that archetype (does not discard an explicit pick)', () => {
    const explicit: ThemeResult = {
      name: 'whatever',
      source: 'edhrec',
      isSelected: true,
      archetype: Archetype.GOODSTUFF,
    };
    expect(inferArchetype([explicit], Archetype.TRIBAL)).toBe(Archetype.GOODSTUFF);
  });
});

describe('inferArchetypeFromEdhrecThemes', () => {
  it('returns undefined with no themes', () => {
    expect(inferArchetypeFromEdhrecThemes(undefined)).toBeUndefined();
    expect(inferArchetypeFromEdhrecThemes([])).toBeUndefined();
  });

  it('picks the top-ranked (already count-sorted) theme that maps to a real archetype', () => {
    // Sythis-shaped fixture: EDHREC's own top theme is Enchantress, not the
    // keyword-vote-derived "spellslinger" mislabel.
    const themes = [edhrecTheme('Enchantress', 900), edhrecTheme('Lifegain', 300)];
    expect(inferArchetypeFromEdhrecThemes(themes)).toBe(Archetype.ENCHANTRESS);
  });

  it('does not let a minority real-archetype tag beat a dominant GOODSTUFF-mapped one', () => {
    // Superfriends dominates this page (900/1100 = 82%); Voltron is only a
    // minor secondary tag (200/1100 = 18%). No single dominant strategy here
    // (structurally the same shape as the Atraxa split-strategy case below),
    // so this should no longer confidently declare VOLTRON.
    const themes = [edhrecTheme('Superfriends', 900), edhrecTheme('Voltron', 200)];
    expect(inferArchetypeFromEdhrecThemes(themes)).toBeUndefined();
  });

  it('returns undefined when nothing maps to a real archetype', () => {
    const themes = [edhrecTheme('Superfriends', 900), edhrecTheme('Chaos', 100)];
    expect(inferArchetypeFromEdhrecThemes(themes)).toBeUndefined();
  });

  it('classifies a Yuriko-class (ninjutsu) commander as tempo, not goodstuff/aristocrats/aggro', () => {
    const themes = [edhrecTheme('Ninjutsu', 800), edhrecTheme('Unblockable', 400)];
    expect(inferArchetypeFromEdhrecThemes(themes)).toBe(Archetype.TEMPO);
  });

  it('rejects a top real-archetype theme that is not a clear plurality (Atraxa-shaped: split strategies)', () => {
    const themes = [
      edhrecTheme('Infect', 400),
      edhrecTheme('Superfriends', 350),
      edhrecTheme('Counters', 300),
      edhrecTheme('Voltron', 150),
    ]; // Infect share = 400/1200 ≈ 33%, below DOMINANT_THEME_SHARE
    expect(inferArchetypeFromEdhrecThemes(themes)).toBeUndefined();
  });

  it('accepts a top real-archetype theme that clears the dominance bar (same shape, higher leading count)', () => {
    const themes = [
      edhrecTheme('Infect', 600),
      edhrecTheme('Superfriends', 200),
      edhrecTheme('Counters', 250),
      edhrecTheme('Voltron', 150),
    ]; // Infect share = 600/1200 = 50%, clearly above DOMINANT_THEME_SHARE
    expect(inferArchetypeFromEdhrecThemes(themes)).toBe(Archetype.AGGRO);
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

  it('applies the tempo multipliers (less ramp/boardwipe, more removal/cardDraw than baseline)', () => {
    const goodstuff = getDynamicRoleTargets(99, [theme('some-unmapped-theme')]);
    const tempo = getDynamicRoleTargets(99, [theme('ninjutsu')]);
    expect(tempo.archetype).toBe(Archetype.TEMPO);
    expect(tempo.targets.ramp).toBeLessThan(goodstuff.targets.ramp);
    expect(tempo.targets.boardwipe).toBeLessThan(goodstuff.targets.boardwipe);
    expect(tempo.targets.removal).toBeGreaterThan(goodstuff.targets.removal);
    expect(tempo.targets.cardDraw).toBeGreaterThan(goodstuff.targets.cardDraw);
  });
});

// isBoardCentricPlan (E109): gates both the wipe-target shave and the
// wipe-selection preference in deckGenerator.ts. Two independent signals —
// go-wide archetype membership, or a creature-dense type target the
// archetype vote missed (a split-strategy commander defaults to GOODSTUFF).
describe('isBoardCentricPlan', () => {
  it.each([Archetype.TOKENS, Archetype.TRIBAL, Archetype.ARISTOCRATS, Archetype.AGGRO])(
    'trips on the %s archetype regardless of creature density',
    (archetype) => {
      expect(isBoardCentricPlan(archetype, { creature: 5, instant: 20, sorcery: 20 })).toBe(true);
    }
  );

  it.each([Archetype.SPELLSLINGER, Archetype.CONTROL, Archetype.STORM])(
    'does not trip on %s alone at low creature density (Talrand/Kozilek-shaped)',
    (archetype) => {
      // ~24% creature share — well under the 0.45 threshold.
      expect(isBoardCentricPlan(archetype, { creature: 15, instant: 25, sorcery: 22 })).toBe(false);
    }
  );

  it('trips on GOODSTUFF when the type-target creature share is dense enough (Atraxa-shaped split-strategy default)', () => {
    // 30/62 ≈ 48% creature share — above the 0.45 threshold.
    expect(
      isBoardCentricPlan(Archetype.GOODSTUFF, { creature: 30, instant: 16, sorcery: 16 })
    ).toBe(true);
  });

  it('does not trip on GOODSTUFF at an ordinary/baseline creature share', () => {
    // 25/62 ≈ 40% — the generic rawTypeWeights baseline, below the 0.45 bar.
    expect(
      isBoardCentricPlan(Archetype.GOODSTUFF, { creature: 25, instant: 19, sorcery: 18 })
    ).toBe(false);
  });

  it('is inert on an empty type-target map (no nonland total to divide by)', () => {
    expect(isBoardCentricPlan(Archetype.GOODSTUFF, {})).toBe(false);
  });
});
