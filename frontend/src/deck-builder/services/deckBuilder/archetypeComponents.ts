/**
 * Archetype components (roadmap 2.2): the card classes an archetype is built
 * from (sacrifice outlets, death payoffs, token makers, flicker, ...), counted
 * the way the 2026-10 density measurement counted them, so the thresholds in
 * `archetypeChecks.ts` mean what they were measured to mean.
 *
 * ANALYSIS-ONLY, like `supportRoles.ts`: the generator never imports this.
 *
 * Each detector is a port of the matching one in
 * `docs/research/deck-intelligence-2026-10/scripts/archetype-densities/detectors.py`
 * (the `*2` / `_strict` / `_rep` versions the thresholds were stated for). They
 * read the Scryfall oracle-tag index (`lib/cards/card-tags`, the same snapshot
 * the measurement used) plus the card's oracle text, injected as a `TagLookup`
 * so this module carries no I/O. Precision over recall: the measured detectors
 * are 80-90% precise (08 section 3), and the thresholds assume that.
 */

/** The slice of a Scryfall card the detectors read. */
export interface ComponentCard {
  name: string;
  oracle_text?: string;
  type_line?: string;
  card_faces?: Array<{ oracle_text?: string; type_line?: string }>;
}

/** Oracle tags for a card name (`getCardTags`); empty when the index is not loaded. */
export type TagLookup = (name: string) => readonly string[];

export const COMPONENT_KEYS = [
  'repeatableOutlet',
  'deathPayoff',
  'tokenMaker',
  'teamEffect',
  'protection',
  'spellPayoff',
  'instantSorcery',
  'landFetch',
  'landfallPayoff',
  'graveyardFiller',
  'reanimation',
  'artifact',
  'enchantment',
] as const;
export type ComponentKey = (typeof COMPONENT_KEYS)[number];

/** Card names per component (distinct names), plus quantity-weighted counts. */
export interface ComponentTally {
  /** Copies counted, so a 4-of counts 4 like the measurement did. */
  count: Record<ComponentKey, number>;
  /** Distinct card names per component, for the "which cards" line. */
  names: Record<ComponentKey, string[]>;
  /** Lands in the deck (front face a land). */
  lands: number;
}

interface Facts {
  tags: ReadonlySet<string>;
  /** Oracle text, every face joined by newlines. */
  text: string;
  /** Same, with the card's own name written as `~`. */
  norm: string;
  type: string;
  front: string;
  land: boolean;
  creature: boolean;
}

const frontType = (c: ComponentCard): string =>
  (c.card_faces?.[0]?.type_line ?? c.type_line ?? '').split(' // ')[0];

function factsOf(card: ComponentCard, tagsOf: TagLookup): Facts {
  const text = card.card_faces
    ? card.card_faces.map((f) => f.oracle_text ?? '').join('\n')
    : (card.oracle_text ?? '');
  let norm = text;
  const own = new Set([card.name, ...card.name.split(' // '), card.name.split(',')[0]]);
  for (const n of own) if (n.length > 2) norm = norm.split(n).join('~');
  const front = frontType(card);
  return {
    tags: new Set(tagsOf(card.name)),
    text,
    norm,
    type: card.type_line ?? front,
    front,
    land: front.includes('Land'),
    creature: front.includes('Creature'),
  };
}

const anyTag = (f: Facts, ...names: string[]): boolean => names.some((n) => f.tags.has(n));

// ── Aristocrats ─────────────────────────────────────────────────────────────
// A repeatable outlet: an activated line whose COST sacrifices a creature or
// permanent of your choice. Not "creature token", subtype-restricted or
// one-shot additional costs.
const SAC_GENERAL =
  /\bsacrifice (?:an? |another |one or more |two |x |any number of )?(?:other |nontoken |untapped |tapped )?(?:creatures?|permanents?|artifact or creature|creature or artifact|nonland permanents?)\b(?! token| with | that)/i;

function isRepeatableOutlet(f: Facts): boolean {
  if (f.land) return false;
  return f.norm.split('\n').some((line) => {
    if (!line.includes(':') || /^\s*["•]/.test(line)) return false;
    const cost = line.split(':')[0];
    return SAC_GENERAL.test(cost) && !/^[+−-]?\d+$/.test(cost.trim());
  });
}

const DEATH_PAYOFF =
  /(whenever|when) (?:~ or )?(?:a|another|one or more|an?y?) (?:other )?(?:nontoken |non-token )?(?:creatures?|permanents?)(?: you control| an opponent controls)?(?: or (?:planeswalkers?|artifacts?))?(?: you control)? (?:dies?|die)\b|whenever you sacrifice (?:a|another|one or more) (?:creature|permanent)|whenever (?:a|another) creature (?:you control )?(?:is put into a graveyard from the battlefield)|whenever (?:a|another|one or more) (?:nontoken )?creatures? (?:you control )?(?:dies?|die)/i;

const isDeathPayoff = (f: Facts): boolean =>
  !f.land && (DEATH_PAYOFF.test(f.norm) || f.tags.has('blood-artist-ability'));

// ── Tokens ──────────────────────────────────────────────────────────────────
const TOKEN_MAKER =
  /\bcreates?\b[^.\n]*\bcreature tokens?\b|\bamass\b|\bpopulate\b|\bfabricate\b|\bincubate\b|\bcreate[s]?\b[^.\n]*\b(soldier|spirit|zombie|goblin|elf|saproling|squirrel|insect|rat|thopter|servo|wolf|beast|elemental|knight|dragon|angel|vampire|pirate|rogue|cat|bird|human|warrior)\b[^.\n]*\btoken/i;
const TEAM_EFFECT =
  /creatures you control (get|gain|have)|each creature you control (gets|gains|has)|other creatures you control (get|gain|have)|creature tokens you control (get|gain|have)/i;

// ── Protection (strict) ─────────────────────────────────────────────────────
// A NONcreature card (spell, equipment, aura) that grants hexproof,
// indestructible, shroud, protection, ward or a phase-out: the cheap,
// castable kind. Creatures that merely have the keyword are not it.
const PROTECTION_TAGS = [
  'protection',
  'protects-creature',
  'protects-all',
  'protects-permanent',
  'gives-hexproof',
  'gives-indestructible',
  'gives-shroud',
  'gives-protection',
  'gives-ward',
  'gives-player-hexproof',
];
const PROTECTION_TEXT =
  /hexproof|indestructible|shroud|protection from|phase[sd]? out|phases out|\bward\b|regenerat|counter target (spell|ability) that targets|can't be (the target|countered)|exile target (creature|permanent)[^.\n]* you control|prevent all/i;

const isStrictProtection = (f: Facts): boolean =>
  !f.land && !f.creature && anyTag(f, ...PROTECTION_TAGS) && PROTECTION_TEXT.test(f.text);

// ── Spellslinger ────────────────────────────────────────────────────────────
const SPELL_PAYOFF =
  /whenever you cast (an? )?(instant or sorcery|instant|sorcery|noncreature|instant, sorcery)|whenever you cast or copy|\bmagecraft\b|whenever you cast (a|an|your first|your second) [a-z ]*(instant|sorcery|noncreature)|whenever you cast a spell with|copy target instant or sorcery|each time you cast (an? )?(instant|sorcery|noncreature)/i;

const isInstantOrSorcery = (f: Facts): boolean =>
  f.front.includes('Instant') || f.front.includes('Sorcery');

// ── Landfall ────────────────────────────────────────────────────────────────
const LANDFALL =
  /\blandfall\b|whenever a land (enters|you control enters)|whenever one or more lands enter/i;

// ── Graveyard ───────────────────────────────────────────────────────────────
// Reanimation: a non-self effect returning a creature or permanent card from a
// graveyard to the battlefield, an Animate Dead aura, or the word itself.
const REANIMATE =
  /(return|put)[^.\n]*\bcards?\b[^.\n]*\b(from|of|in)\b[^.\n]*\bgraveyards?\b[^.\n]*\b(to|onto) the battlefield|choose [^.\n]*cards? in (your|a) graveyard[^\n]*to the battlefield|enchant creature card in a graveyard|return (target|up to \w+ target|each|all|that) [^.\n]*creature[^.\n]*from [^.\n]*graveyard[^.\n]* to the battlefield|\bpermanent cards? from [^.\n]*graveyards?[^.\n]* onto the battlefield|creature cards? from (all|each|their|your|a|target) [^.\n]*graveyards?[^.\n]* onto the battlefield|reanimat/i;
const SELF_RETURN =
  /[^.\n]*(return|put) (~|this card)[^.\n]*from (your|a) graveyard[^.\n]*[.\n]?/gi;

function isReanimation(f: Facts): boolean {
  if (f.land) return false;
  const text = f.norm.replace(SELF_RETURN, '');
  if (!REANIMATE.test(text)) return false;
  // A land-only return (Crucible-style regrowth) is not reanimation.
  return !(
    /(return|put)[^.\n]*\blands? cards?\b[^.\n]*from[^.\n]*graveyard/i.test(text) &&
    !/creature|permanent card|nonland/i.test(text)
  );
}

const DETECTORS: Record<ComponentKey, (f: Facts) => boolean> = {
  repeatableOutlet: isRepeatableOutlet,
  deathPayoff: isDeathPayoff,
  tokenMaker: (f) => !f.land && TOKEN_MAKER.test(f.text),
  teamEffect: (f) => !f.land && (anyTag(f, 'anthem', 'overrun') || TEAM_EFFECT.test(f.text)),
  protection: isStrictProtection,
  spellPayoff: (f) => !f.land && !isInstantOrSorcery(f) && SPELL_PAYOFF.test(f.text),
  instantSorcery: isInstantOrSorcery,
  landFetch: (f) =>
    !f.land &&
    anyTag(f, 'land-ramp', 'tutor-land', 'tutor-land-basic', 'tutor-land-to-battlefield'),
  landfallPayoff: (f) =>
    !f.land && (anyTag(f, 'landfall', 'landfall-other') || LANDFALL.test(f.text)),
  graveyardFiller: (f) =>
    !f.land &&
    anyTag(
      f,
      'mill-self',
      'loot',
      'repeatable-loot',
      'surveil',
      'repeatable-surveil',
      'tutor-to-graveyard'
    ),
  reanimation: isReanimation,
  artifact: (f) => !f.land && f.front.includes('Artifact'),
  enchantment: (f) => !f.land && f.front.includes('Enchantment'),
};

/** Which components does one card fill? Pure; tags injected. */
export function componentsOf(card: ComponentCard, tagsOf: TagLookup): ComponentKey[] {
  const f = factsOf(card, tagsOf);
  return COMPONENT_KEYS.filter((k) => DETECTORS[k](f));
}

/**
 * Component counts over a deck's mainboard (one entry per copy, commander
 * excluded). Counts are quantity-weighted, names are distinct.
 */
export function tallyComponents(
  cards: readonly ComponentCard[],
  tagsOf: TagLookup
): ComponentTally {
  const count = Object.fromEntries(COMPONENT_KEYS.map((k) => [k, 0])) as Record<
    ComponentKey,
    number
  >;
  const seen = Object.fromEntries(COMPONENT_KEYS.map((k) => [k, new Set<string>()])) as Record<
    ComponentKey,
    Set<string>
  >;
  let lands = 0;
  const memo = new Map<string, ComponentKey[]>();
  for (const card of cards) {
    if (frontType(card).includes('Land')) {
      lands++;
      continue;
    }
    let keys = memo.get(card.name);
    if (!keys) {
      keys = componentsOf(card, tagsOf);
      memo.set(card.name, keys);
    }
    for (const k of keys) {
      count[k]++;
      seen[k].add(card.name);
    }
  }
  const names = Object.fromEntries(COMPONENT_KEYS.map((k) => [k, [...seen[k]].sort()])) as Record<
    ComponentKey,
    string[]
  >;
  return { count, names, lands };
}
