import { Archetype } from '@/deck-builder/types';
import { typalReasonType, type AxisKey } from '@/deck-builder/services/synergy/axes';
import { INVEST_THRESHOLD } from '@/deck-builder/services/synergy/deckSynergy';
import { creatureTypePlurals, resolveCreatureType } from '@/deck-builder/services/synergy/text';

/**
 * Canonical strategy vocabulary — the single home for how EDHREC theme names
 * map to the deck builder's macro {@link Archetype}s, plus the display label for
 * each archetype.
 *
 * The theme→archetype map used to live inline in `roleTargets.ts`; it's here so
 * there's one place that owns the relationship and the archetype display names
 * stay colocated with it. Keys are lowercase EDHREC theme names — the common
 * currency across the deck builder (the commander DETECTORS emit them, theme
 * scoring keys on them, role targeting looks them up).
 *
 * Look names up through `themeArchetype`, which also reads any creature-type
 * name as typal, so a tribe needs no entry. Every tag on EDHREC's theme and
 * typal lists has an entry here, resolves as a tribe, or has a ruling in
 * `NON_STRATEGY_THEMES` (pinned by strategyVocabulary.coverage.test.ts).
 * Consumers apply their own `?? Archetype.GOODSTUFF` fallback for unmapped
 * themes (see `inferArchetype`).
 */
export const THEME_TO_ARCHETYPE: Record<string, Archetype> = {
  // Aggro / Combat
  aggro: Archetype.AGGRO,
  combat: Archetype.AGGRO,
  'extra combat': Archetype.AGGRO,
  infect: Archetype.AGGRO,
  poison: Archetype.AGGRO,

  // Control
  control: Archetype.CONTROL,
  stax: Archetype.CONTROL,
  pillowfort: Archetype.CONTROL,

  // Combo
  combo: Archetype.COMBO,
  'extra turns': Archetype.COMBO,

  // Voltron / Equipment / Auras
  voltron: Archetype.VOLTRON,
  equipment: Archetype.VOLTRON,
  auras: Archetype.VOLTRON,

  // Spellslinger
  spellslinger: Archetype.SPELLSLINGER,
  cantrips: Archetype.SPELLSLINGER,

  // Tempo — unblockable/evasive damage-and-disruption decks (ninjutsu is the
  // clearest EDHREC signal: it's ALWAYS a tempo shell built around cheap
  // evasive attackers, unlike "aggro"/"voltron" which get claimed by
  // heavier go-wide or single-threat strategies).
  ninjutsu: Archetype.TEMPO,
  ninjas: Archetype.TEMPO,
  unblockable: Archetype.TEMPO,

  // Tokens
  tokens: Archetype.TOKENS,
  'go wide': Archetype.TOKENS,

  // Aristocrats / Sacrifice
  aristocrats: Archetype.ARISTOCRATS,
  sacrifice: Archetype.ARISTOCRATS,
  lifedrain: Archetype.ARISTOCRATS,

  // Reanimator / Graveyard
  reanimator: Archetype.REANIMATOR,
  graveyard: Archetype.REANIMATOR,
  // "mill" is ruled non-strategy (NON_STRATEGY_THEMES): E511 found EDHREC's
  // Mill tag is mostly opponent mill, which the Reanimator role model misreads.
  dredge: Archetype.REANIMATOR,
  flashback: Archetype.REANIMATOR,

  // Landfall / Lands
  landfall: Archetype.LANDFALL,
  lands: Archetype.LANDFALL,

  // Artifacts
  artifacts: Archetype.ARTIFACTS,
  treasures: Archetype.ARTIFACTS,
  vehicles: Archetype.ARTIFACTS,
  clues: Archetype.ARTIFACTS,
  food: Archetype.ARTIFACTS,

  // Enchantress
  enchantress: Archetype.ENCHANTRESS,
  enchantments: Archetype.ENCHANTRESS,
  constellation: Archetype.ENCHANTRESS,

  // Storm
  storm: Archetype.STORM,

  // Tribal — the generic theme plus individual tribes
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

  // Midrange-ish value strategies
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

  // Goodstuff / catch-all
  superfriends: Archetype.GOODSTUFF,
  planeswalkers: Archetype.GOODSTUFF,
  chaos: Archetype.GOODSTUFF,
  politics: Archetype.GOODSTUFF,
  wheels: Archetype.GOODSTUFF,
  discard: Archetype.GOODSTUFF,
  tutors: Archetype.GOODSTUFF,

  // E511: every EDHREC theme or typal tag that names a strategy (the tag lists
  // at json.edhrec.com/pages/tags/themes.json and /typal.json, 2026-09-29).
  // Display-name aliases for strategies already named above come first.
  // EDHREC's name for lands.
  'lands matter': Archetype.LANDFALL,
  // EDHREC's name for treasures.
  treasure: Archetype.ARTIFACTS,
  // EDHREC's name for extra combat.
  'extra combats': Archetype.AGGRO,
  // EDHREC's name for pillowfort.
  'pillow fort': Archetype.CONTROL,
  // EDHREC's name for counters.
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
  // The Second Sunrise combo deck, not the Egg creature type.
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
  // Servo tokens from fabricate, not Servo typal.
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
  // Krakens, Leviathans, Octopuses and Serpents.
  'sea creatures': Archetype.TRIBAL,
  // Clerics, Rogues, Warriors and Wizards.
  party: Archetype.TRIBAL,
  // Assassins, Mercenaries, Pirates, Rogues and Warlocks.
  outlaws: Archetype.TRIBAL,
  // An artifact type EDHREC files under typal.
  spacecraft: Archetype.ARTIFACTS,
  // A spell type EDHREC files under typal.
  arcane: Archetype.SPELLSLINGER,
  // A retired creature type EDHREC still lists.
  cephalids: Archetype.TRIBAL,
};

/**
 * The synergy axes that observe each named theme's engine. Every axis listed
 * implies the theme's own archetype (AXIS_TO_ARCHETYPE), so a theme's axes
 * can only ever confirm the archetype it names. `[]` is a ruling, not a gap:
 * no axis reads that strategy in card text.
 */
export const THEME_TO_AXES: Record<string, readonly AxisKey[]> = {
  aggro: [],
  combat: [],
  'extra combat': [],
  infect: ['poison'],
  poison: ['poison'],
  control: [],
  stax: [],
  pillowfort: [],
  combo: [],
  'extra turns': [],
  voltron: ['equipment', 'auras'],
  equipment: ['equipment'],
  auras: ['auras'],
  spellslinger: ['spellslinger'],
  cantrips: ['spellslinger'],
  ninjutsu: [],
  ninjas: [],
  unblockable: [],
  tokens: ['tokens'],
  'go wide': ['tokens'],
  aristocrats: ['sacrifice'],
  sacrifice: ['sacrifice'],
  // Drain is carved out of the lifegain axis (DRAIN_CLAUSE) and isn't a
  // sacrifice signal on its own, so no axis reads it.
  lifedrain: [],
  reanimator: ['graveyard'],
  graveyard: ['graveyard'],
  dredge: ['graveyard'],
  flashback: ['graveyard'],
  landfall: ['landfall'],
  lands: ['landfall'],
  artifacts: ['artifacts'],
  treasures: ['artifacts'],
  vehicles: ['vehicles'],
  clues: ['artifacts'],
  food: ['artifacts'],
  enchantress: ['enchantress'],
  enchantments: ['enchantress'],
  constellation: ['enchantress'],
  // Storm's payoff lives on the spellslinger axis, which implies Spellslinger,
  // not Storm, so it can't confirm a Storm hint.
  storm: [],
  tribal: ['tribal'],
  '+1/+1 counters': ['counters'],
  '-1/-1 counters': [],
  counters: ['counters'],
  proliferate: [],
  blink: ['blink'],
  flicker: ['blink'],
  etb: ['blink'],
  clones: [],
  copy: [],
  lifegain: ['lifegain'],
  energy: ['energy'],
  cascade: [],
  monarch: ['monarch'],
  superfriends: ['superfriends'],
  planeswalkers: ['superfriends'],
  chaos: [],
  politics: [],
  wheels: [],
  discard: ['discard'],
  tutors: [],
  // E511 additions (see THEME_TO_ARCHETYPE).
  'lands matter': ['landfall'],
  treasure: ['artifacts'],
  'extra combats': [],
  'pillow fort': [],
  'counters matter': ['counters'],
  'group hug': ['grouphug'],
  'good stuff': [],
  midrange: [],
  tempo: [],
  burn: [],
  'attack triggers': [],
  stompy: [],
  zoo: [],
  weenies: [],
  saboteurs: [],
  hatebears: [],
  'land destruction': [],
  counterspells: [],
  flash: [],
  aikido: [],
  prison: [],
  creatureless: [],
  'turbo fog': [],
  'tap / untap': [],
  cheerios: [],
  eggs: [],
  doomsday: [],
  bounce: [],
  sneak: [],
  'modified creatures': [],
  exalted: [],
  stoneblade: ['equipment'],
  heroic: [],
  'spell copy': ['spellslinger'],
  prowess: ['spellslinger'],
  populate: ['tokens'],
  anthems: [],
  amass: ['tokens'],
  convoke: ['tokens'],
  'spore counters': [],
  squad: [],
  exploit: [],
  'self-mill': ['graveyard'],
  surveil: ['graveyard'],
  delirium: [],
  descend: [],
  'land animation': [],
  guildgates: [],
  deserts: [],
  affinity: ['artifacts'],
  modular: [],
  blood: ['artifacts'],
  improvise: ['artifacts'],
  incubate: ['artifacts'],
  servos: ['artifacts'],
  sagas: [],
  shrines: [],
  curses: [],
  rooms: [],
  cycling: ['cycling'],
  dungeon: ['venture'],
  discover: [],
  rock: [],
  'ltb effects': [],
  'group slug': [],
  theft: [],
  'forced combat': [],
  toolbox: [],
  donate: [],
  voting: [],
  'self-discard': ['discard'],
  madness: ['discard'],
  looting: ['discard'],
  'die roll': ['dice'],
  'coin flip': [],
  'sea creatures': ['tribal'],
  party: ['tribal'],
  outlaws: ['tribal'],
  spacecraft: [],
  arcane: [],
  cephalids: ['tribal'],
};

/** Why an EDHREC tag names no strategy. */
export type NonStrategyReason =
  'resource' | 'flavor' | 'keyword' | 'mechanic' | 'package' | 'format' | 'unmodeled';

/**
 * EDHREC tags that name no deck strategy, with the reason. They map to no
 * archetype, so they stay out of the dominance denominator
 * (`readEdhrecThemeHint`) and never vote. A ruling, not a gap: the coverage
 * test fails on any EDHREC tag with neither an archetype nor a ruling here.
 */
export const NON_STRATEGY_THEMES: Record<string, NonStrategyReason> = {
  // A density every deck carries: ramp, card draw, mana rocks.
  'card draw': 'resource',
  'mana dorks': 'resource',
  'mana rocks': 'resource',
  ramp: 'resource',
  // Legendary, historic or commander flavor. E90 kept these out of the
  // dominance denominator: they don't compete as a strategy.
  annihilator: 'flavor',
  'big mana': 'flavor',
  'commander matters': 'flavor',
  devoid: 'flavor',
  historic: 'flavor',
  legends: 'flavor',
  'multicolor matters': 'flavor',
  vanilla: 'flavor',
  // An evergreen keyword, a stat or a counter type, which decks of every strategy share.
  'activated abilities': 'keyword',
  'all spells': 'keyword',
  banding: 'keyword',
  'charge counters': 'keyword',
  'color hack': 'keyword',
  deathtouch: 'keyword',
  defenders: 'keyword',
  devotion: 'keyword',
  enrage: 'keyword',
  exile: 'keyword',
  'experience counters': 'keyword',
  'extra upkeeps': 'keyword',
  fight: 'keyword',
  fling: 'keyword',
  flying: 'keyword',
  'glass cannon': 'keyword',
  'hand size': 'keyword',
  haste: 'keyword',
  hellbent: 'keyword',
  horsemanship: 'keyword',
  'impulse draw': 'keyword',
  indestructible: 'keyword',
  keywords: 'keyword',
  landwalk: 'keyword',
  'life exchange': 'keyword',
  lure: 'keyword',
  menace: 'keyword',
  'oil counters': 'keyword',
  phasing: 'keyword',
  pingers: 'keyword',
  power: 'keyword',
  'power matters': 'keyword',
  'rad counters': 'keyword',
  reach: 'keyword',
  scry: 'keyword',
  'self-damage': 'keyword',
  'self-destruct': 'keyword',
  skulk: 'keyword',
  snow: 'keyword',
  stun: 'keyword',
  'time counters': 'keyword',
  topdeck: 'keyword',
  'toughness matters': 'keyword',
  transform: 'keyword',
  'triggered abilities': 'keyword',
  'type hack': 'keyword',
  'x spells': 'keyword',
  // A set mechanic or card-type detail, not a game plan.
  adventures: 'mechanic',
  airbending: 'mechanic',
  attractions: 'mechanic',
  battles: 'mechanic',
  bloodthirst: 'mechanic',
  bobbleheads: 'mechanic',
  books: 'mechanic',
  caves: 'mechanic',
  cid: 'mechanic',
  clash: 'mechanic',
  connive: 'mechanic',
  craft: 'mechanic',
  crime: 'mechanic',
  dash: 'mechanic',
  'day / night': 'mechanic',
  earthbending: 'mechanic',
  evoke: 'mechanic',
  explore: 'mechanic',
  firebending: 'mechanic',
  foretell: 'mechanic',
  freerunning: 'mechanic',
  increment: 'mechanic',
  'job select': 'mechanic',
  kicker: 'mechanic',
  lessons: 'mechanic',
  'level up': 'mechanic',
  mayhem: 'mechanic',
  miracles: 'mechanic',
  morph: 'mechanic',
  mutate: 'mechanic',
  myriad: 'mechanic',
  offspring: 'mechanic',
  opus: 'mechanic',
  paradox: 'mechanic',
  plot: 'mechanic',
  polymorph: 'mechanic',
  repartee: 'mechanic',
  retrace: 'mechanic',
  'rube goldberg': 'mechanic',
  speed: 'mechanic',
  stickers: 'mechanic',
  summons: 'mechanic',
  sunburst: 'mechanic',
  suspend: 'mechanic',
  'the ring': 'mechanic',
  towns: 'mechanic',
  turbo: 'mechanic',
  unnatural: 'mechanic',
  'villainous choice': 'mechanic',
  warp: 'mechanic',
  waterbending: 'mechanic',
  'web-slinging': 'mechanic',
  // One card, or a card a deck may run any number of, named by the tag.
  'ad nauseam': 'package',
  'birthing pod': 'package',
  'blue moon': 'package',
  dandan: 'package',
  delver: 'package',
  "dragon's approach": 'package',
  'hare apparent': 'package',
  'persistent petitioners': 'package',
  'primal surge': 'package',
  'rat colony': 'package',
  'relentless rats': 'package',
  'shadowborn apostles': 'package',
  'slime against humanity': 'package',
  'sneak attack': 'package',
  sunforger: 'package',
  'tempest hawk': 'package',
  'templar knights': 'package',
  tron: 'package',
  // A format, companion or deck-construction tag.
  'custom cards': 'format',
  'european highlander': 'format',
  'gyruda companion': 'format',
  'jegantha companion': 'format',
  'kaheera companion': 'format',
  'keruga companion': 'format',
  'lurrus companion': 'format',
  'obosh companion': 'format',
  'old school': 'format',
  paradigm: 'format',
  planechase: 'format',
  premodern: 'format',
  'umori companion': 'format',
  'value vintage': 'format',
  'zirda companion': 'format',
  // A strategy no archetype models. EDHREC's Mill tag (checked 2026-09-29) is
  // mostly opponent mill: Consuming Aberration, Maddening Cacophony, Fractured
  // Sanity and Ruin Crab lead its high-synergy list, The Wise Mothman, Captain
  // N'ghathrod and Phenax its commanders. Reanimator's role model would build
  // a deck-out deck as a graveyard deck. Self-Mill stays Reanimator.
  mill: 'unmodeled',
};

/** Why a tag names no strategy, or undefined when it names one (or is unknown). */
export function nonStrategyReason(name: string): NonStrategyReason | undefined {
  return NON_STRATEGY_THEMES[name.toLowerCase().trim()];
}

const TYPAL_AXES: readonly AxisKey[] = ['tribal'];

/**
 * The archetype an EDHREC theme or typal name implies, case-insensitive. A
 * name with no entry that names a creature type ("Elves", "Time Lords") is
 * typal. Undefined when the name is neither.
 */
export function themeArchetype(name: string): Archetype | undefined {
  const key = name.toLowerCase().trim();
  return THEME_TO_ARCHETYPE[key] ?? (resolveCreatureType(key) ? Archetype.TRIBAL : undefined);
}

/**
 * The synergy axes that observe a theme's engine in card text, so the cards
 * can confirm or contradict an EDHREC theme. Empty for a strategy no axis
 * reads (ninjutsu, extra combats, control).
 */
export function themeAxes(name: string): readonly AxisKey[] {
  const key = name.toLowerCase().trim();
  return THEME_TO_AXES[key] ?? (resolveCreatureType(key) ? TYPAL_AXES : []);
}

/**
 * Display name for each {@link Archetype} enum value. The enum's values are
 * lowercase slugs (`'aristocrats'`); this is the canonical Title-Case label to
 * show in UI (e.g. the deck-identity rows).
 */
export const ARCHETYPE_LABEL: Record<Archetype, string> = {
  [Archetype.AGGRO]: 'Aggro',
  [Archetype.CONTROL]: 'Control',
  [Archetype.COMBO]: 'Combo',
  [Archetype.MIDRANGE]: 'Midrange',
  [Archetype.VOLTRON]: 'Voltron',
  [Archetype.SPELLSLINGER]: 'Spellslinger',
  [Archetype.TEMPO]: 'Tempo',
  [Archetype.TOKENS]: 'Tokens',
  [Archetype.ARISTOCRATS]: 'Aristocrats',
  [Archetype.REANIMATOR]: 'Reanimator',
  [Archetype.TRIBAL]: 'Tribal',
  [Archetype.LANDFALL]: 'Landfall',
  [Archetype.ARTIFACTS]: 'Artifacts',
  [Archetype.ENCHANTRESS]: 'Enchantress',
  [Archetype.STORM]: 'Storm',
  [Archetype.GOODSTUFF]: 'Goodstuff',
};

/**
 * The archetype each synergy axis's engine implies. Total over {@link AxisKey},
 * so a new axis can't ship without saying what it builds. Axes whose engine is
 * value rather than a strategy map to Midrange or Goodstuff, which the engine
 * read treats as "nothing sharper than the fallback".
 */
export const AXIS_TO_ARCHETYPE: Record<AxisKey, Archetype> = {
  tokens: Archetype.TOKENS,
  counters: Archetype.MIDRANGE,
  sacrifice: Archetype.ARISTOCRATS,
  lifegain: Archetype.MIDRANGE,
  landfall: Archetype.LANDFALL,
  graveyard: Archetype.REANIMATOR,
  artifacts: Archetype.ARTIFACTS,
  equipment: Archetype.VOLTRON,
  spellslinger: Archetype.SPELLSLINGER,
  enchantress: Archetype.ENCHANTRESS,
  superfriends: Archetype.GOODSTUFF,
  tribal: Archetype.TRIBAL,
  blink: Archetype.MIDRANGE,
  vehicles: Archetype.ARTIFACTS,
  grouphug: Archetype.GOODSTUFF,
  energy: Archetype.MIDRANGE,
  auras: Archetype.VOLTRON,
  discard: Archetype.GOODSTUFF,
  // Opponent mill: a deck-out plan no archetype models (self-mill is the
  // graveyard axis), so it says nothing sharper than the fallback.
  mill: Archetype.GOODSTUFF,
  monarch: Archetype.MIDRANGE,
  poison: Archetype.AGGRO,
  cycling: Archetype.MIDRANGE,
  venture: Archetype.MIDRANGE,
  dice: Archetype.GOODSTUFF,
};

/**
 * What a typal engine for one creature type builds: the vocabulary's reading
 * of that tribe's name. Ninjas build Tempo (the "ninjas" entry above), every
 * other tribe builds Tribal.
 */
export function typalArchetype(creatureType: string | undefined): Archetype {
  if (!creatureType) return Archetype.TRIBAL;
  return themeArchetype(creatureTypePlurals(creatureType)[0]) ?? Archetype.TRIBAL;
}

/** One producer or payoff read off one card, at the card's weight. */
export interface EngineEntry {
  axis: AxisKey;
  side: 'producer' | 'payoff';
  /** The axis's reason string (`classifyCard`); a typal reason names its tribe. */
  reason: string;
  weight: number;
}

/**
 * Sum entries into per-axis engine weight. The deck page feeds it a list's
 * cards at weight 1 and the generator feeds it the average deck at inclusion
 * weights, so both read engines through this one function. A typal axis takes
 * the archetype of the tribe its entries name most (`typalArchetype`); type-
 * agnostic typal support (changelings, "choose a creature type") serves that
 * same tribe.
 */
export function axisMassFrom(entries: Iterable<EngineEntry>): AxisMass[] {
  const byAxis = new Map<AxisKey, AxisMass>();
  const tribes = new Map<string, number>();
  for (const e of entries) {
    if (!(e.weight > 0)) continue;
    let m = byAxis.get(e.axis);
    if (!m) {
      m = { axis: e.axis, producers: 0, payoffs: 0 };
      byAxis.set(e.axis, m);
    }
    if (e.side === 'producer') m.producers += e.weight;
    else m.payoffs += e.weight;
    if (e.axis === 'tribal') {
      const tribe = typalReasonType(e.reason);
      if (tribe) tribes.set(tribe, (tribes.get(tribe) ?? 0) + e.weight);
    }
  }
  const tribal = byAxis.get('tribal');
  if (tribal) {
    // Heaviest tribe; ties go to the alphabetically first, so a read is stable.
    const [lead] = [...tribes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const archetype = typalArchetype(lead?.[0]);
    if (archetype !== AXIS_TO_ARCHETYPE.tribal) tribal.archetype = archetype;
  }
  return [...byAxis.values()];
}

/**
 * Engine weight on one synergy axis: producer and payoff entries. A real deck
 * counts cards (one per card per side). The average deck the generator plans
 * from sums inclusion instead, so the same numbers read as expected counts.
 */
export interface AxisMass {
  axis: AxisKey;
  producers: number;
  payoffs: number;
  /** What this axis's engine builds, when it isn't `AXIS_TO_ARCHETYPE[axis]`:
   *  a typal engine builds what its leading tribe builds (`typalArchetype`). */
  archetype?: Archetype;
}

/** One competitor in an engine read: a strategy with its axes pooled, or a
 *  single value axis (Midrange, Goodstuff), which never pools. */
export interface ArchetypeMass {
  archetype: Archetype;
  /** Producers plus payoffs across its axes. */
  mass: number;
  /** Its axes, busiest first. */
  axes: AxisMass[];
  /** At least one of its axes is a real engine (see {@link isInvestedAxis}). */
  invested: boolean;
}

export interface EngineRead {
  /** Competitors with any engine weight, heaviest first. */
  ranked: ArchetypeMass[];
  /** The archetype a decisive engine implies. Undefined when none clearly leads. */
  decisive?: ArchetypeMass;
}

/** How far the leading archetype must outweigh the next one to be decisive. */
// ponytail: one flat 2x lead for a finished list and the average deck alike;
// tune it against the 15-deck panel if a mixed build flips between reads.
export const ENGINE_LEAD_RATIO = 2;

const axisTotal = (a: AxisMass) => a.producers + a.payoffs;
const axisArchetype = (a: AxisMass) => a.archetype ?? AXIS_TO_ARCHETYPE[a.axis];

/**
 * A real engine: enough weight on the axis, with both halves present. The same
 * rule `analyzeDeckSynergy` uses for `invested`, so a deck's radar and its
 * archetype agree on what counts as an engine.
 */
export function isInvestedAxis(a: AxisMass): boolean {
  return axisTotal(a) >= INVEST_THRESHOLD && a.producers >= 1 && a.payoffs >= 1;
}

/** An archetype that says more than the Goodstuff or Midrange fallback. */
export function isSharpArchetype(archetype: Archetype): boolean {
  return archetype !== Archetype.GOODSTUFF && archetype !== Archetype.MIDRANGE;
}

/**
 * The one definition of "what does this engine build", shared by the deck page
 * (a real deck's cards) and the generator (the commander's average deck, read
 * before a card is picked), so the build and the label read cards the same way.
 *
 * Axes that build the same strategy pool before any lead is measured:
 * Equipment and Auras both build Voltron, so a Sram list whose weight splits
 * across the two still reads as Voltron (E417). Value axes don't pool:
 * lifegain, counters and blink are separate engines that share only the
 * Midrange label, and adding them up would invent a competitor no deck runs.
 * The leader is decisive when it is sharp (not Goodstuff or Midrange), owns a
 * real engine, and outweighs the next competitor by {@link ENGINE_LEAD_RATIO}.
 */
export function readEngine(axes: readonly AxisMass[]): EngineRead {
  const entries = new Map<string, ArchetypeMass>();
  for (const a of axes) {
    if (axisTotal(a) <= 0) continue;
    const archetype = axisArchetype(a);
    const key = isSharpArchetype(archetype) ? archetype : `axis:${a.axis}`;
    let entry = entries.get(key);
    if (!entry) {
      entry = { archetype, mass: 0, axes: [], invested: false };
      entries.set(key, entry);
    }
    entry.mass += axisTotal(a);
    entry.axes.push({ ...a });
    if (isInvestedAxis(a)) entry.invested = true;
  }
  const ranked = [...entries.values()];
  for (const r of ranked) {
    r.axes.sort((x, y) => axisTotal(y) - axisTotal(x) || x.axis.localeCompare(y.axis));
  }
  ranked.sort(
    (x, y) =>
      y.mass - x.mass ||
      x.archetype.localeCompare(y.archetype) ||
      x.axes[0].axis.localeCompare(y.axes[0].axis)
  );
  const [top, next] = ranked;
  const decisive =
    top && isEngineLeader(top) && (!next || top.mass >= ENGINE_LEAD_RATIO * next.mass)
      ? top
      : undefined;
  return { ranked, decisive };
}

/** A competitor that can lead a build: sharp, with a real engine. */
function isEngineLeader(entry: ArchetypeMass): boolean {
  return entry.invested && isSharpArchetype(entry.archetype);
}

/**
 * The heaviest competitor, when it could lead a build, decisive or not. The
 * archetype the cards lean toward before any lead is measured.
 */
export function engineLeader(read: EngineRead): ArchetypeMass | undefined {
  const top = read.ranked[0];
  return top && isEngineLeader(top) ? top : undefined;
}

/**
 * Whether the cards leave room for `archetype`: it owns a real engine and the
 * heaviest competitor doesn't outweigh it by {@link ENGINE_LEAD_RATIO}.
 */
export function isEngineContender(read: EngineRead, archetype: Archetype): boolean {
  const entry = read.ranked.find((r) => r.archetype === archetype && r.invested);
  const top = read.ranked[0];
  if (!entry || !top) return false;
  return entry.mass * ENGINE_LEAD_RATIO >= top.mass;
}
