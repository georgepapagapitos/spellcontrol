import { Archetype } from '@/deck-builder/types';

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
  mill: Archetype.REANIMATOR,
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
};

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
