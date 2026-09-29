import { describe, it, expect } from 'vitest';
import {
  inferArchetype,
  inferArchetypeFromEdhrecThemes,
  getDynamicRoleTargets,
  isBoardCentricPlan,
  cardEvidencePool,
  decideBuildArchetype,
  isCommanderEdhrecPool,
  readCardEvidence,
  readEdhrecThemeHint,
  weightedAxisMass,
  EVIDENCE_MIN_COVERAGE,
  type CardEvidence,
} from './roleTargets';
import { readEngine, type AxisMass } from './strategyVocabulary';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { CORPUS } from '@/deck-builder/services/synergy/classify.fixtures';
import { Archetype } from '@/deck-builder/types';
import type {
  ThemeResult,
  EDHRECTheme,
  EDHRECCard,
  EDHRECCommanderData,
} from '@/deck-builder/types';

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
// wipe-selection preference in deckGenerator.ts. Three independent signals —
// go-wide archetype membership, a creature-dense type target the archetype
// vote missed (a split-strategy commander defaults to GOODSTUFF), or an
// attack-trigger commander (E109 fix round: Isshin's own archetype vote
// lands GOODSTUFF — its top EDHREC theme holds only 31.6% — and its PLANNED
// creature density undercounts what it actually delivers, so neither of the
// first two signals sees it).
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

  it('trips on an attack-trigger commander (Isshin-shaped) even at GOODSTUFF archetype and low creature density', () => {
    // 0.44 planned density — under the 0.45 bar, and GOODSTUFF isn't in the
    // go-wide set — neither of the other two signals would trip here.
    expect(
      isBoardCentricPlan(
        Archetype.GOODSTUFF,
        { creature: 27, instant: 17, sorcery: 17 },
        true // attackTriggerCommander
      )
    ).toBe(true);
  });

  it('does not let the attack-trigger clause trip when the commander is not one (default false)', () => {
    expect(
      isBoardCentricPlan(Archetype.GOODSTUFF, { creature: 27, instant: 17, sorcery: 17 })
    ).toBe(false);
  });

  it('does not lower the density bar for kozilek/yuriko-shaped decks just under 0.45 (no attack-trigger signal)', () => {
    // 0.436 and 0.443 delivered densities from live-panel evidence — both
    // correctly stay under the bar and neither is an attack-trigger commander.
    expect(
      isBoardCentricPlan(Archetype.GOODSTUFF, { creature: 27, instant: 17.5, sorcery: 17.5 }, false)
    ).toBe(false);
  });
});

// ─── E511: themes come from the cards ──────────────────────────────

const card = (name: string) => {
  const c = CORPUS.find((x) => x.name === name);
  if (!c) throw new Error(`no corpus card ${name}`);
  return c;
};

const mass = (axis: AxisMass['axis'], producers: number, payoffs: number): AxisMass => ({
  axis,
  producers,
  payoffs,
});

const evidence = (...axes: AxisMass[]): CardEvidence => ({ read: readEngine(axes), coverage: 1 });

describe('readEdhrecThemeHint', () => {
  it('sums themes that build one strategy before the dominance test (E417, Sram-shaped)', () => {
    // No single tag reaches 38%, but Equipment + Voltron + Auras is one Voltron vote.
    const themes = [
      edhrecTheme('Tokens', 500),
      edhrecTheme('Equipment', 400),
      edhrecTheme('Voltron', 300),
      edhrecTheme('Artifacts', 300),
      edhrecTheme('Auras', 250),
    ];
    const hint = readEdhrecThemeHint(themes);
    expect(hint?.archetype).toBe(Archetype.VOLTRON);
    expect(hint?.dominant).toBe(true);
    expect(hint?.themeNames).toEqual(['Equipment', 'Voltron', 'Auras']);
    expect(inferArchetypeFromEdhrecThemes(themes)).toBe(Archetype.VOLTRON);
  });

  it('keeps value themes apart, as readEngine keeps value axes apart', () => {
    const themes = [
      edhrecTheme('Tokens', 400),
      edhrecTheme('+1/+1 Counters', 300),
      edhrecTheme('Lifegain', 300),
      edhrecTheme('Blink', 300),
    ];
    const hint = readEdhrecThemeHint(themes);
    expect(hint?.archetype).toBe(Archetype.TOKENS);
    expect(hint?.dominant).toBe(false); // 400 / 1300
    expect(inferArchetypeFromEdhrecThemes(themes)).toBeUndefined();
  });

  it('reads every typal name as one Tribal vote', () => {
    const hint = readEdhrecThemeHint([
      edhrecTheme('Vampires', 600),
      edhrecTheme('Lifegain', 300),
      edhrecTheme('Knights', 100),
      edhrecTheme('Bats', 50),
    ]);
    expect(hint).toMatchObject({ archetype: Archetype.TRIBAL, dominant: true });
    expect(hint?.themeNames).toEqual(['Vampires', 'Knights', 'Bats']);
  });

  it('is undefined when nothing on the page maps', () => {
    expect(
      readEdhrecThemeHint([edhrecTheme('Legends', 100), edhrecTheme('Historic', 50)])
    ).toBeUndefined();
    expect(readEdhrecThemeHint(undefined)).toBeUndefined();
  });
});

describe('card evidence: the average deck, read like a finished list', () => {
  it('matches analyzeDeckSynergy exactly at weight 1', () => {
    const list = CORPUS.slice(0, 60);
    const fromDeck = analyzeDeckSynergy(list).axes.map((a) => ({
      axis: a.axis,
      producers: a.producers.length,
      payoffs: a.payoffs.length,
    }));
    const weighted = weightedAxisMass(list.map((c) => ({ card: c, weight: 1 }))).map(
      ({ axis, producers, payoffs }) => ({ axis, producers, payoffs })
    );
    const byAxis = (xs: AxisMass[]) => [...xs].sort((a, b) => a.axis.localeCompare(b.axis));
    expect(byAxis(weighted)).toEqual(byAxis(fromDeck));
  });

  it('weights each pool card by inclusion and the commander by 1', () => {
    const krenko = card('Krenko, Mob Boss');
    const cards = new Map([
      ['Goblin King', card('Goblin King')],
      ['Secure the Wastes', card('Secure the Wastes')],
    ]);
    const ev = readCardEvidence({
      commanders: [krenko],
      pool: [
        { name: 'Goblin King', inclusion: 50 },
        { name: 'Secure the Wastes', inclusion: 20 },
      ],
      cards,
    });
    const axes = new Map(ev!.read.ranked.flatMap((r) => r.axes.map((a) => [a.axis, a])));
    // Krenko (weight 1): tokens producer and tribal payoff. Goblin King (0.5):
    // tribal payoff. Secure the Wastes (0.2): tokens producer.
    expect(axes.get('tokens')).toMatchObject({ producers: 1.2, payoffs: 0 });
    expect(axes.get('tribal')).toMatchObject({ producers: 0, payoffs: 1.5 });
    expect(ev!.coverage).toBe(1);
  });

  it('declines to read a pool that mostly failed to load', () => {
    const cards = new Map([['Goblin King', card('Goblin King')]]);
    expect(EVIDENCE_MIN_COVERAGE).toBeGreaterThan(0.7);
    expect(
      readCardEvidence({
        commanders: [],
        pool: [
          { name: 'Goblin King', inclusion: 70 },
          { name: 'Unfetched Card', inclusion: 30 },
        ],
        cards,
      })
    ).toBeUndefined();
    expect(
      readCardEvidence({
        commanders: [],
        pool: [
          { name: 'Goblin King', inclusion: 90 },
          { name: 'Unfetched Card', inclusion: 10 },
        ],
        cards,
      })?.coverage
    ).toBeCloseTo(0.9);
  });

  it('finds a double-faced pool card under its front-face key', () => {
    const cards = new Map([['Goblin King', card('Goblin King')]]);
    const ev = readCardEvidence({
      commanders: [],
      pool: [{ name: 'Goblin King // Some Back Face', inclusion: 40 }],
      cards,
    });
    expect(ev?.coverage).toBe(1);
  });

  it("pools the commander page's nonland and land lists, minus injected cards", () => {
    const entry = (
      name: string,
      inclusion: number,
      extra: Partial<EDHRECCard> = {}
    ): EDHRECCard => ({
      name,
      sanitized: name,
      primary_type: 'Creature',
      inclusion,
      num_decks: 1,
      ...extra,
    });
    const data = {
      cardlists: {
        allNonLand: [
          entry('Goblin King', 50),
          entry('Goblin King', 50),
          entry('Blended In', 30, { blendSource: 'archetype-blend' }),
        ],
        lands: [entry('Cavern of Souls', 40)],
      },
    } as unknown as EDHRECCommanderData;
    expect(cardEvidencePool(data)).toEqual([
      { name: 'Goblin King', inclusion: 50 },
      { name: 'Cavern of Souls', inclusion: 40 },
    ]);
  });

  it("reads only the commander's own EDHREC pages", () => {
    for (const s of ['theme+bracket', 'theme', 'base+bracket', 'base'] as const)
      expect(isCommanderEdhrecPool(s)).toBe(true);
    for (const s of [
      'scryfall',
      'paupercommander',
      'oracle-role',
      'art-theme',
      'historical',
    ] as const)
      expect(isCommanderEdhrecPool(s)).toBe(false);
    expect(isCommanderEdhrecPool(undefined)).toBe(false);
  });
});

describe('decideBuildArchetype', () => {
  const base = { oracleTextArchetype: Archetype.VOLTRON };

  it("lets the user's theme pick win over every read", () => {
    const d = decideBuildArchetype({
      ...base,
      selectedThemes: [theme('tokens')],
      cardEvidence: evidence(mass('sacrifice', 12, 8)),
    });
    expect(d).toMatchObject({
      archetype: Archetype.TOKENS,
      provenance: 'user-theme',
      isLowConfidence: false,
    });
    expect(d.fallback).toBe(Archetype.ARISTOCRATS);
  });

  it('builds from a decisive engine and reports it as expected counts', () => {
    const d = decideBuildArchetype({
      ...base,
      edhrecThemes: [edhrecTheme('Tokens', 900)],
      cardEvidence: evidence(mass('sacrifice', 12.4, 8.6), mass('tokens', 4, 2)),
    });
    expect(d).toMatchObject({ archetype: Archetype.ARISTOCRATS, provenance: 'card-evidence' });
    expect(d.evidence).toEqual({ axis: 'sacrifice', producers: 12.4, payoffs: 8.6 });
  });

  it("takes EDHREC's dominant strategy between comparable engines (Meren-shaped)", () => {
    const d = decideBuildArchetype({
      ...base,
      edhrecThemes: [edhrecTheme('Reanimator', 600), edhrecTheme('Aristocrats', 400)],
      // 18 against 10: the sacrifice engine leads, but not by 2x.
      cardEvidence: evidence(mass('sacrifice', 12, 6), mass('graveyard', 4, 6)),
    });
    expect(d).toMatchObject({ archetype: Archetype.REANIMATOR, provenance: 'edhrec-dominant' });
  });

  it('keeps a dominant theme no axis can read (Yuriko-shaped Ninjutsu)', () => {
    const d = decideBuildArchetype({
      ...base,
      edhrecThemes: [edhrecTheme('Ninjutsu', 800), edhrecTheme('Unblockable', 400)],
      cardEvidence: evidence(mass('discard', 3, 0), mass('graveyard', 1, 2)),
    });
    expect(d).toMatchObject({ archetype: Archetype.TEMPO, provenance: 'edhrec-dominant' });
  });

  it('drops a dominant theme the cards can read but do not show', () => {
    // 'Infect' is read by the poison axis, and this average deck runs no poison engine.
    const d = decideBuildArchetype({
      ...base,
      edhrecThemes: [edhrecTheme('Infect', 800), edhrecTheme('Superfriends', 300)],
      cardEvidence: evidence(mass('superfriends', 17, 2), mass('poison', 1, 0.5)),
    });
    expect(d).toMatchObject({
      archetype: Archetype.GOODSTUFF,
      provenance: 'neutral',
      isLowConfidence: true,
    });
  });

  it("builds from the cards' leader when EDHREC's own leader agrees (Edgar-shaped)", () => {
    const d = decideBuildArchetype({
      ...base,
      // Vampires lead the page but hold under 38% of it.
      edhrecThemes: [
        edhrecTheme('Vampires', 600),
        edhrecTheme('Lifegain', 320),
        edhrecTheme('Tokens', 220),
        edhrecTheme('Aristocrats', 200),
        edhrecTheme('Aggro', 160),
        edhrecTheme('+1/+1 Counters', 150),
      ],
      cardEvidence: evidence(
        mass('tribal', 5, 17),
        mass('sacrifice', 6, 6),
        mass('lifegain', 9, 2)
      ),
    });
    expect(d).toMatchObject({ archetype: Archetype.TRIBAL, provenance: 'card-evidence' });
    expect(d.evidence).toEqual({ axis: 'tribal', producers: 5, payoffs: 17 });
  });

  it('falls back to EDHREC alone when the cards could not be read', () => {
    const d = decideBuildArchetype({ ...base, edhrecThemes: [edhrecTheme('Enchantress', 900)] });
    expect(d).toMatchObject({ archetype: Archetype.ENCHANTRESS, provenance: 'edhrec-dominant' });
  });

  it("uses the commander's keyword vote only with no EDHREC data at all", () => {
    expect(decideBuildArchetype(base)).toMatchObject({
      archetype: Archetype.VOLTRON,
      provenance: 'oracle-text',
      isLowConfidence: true,
    });
  });

  it('marks a neutral build low-confidence only when no theme was selected', () => {
    const themes = [
      edhrecTheme('Tokens', 300),
      edhrecTheme('Lifegain', 300),
      edhrecTheme('Blink', 300),
    ];
    expect(decideBuildArchetype({ ...base, edhrecThemes: themes }).isLowConfidence).toBe(true);
    const unmapped = decideBuildArchetype({
      ...base,
      edhrecThemes: themes,
      selectedThemes: [theme('some-unmapped-theme')],
    });
    expect(unmapped).toMatchObject({ archetype: Archetype.GOODSTUFF, provenance: 'neutral' });
    expect(unmapped.isLowConfidence).toBe(false);
  });
});
