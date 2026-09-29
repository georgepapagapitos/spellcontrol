import { describe, it, expect } from 'vitest';
import { Archetype } from '@/deck-builder/types';
import {
  THEME_TO_ARCHETYPE,
  THEME_TO_AXES,
  ARCHETYPE_LABEL,
  AXIS_TO_ARCHETYPE,
  axisMassFrom,
  engineLeader,
  isEngineContender,
  nonStrategyReason,
  readEngine,
  themeArchetype,
  themeAxes,
  typalArchetype,
  type AxisMass,
} from './strategyVocabulary';
import { resolveCreatureType } from '@/deck-builder/services/synergy/text';
import { classifyCard } from '@/deck-builder/services/synergy/classify';
import { CORPUS } from '@/deck-builder/services/synergy/classify.fixtures';

// Verbatim snapshot of the theme→archetype map as it existed when it lived
// inline in roleTargets.ts. Guards against accidental edits that would silently
// shift role targeting for a theme.
const EXPECTED_THEME_TO_ARCHETYPE: Record<string, Archetype> = {
  aggro: Archetype.AGGRO,
  combat: Archetype.AGGRO,
  'extra combat': Archetype.AGGRO,
  infect: Archetype.AGGRO,
  poison: Archetype.AGGRO,
  control: Archetype.CONTROL,
  stax: Archetype.CONTROL,
  pillowfort: Archetype.CONTROL,
  combo: Archetype.COMBO,
  'extra turns': Archetype.COMBO,
  voltron: Archetype.VOLTRON,
  equipment: Archetype.VOLTRON,
  auras: Archetype.VOLTRON,
  spellslinger: Archetype.SPELLSLINGER,
  cantrips: Archetype.SPELLSLINGER,
  ninjutsu: Archetype.TEMPO,
  ninjas: Archetype.TEMPO,
  unblockable: Archetype.TEMPO,
  tokens: Archetype.TOKENS,
  'go wide': Archetype.TOKENS,
  aristocrats: Archetype.ARISTOCRATS,
  sacrifice: Archetype.ARISTOCRATS,
  lifedrain: Archetype.ARISTOCRATS,
  reanimator: Archetype.REANIMATOR,
  graveyard: Archetype.REANIMATOR,
  // mill: Archetype.REANIMATOR was re-ruled non-strategy by E511 (opponent mill).
  dredge: Archetype.REANIMATOR,
  flashback: Archetype.REANIMATOR,
  landfall: Archetype.LANDFALL,
  lands: Archetype.LANDFALL,
  artifacts: Archetype.ARTIFACTS,
  treasures: Archetype.ARTIFACTS,
  vehicles: Archetype.ARTIFACTS,
  clues: Archetype.ARTIFACTS,
  food: Archetype.ARTIFACTS,
  enchantress: Archetype.ENCHANTRESS,
  enchantments: Archetype.ENCHANTRESS,
  constellation: Archetype.ENCHANTRESS,
  storm: Archetype.STORM,
  tribal: Archetype.TRIBAL,
  elves: Archetype.TRIBAL,
  goblins: Archetype.TRIBAL,
  zombies: Archetype.TRIBAL,
  vampires: Archetype.TRIBAL,
  dragons: Archetype.TRIBAL,
  angels: Archetype.TRIBAL,
  demons: Archetype.TRIBAL,
  wizards: Archetype.TRIBAL,
  warriors: Archetype.TRIBAL,
  rogues: Archetype.TRIBAL,
  clerics: Archetype.TRIBAL,
  soldiers: Archetype.TRIBAL,
  knights: Archetype.TRIBAL,
  merfolk: Archetype.TRIBAL,
  spirits: Archetype.TRIBAL,
  dinosaurs: Archetype.TRIBAL,
  pirates: Archetype.TRIBAL,
  cats: Archetype.TRIBAL,
  dogs: Archetype.TRIBAL,
  beasts: Archetype.TRIBAL,
  elementals: Archetype.TRIBAL,
  slivers: Archetype.TRIBAL,
  allies: Archetype.TRIBAL,
  humans: Archetype.TRIBAL,
  '+1/+1 counters': Archetype.MIDRANGE,
  '-1/-1 counters': Archetype.MIDRANGE,
  counters: Archetype.MIDRANGE,
  proliferate: Archetype.MIDRANGE,
  blink: Archetype.MIDRANGE,
  flicker: Archetype.MIDRANGE,
  etb: Archetype.MIDRANGE,
  clones: Archetype.MIDRANGE,
  copy: Archetype.MIDRANGE,
  lifegain: Archetype.MIDRANGE,
  energy: Archetype.MIDRANGE,
  cascade: Archetype.MIDRANGE,
  monarch: Archetype.MIDRANGE,
  superfriends: Archetype.GOODSTUFF,
  planeswalkers: Archetype.GOODSTUFF,
  chaos: Archetype.GOODSTUFF,
  politics: Archetype.GOODSTUFF,
  wheels: Archetype.GOODSTUFF,
  discard: Archetype.GOODSTUFF,
  tutors: Archetype.GOODSTUFF,
};

// E511: the entries added for EDHREC tags the vocabulary lacked (see
// edhrecTags.fixtures.ts). Kept apart so the pre-E511 map above stays verbatim.
const E511_ADDITIONS: Record<string, Archetype> = {
  'lands matter': Archetype.LANDFALL,
  treasure: Archetype.ARTIFACTS,
  'extra combats': Archetype.AGGRO,
  'pillow fort': Archetype.CONTROL,
  'counters matter': Archetype.MIDRANGE,
  'group hug': Archetype.GOODSTUFF,
  'good stuff': Archetype.GOODSTUFF,
  midrange: Archetype.MIDRANGE,
  tempo: Archetype.TEMPO,
  burn: Archetype.AGGRO,
  'attack triggers': Archetype.AGGRO,
  stompy: Archetype.AGGRO,
  zoo: Archetype.AGGRO,
  weenies: Archetype.AGGRO,
  saboteurs: Archetype.AGGRO,
  hatebears: Archetype.CONTROL,
  'land destruction': Archetype.CONTROL,
  counterspells: Archetype.CONTROL,
  flash: Archetype.CONTROL,
  aikido: Archetype.CONTROL,
  prison: Archetype.CONTROL,
  creatureless: Archetype.CONTROL,
  'turbo fog': Archetype.CONTROL,
  'tap / untap': Archetype.COMBO,
  cheerios: Archetype.COMBO,
  eggs: Archetype.COMBO,
  doomsday: Archetype.COMBO,
  bounce: Archetype.TEMPO,
  sneak: Archetype.TEMPO,
  'modified creatures': Archetype.VOLTRON,
  exalted: Archetype.VOLTRON,
  stoneblade: Archetype.VOLTRON,
  heroic: Archetype.VOLTRON,
  'spell copy': Archetype.SPELLSLINGER,
  prowess: Archetype.SPELLSLINGER,
  populate: Archetype.TOKENS,
  anthems: Archetype.TOKENS,
  amass: Archetype.TOKENS,
  convoke: Archetype.TOKENS,
  'spore counters': Archetype.TOKENS,
  squad: Archetype.TOKENS,
  exploit: Archetype.ARISTOCRATS,
  'self-mill': Archetype.REANIMATOR,
  surveil: Archetype.REANIMATOR,
  delirium: Archetype.REANIMATOR,
  descend: Archetype.REANIMATOR,
  'land animation': Archetype.LANDFALL,
  guildgates: Archetype.LANDFALL,
  deserts: Archetype.LANDFALL,
  affinity: Archetype.ARTIFACTS,
  modular: Archetype.ARTIFACTS,
  blood: Archetype.ARTIFACTS,
  improvise: Archetype.ARTIFACTS,
  incubate: Archetype.ARTIFACTS,
  servos: Archetype.ARTIFACTS,
  sagas: Archetype.ENCHANTRESS,
  shrines: Archetype.ENCHANTRESS,
  curses: Archetype.ENCHANTRESS,
  rooms: Archetype.ENCHANTRESS,
  cycling: Archetype.MIDRANGE,
  dungeon: Archetype.MIDRANGE,
  discover: Archetype.MIDRANGE,
  rock: Archetype.MIDRANGE,
  'ltb effects': Archetype.MIDRANGE,
  'group slug': Archetype.GOODSTUFF,
  theft: Archetype.GOODSTUFF,
  'forced combat': Archetype.GOODSTUFF,
  toolbox: Archetype.GOODSTUFF,
  donate: Archetype.GOODSTUFF,
  voting: Archetype.GOODSTUFF,
  'self-discard': Archetype.GOODSTUFF,
  madness: Archetype.GOODSTUFF,
  looting: Archetype.GOODSTUFF,
  'die roll': Archetype.GOODSTUFF,
  'coin flip': Archetype.GOODSTUFF,
  'sea creatures': Archetype.TRIBAL,
  party: Archetype.TRIBAL,
  outlaws: Archetype.TRIBAL,
  spacecraft: Archetype.ARTIFACTS,
  arcane: Archetype.SPELLSLINGER,
  cephalids: Archetype.TRIBAL,
};

describe('strategyVocabulary', () => {
  it('keeps the theme→archetype map stable', () => {
    expect(THEME_TO_ARCHETYPE).toEqual({ ...EXPECTED_THEME_TO_ARCHETYPE, ...E511_ADDITIONS });
  });

  it('adds E511 entries without re-ruling a pre-E511 one', () => {
    for (const key of Object.keys(E511_ADDITIONS)) {
      expect(EXPECTED_THEME_TO_ARCHETYPE).not.toHaveProperty([key]);
    }
  });

  it('uses lowercased theme keys (the lookup contract everywhere)', () => {
    for (const key of Object.keys(THEME_TO_ARCHETYPE)) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  it('has a display label for every archetype', () => {
    for (const arch of Object.values(Archetype)) {
      expect(ARCHETYPE_LABEL[arch]).toBeTruthy();
    }
  });

  it('gives every named theme an axis ruling, and each axis confirms only its own archetype', () => {
    // A tribe name needs no entry: the typal rule gives it the tribal axis.
    for (const theme of Object.keys(THEME_TO_ARCHETYPE)) {
      expect([theme, theme in THEME_TO_AXES || !!resolveCreatureType(theme)]).toEqual([
        theme,
        true,
      ]);
    }
    for (const theme of Object.keys(THEME_TO_AXES))
      expect(THEME_TO_ARCHETYPE).toHaveProperty([theme]);
    for (const [theme, axes] of Object.entries(THEME_TO_AXES)) {
      for (const axis of axes)
        expect([theme, AXIS_TO_ARCHETYPE[axis]]).toEqual([theme, THEME_TO_ARCHETYPE[theme]]);
    }
  });

  it('reads any creature-type name as typal, singular or plural, without an entry', () => {
    expect(themeArchetype('Octopuses')).toBe(Archetype.TRIBAL);
    expect(themeArchetype('Time Lords')).toBe(Archetype.TRIBAL);
    expect(themeArchetype('Dwarves')).toBe(Archetype.TRIBAL);
    expect(themeAxes('Dwarves')).toEqual(['tribal']);
    // An explicit entry wins over the typal rule.
    expect(themeArchetype('Ninjas')).toBe(Archetype.TEMPO);
    expect(themeAxes('Ninjas')).toEqual([]);
    expect(themeArchetype('Flying')).toBeUndefined();
    expect(themeAxes('Flying')).toEqual([]);
  });

  it('builds a typal engine as its tribe: Ninjas are Tempo, everything else Tribal', () => {
    expect(typalArchetype('Ninja')).toBe(Archetype.TEMPO);
    expect(typalArchetype('Elf')).toBe(Archetype.TRIBAL);
    expect(typalArchetype(undefined)).toBe(Archetype.TRIBAL);
  });
});

const mass = (axis: AxisMass['axis'], producers: number, payoffs: number): AxisMass => ({
  axis,
  producers,
  payoffs,
});

describe('mill: opponent mill is not a graveyard deck (E511)', () => {
  const corpus = (name: string) => {
    const c = CORPUS.find((x) => x.name === name);
    if (!c) throw new Error(`no corpus card ${name}`);
    return c;
  };
  const read = (names: string[]) =>
    readEngine(
      axisMassFrom(
        names.flatMap((n) => {
          const cs = classifyCard(corpus(n));
          return [
            ...cs.producers.map((p) => ({
              axis: p.axis,
              side: 'producer' as const,
              reason: p.reason,
              weight: 1,
            })),
            ...cs.payoffs.map((o) => ({
              axis: o.axis,
              side: 'payoff' as const,
              reason: o.reason,
              weight: 1,
            })),
          ];
        })
      )
    );

  it("rules EDHREC's Mill tag a strategy no archetype models, and keeps Self-Mill Reanimator", () => {
    expect(themeArchetype('Mill')).toBeUndefined();
    expect(nonStrategyReason('Mill')).toBe('unmodeled');
    expect(themeAxes('Mill')).toEqual([]);
    expect(themeArchetype('Self-Mill')).toBe(Archetype.REANIMATOR);
    expect(themeAxes('Self-Mill')).toEqual(['graveyard']);
  });

  it('never reads an opponent-mill engine as Reanimator', () => {
    // Real Oracle text: every card mills an opponent (or every player).
    const deck = read([
      'Glimpse the Unthinkable',
      'Hedron Crab',
      'Ruin Crab',
      'Consuming Aberration',
      'Mesmeric Orb',
    ]);
    expect(AXIS_TO_ARCHETYPE.mill).toBe(Archetype.GOODSTUFF);
    expect(deck.ranked.some((r) => r.archetype === Archetype.REANIMATOR)).toBe(false);
    expect(deck.decisive).toBeUndefined();
  });
});

describe('readEngine: one rule for a finished list and the average deck', () => {
  it('pools axes that build one strategy before measuring a lead (E417)', () => {
    // Sram-shaped: Equipment and Auras each lose to Tokens alone, together they win.
    const read = readEngine([mass('equipment', 9, 1), mass('auras', 5, 1), mass('tokens', 5, 2)]);
    expect(read.decisive?.archetype).toBe(Archetype.VOLTRON);
    expect(read.decisive?.mass).toBe(16);
    expect(read.decisive?.axes.map((a) => a.axis)).toEqual(['equipment', 'auras']);
  });

  it('never pools value axes: lifegain and counters stay separate competitors', () => {
    // Edgar-shaped: 22 Tribal against 12 lifegain and 10 counters. Pooled they
    // would read as a 22-card Midrange rival and block the lead.
    const read = readEngine([
      mass('tribal', 5, 17),
      mass('lifegain', 9, 3),
      mass('counters', 6, 4),
    ]);
    expect(read.ranked.map((r) => r.archetype)).toEqual([
      Archetype.TRIBAL,
      Archetype.MIDRANGE,
      Archetype.MIDRANGE,
    ]);
    expect(read.decisive).toBeUndefined(); // 22 < 2 × 12
    expect(engineLeader(read)?.archetype).toBe(Archetype.TRIBAL);
  });

  it('needs a real engine, a sharp archetype and a 2x lead', () => {
    expect(readEngine([mass('tokens', 4, 0)]).decisive).toBeUndefined(); // no payoff
    expect(readEngine([mass('counters', 10, 10)]).decisive).toBeUndefined(); // Midrange
    expect(readEngine([mass('tokens', 8, 2), mass('sacrifice', 3, 2)]).decisive?.archetype).toBe(
      Archetype.TOKENS
    );
    expect(readEngine([mass('tokens', 8, 2), mass('sacrifice', 4, 2)]).decisive).toBeUndefined();
  });

  it('names contenders: invested and within the lead ratio of the heaviest', () => {
    const read = readEngine([
      mass('sacrifice', 12, 6),
      mass('graveyard', 4, 5),
      mass('landfall', 5, 0),
    ]);
    expect(isEngineContender(read, Archetype.REANIMATOR)).toBe(true);
    expect(isEngineContender(read, Archetype.LANDFALL)).toBe(false); // not invested
    expect(isEngineContender(read, Archetype.TOKENS)).toBe(false); // absent
  });

  it('takes a typal axis archetype from the tribe it names most', () => {
    const yuriko = CORPUS.find((c) => c.name === "Yuriko, the Tiger's Shadow")!;
    const goblinKing = CORPUS.find((c) => c.name === 'Goblin King')!;
    const entries = (card: (typeof CORPUS)[number], weight: number) => {
      const cs = classifyCard(card);
      return [
        ...cs.producers.map((p) => ({
          axis: p.axis,
          side: 'producer' as const,
          reason: p.reason,
          weight,
        })),
        ...cs.payoffs.map((o) => ({
          axis: o.axis,
          side: 'payoff' as const,
          reason: o.reason,
          weight,
        })),
      ];
    };
    const ninjaHeavy = axisMassFrom([...entries(yuriko, 3), ...entries(goblinKing, 1)]);
    expect(ninjaHeavy.find((m) => m.axis === 'tribal')?.archetype).toBe(Archetype.TEMPO);
    const goblinHeavy = axisMassFrom([...entries(yuriko, 1), ...entries(goblinKing, 3)]);
    // Tribal is the axis's own archetype, so no override is recorded.
    expect(goblinHeavy.find((m) => m.axis === 'tribal')?.archetype).toBeUndefined();
  });

  it('sums weighted entries per axis and side', () => {
    const [m] = axisMassFrom([
      { axis: 'tokens', side: 'producer', reason: 'creates creature tokens', weight: 0.5 },
      { axis: 'tokens', side: 'producer', reason: 'creates creature tokens', weight: 0.25 },
      { axis: 'tokens', side: 'payoff', reason: 'populate', weight: 1 },
      { axis: 'tokens', side: 'payoff', reason: 'populate', weight: 0 },
    ]);
    expect(m).toEqual({ axis: 'tokens', producers: 0.75, payoffs: 1 });
  });
});
