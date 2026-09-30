/**
 * Card facts: a precomputed, structured, per-card record of what a card DOES,
 * built offline and shipped as `public/card-facts.json` (E512).
 *
 * WHY. Most deck-generation defects traced to reading cards at runtime: a
 * regex role gate over Scryfall tagger tags, single-label and all-or-nothing.
 * Liliana, Dreadhorde General carries boardwipe + removal + draw tags, reads as
 * no wipe, and once counted as nothing; counterspells folded into "removal"
 * displaced real removal; Deadbridge Chant's graveyard-to-hand draw was
 * missed; Elesh Norn's wipe lives on her back face. This module is the offline
 * answer: every fact carries its role, a tier, where on the card it comes from
 * and how sure we are. It is generation-INERT in this slice: nothing in the
 * generator reads it yet.
 *
 * ── SCHEMA (version CARD_FACTS_VERSION) ───────────────────────────────────
 *
 * One `CardFacts` per commander-legal card. The PRIMARY key is the oracle id;
 * the normalized FRONT-FACE name is a secondary lookup (never a back face:
 * Scryfall's `!"Brainstorm"` also matches "Harmonized Trio // Brainstorm",
 * whose second face shares the name, and that impostor shipped in decks).
 *
 *  abilities    The primary structure: clause-level (trigger, effects) tuples,
 *               one per ability line (bullet modes are abilities of their own,
 *               sharing a modal group). A trigger is modelled the way a rules
 *               engine models one: an event mode, the zone change it watches
 *               (origin → destination), and a valid-card filter of object type
 *               + controller polarity (you / opp / each / any / self). "Dies" is
 *               battlefield → graveyard; landfall is enters/land/you. Each
 *               effect is (verb, object filter with polarity, zones, amount,
 *               hits, scope, limits). Grave Pact, Dictate of Erebos and Butcher
 *               of Malakir all read
 *                 dies/creature/you → sacrifice/creature/opp
 *               and Dictate differs only by its flash speed. Everything below
 *               is derived from these tuples and points back at its ability.
 *  roles        Multi-role membership, one RoleFact per role:
 *               - `role`: one of FACT_ROLES; the names map 1:1 onto the tagger
 *                 client's vocabulary through ROLE_TO_TAGGER (counterspell is
 *                 its own role here, where the tagger folds it into removal).
 *               - `tier`: primary (the card's main job), secondary (a real but
 *                 second job: a later ability, a minority mode, a land's spell
 *                 side, a prepare spell), incidental (a rider, an ultimate, a
 *                 transformed back face, a tag with no text behind it).
 *                 A consumer counting role slots counts primary + secondary
 *                 only (`countsAsRole`); incidental facts are recorded so
 *                 nothing is silently dropped, but they never fill a slot. That
 *                 is the Liliana fix: her -9 is an incidental wipe, her static
 *                 draw a primary draw engine, her -4 edict a secondary removal.
 *               - `sub`: a role subtype (ramp: dork/rock/land/ritual/...).
 *  interaction  Removal / wipe / counter detail. `mode` (destroy, exile,
 *               bounce, damage, shrink, sacrifice, tuck, steal, neutralize,
 *               fight, counter), `hits` (creature, artifact, ..., spell kinds,
 *               ability), `scope` (single | multi | mass), `side` (any: you
 *               pick the target; opponents: one-sided; all: every player,
 *               yours included, i.e. a symmetric wipe). A counterspell can
 *               never answer a resolved permanent, and `hits` says so.
 *  produces     Resource flows the card creates, and
 *  payoffs      the ones it rewards: a derived view of the tuples. Resources
 *               extend synergy/axes.ts: each AxisKey owns one resource
 *               (RESOURCE_AXIS), computed by the axis predicates themselves and
 *               attributed to the ability whose own text trips them, so
 *               projecting flows back onto axes reproduces `classifyCard`
 *               exactly (extract.test.ts pins that parity over its labeled
 *               corpus). The extended resources (mana, cards, treasure,
 *               gy-to-hand, untap, copy, ...) come from effect verbs and
 *               trigger events.
 *  strengths    Named functions with a strength in (0, 1] (functions.ts):
 *               every role and role/sub at its tier weight, plus niche
 *               functions read from the tuples (grave-pact, sac-outlet,
 *               sac-fodder, aristocrat-drain, big-body, ...). A query asks for
 *               a function by name.
 *  types, keywords, pt, mv
 *               The card types, Scryfall keywords, front-face power/toughness
 *               and mana value, for similarity and body traits.
 *
 * Shared per-fact fields:
 *  ability  Index into `abilities`; -1 for a card-level fact.
 *  face     Index into the card's faces (0 for a one-faced card). A transform,
 *           flip or meld back face carries the `transform` limit and its facts
 *           are incidental; a prepare spell face carries `prepare` and drops a
 *           tier. Split, adventure and modal DFC faces are fully castable.
 *  speed    instant | flash | sorcery | activated | triggered | static: how
 *           the effect reaches the table. A loyalty ability is sorcery speed;
 *           an ETB of a flash permanent is flash.
 *  repeat   once | per-turn | per-event | repeatable | static. `repeatable` is
 *           an activated ability bounded only by its cost (a sac outlet); a
 *           cost that spends the card itself (sacrifice or discard it) is once.
 *  limits   Closed vocabulary (LIMIT_FLAGS plus "mv<=N"-style bounds).
 *  conf     0..1. Parser evidence 0.8, 0.95 when the tagger corpus agrees; a
 *           tag with no text behind it 0.35.
 *  src      Provenance: tag | parser | llm | manual.
 *
 * ── PIPELINE ───────────────────────────────────────────────────────────────
 *
 *  1. `scripts/refresh-card-facts.mjs` (`npm run refresh-card-facts`) streams
 *     Scryfall's `oracle_cards` bulk feed (one request, cached under
 *     node_modules/.cache/card-facts) and keeps the universe:
 *     legalities.commander = legal. Scryfall marks digital-only cards
 *     not_legal in Commander, so that is the paper-legal set; banned cards
 *     never reach a generated deck, so they need no facts.
 *  2. For each card it runs `extractCardFacts` (extract.ts): normalize.ts folds
 *     self-references into `cardname`, strips reminder text and lowercases;
 *     parse.ts splits abilities and reads the tuples; extract.ts derives roles,
 *     interaction, flows and strengths, with the committed `tagger-tags.json`
 *     as corroboration only.
 *  3. The optional LLM pass (`scripts/card-facts-llm.mjs`, llm.ts) reviews a
 *     card's deterministic roles, interaction and flows in a strict JSON
 *     schema; answers are cached per oracle id + model + prompt version, and
 *     `refresh-card-facts.mjs --llm <cache>` merges them under the `tiers`
 *     policy: the review may reorder primary and secondary on roles the parser
 *     read, nothing else (llm.ts says why). It has run only on the 300-card
 *     pilot; the committed snapshot is deterministic (`meta.llm` is null) and
 *     the full run waits on approval.
 *  4. `codec.ts` packs every record into a compact, self-describing form (the
 *     file carries its own vocabularies). `meta` records the bulk file and its
 *     updated_at, the tagger snapshot date, the extractor version, the LLM
 *     model + prompt version (or null) and the seeds. `generatedAt` is the bulk
 *     feed's updated_at, never the wall clock: the same inputs give a
 *     byte-identical file, and the build round-trips every record before
 *     writing. The file is written in Prettier's format (the pre-commit hook
 *     formats staged JSON), so a rebuild matches the committed bytes:
 *     32,116 cards, 5.8 MB raw, 1.27 MB brotli.
 *  5. The accessor (index.ts) fetches the snapshot lazily on first use. It is
 *     never imported from the app entry; only deck-builder code may load it.
 *
 * Accuracy: bench.ts scores records against hand labels on real oracle text,
 * gold.fixtures.ts (dev, tuned against) and gold.holdout.fixtures.ts (a
 * seeded random draw labeled blind); gold.test.ts holds the measured floors as
 * a ratchet and records the holdout's first, blind run. similarity.ts plus
 * substitutes.fixtures.ts (graded, role-conditioned substitute rows) back the
 * functional-similarity eval in scripts/card-facts-eval.mjs.
 */
import { frontFaceName } from '@/lib/cards/card-text';
import type { AxisKey } from '../synergy/axes';

/** Bump when the record shape or any vocabulary below changes meaning. */
export const CARD_FACTS_VERSION = 1;

export const FACT_ROLES = [
  'ramp',
  'cardDraw',
  'tutor',
  'removal',
  'counterspell',
  'boardwipe',
  'protection',
  'recursion',
  'finisher',
  'graveyardHate',
] as const;
export type FactRole = (typeof FACT_ROLES)[number];

/**
 * Each fact role expressed in the tagger client's vocabulary
 * (`RoleKey` + subtype, services/tagger/client.ts), so a later slice can swap
 * the source of a role without renaming anything. `null` marks a role the
 * tagger client exposes only as a parallel predicate (isProtectionPiece) or
 * not at all.
 */
export const ROLE_TO_TAGGER: Record<
  FactRole,
  { roleKey: 'ramp' | 'removal' | 'boardwipe' | 'cardDraw' | null; subtype: string | null }
> = {
  ramp: { roleKey: 'ramp', subtype: null },
  cardDraw: { roleKey: 'cardDraw', subtype: null },
  tutor: { roleKey: 'cardDraw', subtype: 'tutor' },
  removal: { roleKey: 'removal', subtype: 'spot-removal' },
  counterspell: { roleKey: 'removal', subtype: 'counterspell' },
  boardwipe: { roleKey: 'boardwipe', subtype: null },
  protection: { roleKey: null, subtype: null },
  recursion: { roleKey: null, subtype: null },
  finisher: { roleKey: null, subtype: null },
  graveyardHate: { roleKey: null, subtype: null },
};

export const TIERS = ['primary', 'secondary', 'incidental'] as const;
export type Tier = (typeof TIERS)[number];

/**
 * Quantized on purpose: a tier is something a human can label and check
 * against oracle text; an arbitrary float is not.
 */
export const TIER_WEIGHT: Record<Tier, number> = { primary: 1, secondary: 0.6, incidental: 0.25 };

/** Does this fact fill a role slot? Incidental facts are recorded, never counted. */
export function countsAsRole(fact: { tier: Tier }): boolean {
  return fact.tier !== 'incidental';
}

export const SPEEDS = ['instant', 'flash', 'sorcery', 'activated', 'triggered', 'static'] as const;
export type Speed = (typeof SPEEDS)[number];

export const REPEATS = ['once', 'per-turn', 'per-event', 'repeatable', 'static'] as const;
export type Repeat = (typeof REPEATS)[number];

export const PROVENANCES = ['tag', 'parser', 'llm', 'manual'] as const;
export type Provenance = (typeof PROVENANCES)[number];

/** Role subtypes, per role. One flat list so the codec needs one table. */
export const ROLE_SUBS = [
  // ramp
  'dork',
  'rock',
  'mana',
  'land',
  'extra-land',
  'ritual',
  'treasure',
  'cost-reducer',
  'untap',
  'doubler',
  // cardDraw
  'draw',
  'cantrip',
  'loot',
  'wheel',
  'impulse',
  'dig',
  'group',
  'monarch',
  'clue',
  'gy-to-hand',
  // tutor (what it finds)
  'any',
  'creature',
  'artifact',
  'enchantment',
  'instant-sorcery',
  'planeswalker',
  'land-card',
  'permanent',
  'other',
  // removal
  'spot',
  'bounce',
  'edict',
  // recursion
  'to-hand',
  'to-battlefield',
  'cast-from-gy',
  // finisher
  'alt-win',
  'overrun',
  'extra-combat',
  'drain',
  'mass-steal',
] as const;
export type RoleSub = (typeof ROLE_SUBS)[number];

export const MODES = [
  'destroy',
  'exile',
  'bounce',
  'damage',
  'shrink',
  'sacrifice',
  'tuck',
  'steal',
  'neutralize',
  'fight',
  'counter',
] as const;
export type InteractionMode = (typeof MODES)[number];

export const HITS = [
  'creature',
  'artifact',
  'enchantment',
  'planeswalker',
  'land',
  'battle',
  'nonland-permanent',
  'permanent',
  'spell',
  'noncreature-spell',
  'creature-spell',
  'instant-sorcery-spell',
  'ability',
] as const;
export type Hit = (typeof HITS)[number];

export const SCOPES = ['single', 'multi', 'mass'] as const;
export type Scope = (typeof SCOPES)[number];

export const SIDES = ['any', 'opponents', 'all'] as const;
export type Side = (typeof SIDES)[number];

/**
 * Conditions that narrow a fact. `mv`/`power`/`toughness` bounds are encoded
 * with their number ("mv<=3"); the rest are flags.
 */
export const LIMIT_FLAGS = [
  'unless-pays', // soft counter
  'until-leaves', // O-Ring style: comes back if the source leaves
  'temporary', // until end of turn / next untap step
  'ultimate', // loyalty cost above starting loyalty
  'transform', // on a transform/flip back face
  'prepare', // a prepare card's spell face
  'modal', // one mode of a modal spell
  'overload', // only when overloaded
  'conditional', // gated by an if / as long as / threshold clause
  'combat', // attacking/blocking/tapped targets only
  'colour', // colour-restricted target (nonblack, white, ...)
  'nontoken',
  'token-only',
  'except', // a wipe with carve-outs
  'self-damage', // hits you or your board too (a symmetric trigger)
  'additional-cost', // kicker, a sacrifice or discard to cast
  'replacement', // "if you would ..., instead": modifies other effects
] as const;
export type LimitFlag = (typeof LIMIT_FLAGS)[number];
export type Limit = LimitFlag | `${'mv' | 'power' | 'toughness'}${'<=' | '>='}${number}`;

export const RESOURCES = [
  // ── one per AxisKey, computed by synergy/axes.ts ─────────────────────────
  'creature-token',
  'plus1-counter',
  'death',
  'lifegain',
  'landfall',
  'graveyard',
  'artifact',
  'equipment',
  'instant-sorcery',
  'enchantment',
  'loyalty',
  'creature-type',
  'etb',
  'vehicle',
  'group-hug',
  'energy',
  'aura',
  'discard',
  'mill',
  'monarch',
  'poison',
  'cycling',
  'venture',
  'dice',
  // ── beyond the axes ──────────────────────────────────────────────────────
  'mana',
  'cards',
  'treasure',
  'clue',
  'food',
  'other-token',
  'gy-to-hand',
  'gy-to-battlefield',
  'ltb',
  'cast-noncreature',
  'cast-creature',
  'attack',
  'other-counter',
  'copy',
  'untap',
  'extra-combat',
] as const;
export type Resource = (typeof RESOURCES)[number];

/** The axis each axis resource stands for; `null` for the extended resources. */
export const RESOURCE_AXIS: Record<Resource, AxisKey | null> = {
  'creature-token': 'tokens',
  'plus1-counter': 'counters',
  death: 'sacrifice',
  lifegain: 'lifegain',
  landfall: 'landfall',
  graveyard: 'graveyard',
  artifact: 'artifacts',
  equipment: 'equipment',
  'instant-sorcery': 'spellslinger',
  enchantment: 'enchantress',
  loyalty: 'superfriends',
  'creature-type': 'tribal',
  etb: 'blink',
  vehicle: 'vehicles',
  'group-hug': 'grouphug',
  energy: 'energy',
  aura: 'auras',
  discard: 'discard',
  mill: 'mill',
  monarch: 'monarch',
  poison: 'poison',
  cycling: 'cycling',
  venture: 'venture',
  dice: 'dice',
  mana: null,
  cards: null,
  treasure: null,
  clue: null,
  food: null,
  'other-token': null,
  'gy-to-hand': null,
  'gy-to-battlefield': null,
  ltb: null,
  'cast-noncreature': null,
  'cast-creature': null,
  attack: null,
  'other-counter': null,
  copy: null,
  untap: null,
  'extra-combat': null,
};

/** The resource that stands for an axis (inverse of RESOURCE_AXIS). */
export const AXIS_RESOURCE = Object.fromEntries(
  (Object.entries(RESOURCE_AXIS) as [Resource, AxisKey | null][])
    .filter(([, axis]) => axis !== null)
    .map(([resource, axis]) => [axis, resource])
) as Record<AxisKey, Resource>;

// ── Clause-level abilities: (trigger, effects) tuples ──────────────────────

export const ABILITY_KINDS = [
  'spell', // an instant/sorcery face's text
  'etb', // "When cardname enters, ..."
  'trigger', // any other when/whenever/at
  'chapter', // a Saga chapter
  'activated', // cost: effect
  'loyalty', // +N/-N: effect
  'static', // everything else on a permanent
] as const;
export type AbilityKind = (typeof ABILITY_KINDS)[number];

/**
 * Controller polarity of a trigger's subject or an effect's object:
 * you (yours), opp (an opponent's / each opponent), each (every player,
 * yours included), any (a target you choose, or no controller named), self
 * (the card itself).
 */
export const POLARITIES = ['you', 'opp', 'each', 'any', 'self'] as const;
export type Polarity = (typeof POLARITIES)[number];

export const TRIGGER_EVENTS = [
  'enters',
  'dies',
  'leaves',
  'attacks',
  'blocks',
  'combat-damage',
  'damage',
  'cast',
  'draw',
  'discard',
  'sacrifice',
  'gain-life',
  'lose-life',
  'upkeep',
  'end-step',
  'combat',
  'draw-step',
  'main-phase',
  'tapped-for-mana',
  'counter-put',
  'token-created',
  'cycle',
  'targeted',
  'leave-graveyard',
  'mill',
  'chapter',
  'other',
] as const;
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

export const EFFECT_VERBS = [
  // interaction
  'destroy',
  'exile',
  'bounce',
  'tuck',
  'damage',
  'shrink',
  'sacrifice',
  'steal',
  'fight',
  'counter',
  'neutralize',
  'tap',
  'gy-hate',
  // cards
  'draw',
  'discard',
  'mill',
  'scry',
  'surveil',
  'dig',
  'impulse',
  'search',
  // board and resources
  'add-mana',
  'token',
  'put-counter',
  'proliferate',
  'gain-life',
  'lose-life',
  'reanimate',
  'regrow',
  'cast-from-gy',
  'blink',
  'copy',
  'untap',
  'extra-combat',
  'extra-turn',
  'win',
  'lose-game',
  'monarch',
  'initiative',
  'pump',
  'grant',
  'cost-less',
  'extra-land',
  'land-to-battlefield',
  'energy',
  'prevent',
  'phase-out',
  'goad',
] as const;
export type EffectVerb = (typeof EFFECT_VERBS)[number];

/**
 * Game zones. A library position is its own value because it matters: a
 * tutor to the top of the library (Vampiric Tutor) is not one to hand.
 */
export const ZONES = [
  'library',
  'library-top',
  'library-bottom',
  'hand',
  'battlefield',
  'graveyard',
  'exile',
  'stack',
  'command',
] as const;
export type Zone = (typeof ZONES)[number];

/**
 * A trigger, modelled the way a rules engine models one: an event mode, the
 * zone change it watches (origin → destination; null when the mode is not a
 * zone change or a side is unconstrained) and a valid-card filter (`object`
 * type + controller `who`). "Dies" is battlefield → graveyard; landfall is
 * enters/land/you.
 */
export interface TriggerSig {
  event: TriggerEvent;
  from: Zone | null;
  to: Zone | null;
  /** What the event is about: creature, land, spell:noncreature, card, self, ... */
  object: string;
  who: Polarity;
}

/** An effect: action, target filter (object + controller) and the zones it moves the object between. */
export interface EffectSig {
  verb: EffectVerb;
  /** Canonical object noun: creature, nonland-permanent, spell:noncreature, card:creature, token:treasure, ... */
  object: string;
  who: Polarity;
  amount: number | 'X' | null;
  from: Zone | null;
  to: Zone | null;
  /** Filled for interaction verbs; empty otherwise. */
  hits: Hit[];
  scope: Scope;
  limits: Limit[];
}

export interface AbilityFact {
  face: number;
  kind: AbilityKind;
  speed: Speed;
  repeat: Repeat;
  /** Activated cost atoms: tap, mana, sac:creature, discard, life, exile-gy, ... */
  cost: string[];
  trigger: TriggerSig | null;
  effects: EffectSig[];
  limits: Limit[];
  /** A bullet mode of a modal spell or ability. */
  modal: boolean;
  /** Loyalty cost for a loyalty ability (signed), else null. */
  loyalty: number | 'X' | null;
}

interface FactBase {
  /** Index into CardFacts.abilities; -1 for a card-level fact (a tag with no text). */
  ability: number;
  face: number;
  speed: Speed;
  repeat: Repeat;
  limits: Limit[];
  conf: number;
  src: Provenance[];
}

export interface RoleFact extends FactBase {
  role: FactRole;
  tier: Tier;
  sub: RoleSub | null;
}

export interface InteractionFact extends FactBase {
  mode: InteractionMode;
  hits: Hit[];
  scope: Scope;
  side: Side;
}

export interface FlowFact {
  r: Resource;
  /** Index into CardFacts.abilities; -1 when no single ability carries it. */
  ability: number;
  face: number;
  repeat: Repeat;
  conf: number;
  src: Provenance[];
}

export interface CardFacts {
  /** The primary key. Name keys are secondary lookups (see factsNameKey). */
  oracleId: string;
  /** Scryfall's full name ("Fire // Ice"). */
  name: string;
  layout: string;
  /** Card types across every face, lowercased: creature, instant, land, ... */
  types: string[];
  /** Scryfall keywords, lowercased. */
  keywords: string[];
  /** Front face power/toughness when printed as numbers ("*" and X are null). */
  pt: [number | null, number | null] | null;
  /** Mana value, or null when the input didn't carry one. */
  mv: number | null;
  abilities: AbilityFact[];
  roles: RoleFact[];
  interaction: InteractionFact[];
  produces: FlowFact[];
  payoffs: FlowFact[];
  /**
   * Named functions with a strength in (0, 1]: every counted role and role
   * subtype ("removal", "ramp/dork"), plus niche functions read from the
   * tuples ("grave-pact", "sac-outlet", "sac-fodder", "big-body", ...). See
   * functions.ts. Butcher of Malakir reads { grave-pact: 1, sac-fodder: 0.4,
   * big-body: 0.3, ... }; a query asks for a function by name.
   */
  strengths: Record<string, number>;
}

/** A role fact with its derived weight, as the accessor hands it out. */
export type WeightedRoleFact = RoleFact & { weight: number };

/**
 * The Scryfall fields the extractor reads. A subset of the bulk `oracle_cards`
 * record (and of the app's ScryfallCard), so the build script, the gold set and
 * a live card can all feed it.
 */
export interface FactsInputCard {
  oracle_id: string;
  name: string;
  layout?: string;
  type_line?: string;
  mana_cost?: string;
  oracle_text?: string;
  keywords?: string[];
  loyalty?: string;
  power?: string;
  toughness?: string;
  /** Scryfall's mana value (the front face's, for a double-faced card). */
  cmc?: number;
  card_faces?: Array<{
    name: string;
    type_line?: string;
    mana_cost?: string;
    oracle_text?: string;
    loyalty?: string;
    power?: string;
    toughness?: string;
  }>;
}

/**
 * Lookup key for a card name: the FRONT face, case- and accent-folded, curly
 * apostrophes straightened. "Fire // Ice", "fire" and "FIRE" share a key;
 * "Brainstorm" never reaches "Harmonized Trio // Brainstorm".
 */
export function factsNameKey(name: string): string {
  return frontFaceName(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .toLowerCase()
    .trim();
}
