/**
 * Commander synergy analyzer.
 *
 * Pure, dependency-free module that breaks a commander down line-by-line
 * into the ability "keywords" it cares about — the same technique the
 * "build a Commander deck from scratch" process calls finding your themed
 * cards. From the parsed abilities it derives:
 *
 *  - a plain-English game-plan summary
 *  - the EDHREC theme names the deck should lean into (for preselect)
 *  - a primary archetype hint
 *
 * `whyCardMatches` (the "why it fits" pills) builds on this in whyCardMatches.ts.
 *
 * No network, no store, no React — fully unit-testable and reused by both
 * the one-shot generator and the guided builder.
 */
import { Archetype } from '@/deck-builder/types';
import type { ScryfallCard } from '@/deck-builder/types';
import { creatureTypePlurals, resolveCreatureType } from '@/deck-builder/services/synergy/text';

// ─── Public types ────────────────────────────────────────────────────

export type CommanderKeyword =
  | 'etb'
  | 'creature-etb'
  | 'attack-trigger'
  | 'sacrifice'
  | 'dies-trigger'
  | 'plus-one-counters'
  | 'minus-counters'
  | 'proliferate'
  | 'counters-generic'
  | 'leaves-battlefield'
  | 'tokens'
  | 'lifegain'
  | 'lifeloss-drain'
  | 'draw'
  | 'wheel-discard'
  | 'tutor'
  | 'mill'
  | 'graveyard-recursion'
  | 'spellcast'
  | 'artifact-matters'
  | 'enchantment-matters'
  | 'landfall'
  | 'extra-combat'
  | 'extra-turn'
  | 'untap-engine'
  | 'monarch'
  | 'group-hug'
  | 'ramp'
  | 'voltron'
  | 'tribal';

export interface CommanderAbility {
  keyword: CommanderKeyword;
  /** Human label, e.g. "Enters-the-battlefield trigger". */
  label: string;
  /** The exact clause from the commander's text that matched. */
  evidence: string;
  /** What the deck should look for to feed this ability. */
  wants: string[];
  /** EDHREC theme names (lowercased) this ability suggests leaning into. */
  themes: string[];
  archetypeHint?: Archetype;
  /**
   * Per-instance override for the archetype vote weight (see
   * `pickPrimaryArchetype`). Only set for the structurally-detected voltron
   * ability below, whose confidence scales with how much evasion/protection
   * evidence the commander actually has — everything from the oracle-text
   * DETECTORS list keeps using the static per-keyword weight table instead.
   */
  archWeight?: number;
}

export interface CommanderProfile {
  commanderName: string;
  colorIdentity: string[];
  abilities: CommanderAbility[];
  primaryArchetype: Archetype;
  /** Deduped, ranked EDHREC theme names to preselect. */
  suggestedThemes: string[];
  /** One/two-sentence plain-English game plan. */
  summary: string;
  /** Detected creature subtypes (tribes), e.g. ["spirit"]. */
  tribes: string[];
}

// ─── Text extraction ─────────────────────────────────────────────────

/**
 * Combine oracle text across the main card and every face (DFC, MDFC,
 * transform, split), strip reminder text in parentheses, and neutralize
 * the card's own name so generic patterns like "when ~ enters" still
 * match self-referential oracle text.
 */
export function getCombinedOracleText(card: ScryfallCard): string {
  const parts: string[] = [];
  if (card.oracle_text) parts.push(card.oracle_text);
  for (const face of card.card_faces ?? []) {
    if (face.oracle_text) parts.push(face.oracle_text);
  }
  let text = parts.join('\n');

  // Neutralize the card's own name(s) → "~"
  const names = new Set<string>();
  if (card.name) {
    names.add(card.name);
    if (card.name.includes(',')) names.add(card.name.split(',')[0].trim());
  }
  for (const face of card.card_faces ?? []) {
    if (face.name) {
      names.add(face.name);
      if (face.name.includes(',')) names.add(face.name.split(',')[0].trim());
    }
  }
  for (const n of [...names].sort((a, b) => b.length - a.length)) {
    if (n.length >= 3) text = text.split(n).join('~');
  }

  // Drop reminder text in parentheses, collapse whitespace, lowercase.
  return text
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

/**
 * A creature commander whose back face is a land (the Ojer gods, "Temple of
 * Power") keeps only its creature face: the land face's "{T}: Add {R}" is a plain
 * land tap, not a mana engine the deck is built around.
 */
function withoutLandFaces(card: ScryfallCard): ScryfallCard {
  const faces = card.card_faces;
  if (!faces || faces.length < 2 || /\bland\b/i.test(frontTypeLine(card))) return card;
  return {
    ...card,
    card_faces: faces.filter((f, i) => i === 0 || !/\bland\b/i.test(f.type_line ?? '')),
  };
}

/** Split combined text into clauses for evidence extraction. */
function clauses(text: string): string[] {
  return text
    .split(/[.\n•;]+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** First clause matching the pattern, capped for display. */
function findEvidence(text: string, pattern: RegExp): string | null {
  for (const c of clauses(text)) {
    if (pattern.test(c)) {
      const trimmed = c.length > 160 ? c.slice(0, 157) + '…' : c;
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    }
  }
  return null;
}

// ─── Tribal subtypes ─────────────────────────────────────────────────

export function frontTypeLine(card: ScryfallCard): string {
  if (card.card_faces?.[0]?.type_line) return card.card_faces[0].type_line;
  return card.type_line ?? '';
}

// Exported for reuse by the qualified-payoff nonbo check (E106) — creature
// TYPE qualifiers ("another Elf") are matched against this same tribe list.
export const KNOWN_TRIBES = new Set([
  'elf',
  'goblin',
  'zombie',
  'vampire',
  'dragon',
  'angel',
  'demon',
  'wizard',
  'warrior',
  'rogue',
  'cleric',
  'soldier',
  'knight',
  'merfolk',
  'spirit',
  'dinosaur',
  'pirate',
  'cat',
  'dog',
  'beast',
  'elemental',
  'sliver',
  'ally',
  'human',
  'faerie',
  'eldrazi',
  'horror',
  'insect',
  'tyranid',
  'hydra',
  'werewolf',
  'wolf',
  'rat',
  'squirrel',
  'bird',
  'phoenix',
  'sphinx',
  'minotaur',
  'ninja',
  'samurai',
  'fungus',
  'treefolk',
  'ape',
  'bear',
  'snake',
  'spider',
  'shaman',
  'druid',
  'monk',
  'giant',
  'golem',
  'construct',
  'dwarf',
  'kithkin',
  'kor',
  'rebel',
  'soldier',
  'assassin',
  'berserker',
  'centaur',
  'satyr',
  'gorgon',
]);

/**
 * EDHREC's theme name for a tribe, the way its typal pages spell it: the
 * type's plural, irregulars included ("dwarf" → "dwarves", "fungus" →
 * "fungi", "kor" → "kor"). A naive "+s" suggested themes like "phoenixs".
 */
function tribeTheme(tribe: string): string {
  return creatureTypePlurals(resolveCreatureType(tribe) ?? tribe)[0].toLowerCase();
}

/** Every creature subtype on the front face, lowercased. */
function ownSubtypes(card: ScryfallCard): string[] {
  const tl = frontTypeLine(card).toLowerCase();
  if (!tl.includes('creature')) return [];
  const dash = tl.split(/[—–-]/);
  if (dash.length < 2) return [];
  return dash[dash.length - 1].split(/\s+/).filter(Boolean);
}

/** Does the (lowercased, name-neutralized) text name this creature type, singular or plural? */
function mentionsType(text: string, type: string): boolean {
  const forms = new Set([
    type,
    `${type}s`,
    ...creatureTypePlurals(resolveCreatureType(type) ?? type).map((p) => p.toLowerCase()),
  ]);
  const alt = [...forms].map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`\\b(?:${alt})\\b`).test(text);
}

/**
 * The text a type mention has to survive in to count as a tribal reference.
 * Dropped: exclusions ("non-Human", "protection from Humans") and the single token a
 * commander makes (Adeline's Human token is a Human-making commander, not a Human
 * lord). Everything that remains names the type as something the commander
 * rewards or counts.
 */
function typalText(text: string): string {
  return text
    .replace(/\bnon-?[a-z]+/g, ' ')
    .replace(/\bprotection from [^.,;]*/g, ' ')
    .replace(/\bcreates? (?:an?|one) [^.]*?\btoken\b/g, ' ');
}

export function detectTribes(card: ScryfallCard): string[] {
  const tl = frontTypeLine(card).toLowerCase();
  if (!tl.includes('creature')) return [];
  const dash = tl.split(/[—–-]/);
  if (dash.length < 2) return [];
  const subtypes = dash[dash.length - 1]
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return subtypes.filter((s) => KNOWN_TRIBES.has(s));
}

// ─── Detectors ───────────────────────────────────────────────────────
//
// Each detector knows how to recognize the ability on the COMMANDER, and
// how to recognize a candidate card that FEEDS that ability (for the
// "why this card" badges in `whyCardMatches`).

interface Detector {
  keyword: CommanderKeyword;
  label: string;
  /** Recognizes the ability on the commander's own text. */
  commander: RegExp;
  wants: string[];
  themes: string[];
  archetypeHint?: Archetype;
  /**
   * How strongly this ability signals the deck's primary archetype.
   * Defaults to 2; weak/incidental signals (e.g. "attacks") use 1 so a
   * combat clause on a sacrifice commander doesn't read as an aggro deck.
   */
  archWeight?: number;
}

/**
 * Lookahead that rules out the verb sense of "counter": "Counter target spell",
 * "Counter that spell unless", "counter it", "counter all", "counter up to one".
 * A marker counter ("a +1/+1 counter", "counters on", "a counter on") never
 * reads like that, so the counter detectors append it to their bare-word test.
 */
export const NOT_COUNTERSPELL = String.raw`(?! (?:target|that|unless|it|this|all|each|up to|a|an|the|any|another)\b)`;

const DETECTORS: Detector[] = [
  {
    keyword: 'etb',
    label: 'Enters-the-battlefield trigger',
    commander:
      /\b(?:when|whenever)\b[^.,]*?~[^.,]*?\benters?\b|\bentering the battlefield causes\b|\bpermanents? entering (?:the battlefield )?causes?\b|\btriggers? an additional time\b|\bexile\b[^.]*?\bthen return (?:it|that card|them|those cards)\b|\breturn (?:that card|it|them|those cards) to the battlefield under (?:its|their) owners?'?s?'? control\b/,
    wants: ['Blink and flicker effects to re-trigger it', 'Creatures with strong ETB abilities'],
    themes: ['blink', 'flicker', 'etb'],
  },
  {
    // Pays off OTHER creatures entering ("whenever a creature you control
    // enters"). Distinct from 'etb', which is the commander's own ability. The
    // [^.,] stops "whenever a creature dies, ... enters" from reading as this.
    keyword: 'creature-etb',
    label: 'Creature-enters trigger',
    commander:
      /\b(?:whenever|when) (?!(?:(?!\benters?\b)[^.,])*?(?<!\bor )\b(?:lands?|permanents?|artifacts?|enchantments?|equipment|auras?|vehicles?|sagas?|planeswalkers?|battles?|(?<!creature )tokens?)\b(?! or\b)[^.,]*?\benters?\b)(?:~ (?:or|and\/or) )?(?:another|other|one or more|an?|each|every)\b[^.,]*?\benters?\b|\beach other [a-z ]*?you control enters\b|\b(?:each|every|another|other)\b[^.,]*?\bcreatures?\b[^.,]*?\benters? with (?:an? |\d+ |x )?(?:additional|extra)\b/,
    wants: ['Token makers and creature reanimation', 'Blink effects that re-enter creatures'],
    themes: ['tokens', 'reanimator', 'blink'],
  },
  {
    keyword: 'attack-trigger',
    label: 'Attack trigger',
    // Second branch: the attack-trigger DOUBLER idiom ("If a creature [you
    // control] attacking causes a triggered ability ... to trigger, it
    // triggers an additional time") carries no when/whenever token, so the
    // first branch misses it. The literal phrase "attacking causes" exists on
    // exactly 2 legal commanders in all of Magic (Isshin, Wulfgar of Icewind
    // Dale; Scryfall o:"attacking causes") — no false-positive surface.
    commander: /\b(when|whenever)\b[^.]*?\battacks?\b|\battacking causes\b/,
    wants: ['Evasion so it connects safely', 'Extra combat steps', 'Go-wide attackers'],
    themes: ['combat', 'aggro', 'extra combat', 'attack triggers'],
    archetypeHint: Archetype.AGGRO,
    archWeight: 1,
  },
  {
    keyword: 'sacrifice',
    label: 'Sacrifice payoff',
    commander:
      /^(?!.*\b(?:unless|ward)\b)(?!.*\bcan't be sacrificed\b).*(?:\bsacrifice (?!~|it\b|this (?:creature|permanent|artifact|land|enchantment)\b|them\b|that\b)[a-z0-9{]|\beach player sacrifices\b|\bsacrifice (?:it|that token|them|those tokens) at\b|\bwhenever (?:you|a player|an opponent|another player)(?: control)? sacrifices?\b|\bsacrificed\b)/,
    wants: [
      'Cheap, expendable creatures and tokens as fodder',
      'Recursion to rebuy sacrificed cards',
      'Aristocrats drain payoffs',
    ],
    themes: ['aristocrats', 'sacrifice'],
    archetypeHint: Archetype.ARISTOCRATS,
  },
  {
    keyword: 'dies-trigger',
    label: 'Death trigger',
    commander: /\b(when|whenever)\b[^.]*?\bdies\b/,
    wants: ['Sacrifice outlets', 'Expendable creatures and tokens'],
    themes: ['aristocrats', 'sacrifice'],
    archetypeHint: Archetype.ARISTOCRATS,
  },
  {
    keyword: 'plus-one-counters',
    label: '+1/+1 counter synergy',
    commander: /\+1\/\+1 counter/,
    wants: [
      'Proliferate and counter doublers',
      'Counter-matters payoffs',
      'Ways to move/use counters',
    ],
    themes: ['+1/+1 counters', 'counters', 'proliferate'],
  },
  {
    keyword: 'minus-counters',
    label: '-1/-1 counter synergy',
    commander: /-1\/-1 counter/,
    wants: ['Proliferate', '-1/-1 counter payoffs', 'Wither / infect support'],
    themes: ['-1/-1 counters', 'counters', 'proliferate'],
  },
  {
    keyword: 'proliferate',
    label: 'Proliferate',
    commander:
      /\bproliferate\b|\bdouble the number of [^.]*?\bcounters?\b|\btwice that many\b[^.]*?\bcounters?\b|\bthat many plus (?:one|two)\b[^.]*?\bcounters?\b/,
    wants: ['Cards that place counters of any kind', 'Counter payoffs to scale'],
    themes: ['proliferate', 'counters'],
    // Singular only (as before); the bare word also read "Counter target spell".
  },
  {
    keyword: 'counters-generic',
    label: 'Counter synergy',
    commander: /\bcounters? (on|from|among)\b/,
    wants: ['Counter generators', 'Counter doublers and proliferate'],
    themes: ['counters', 'proliferate'],
    // Marker counters only, not counterspell phrasing.
  },
  {
    keyword: 'leaves-battlefield',
    label: 'Leaves-the-battlefield trigger',
    commander:
      /\bleaves the battlefield\b|\bor leaving the battlefield\b|\bdies or is put into exile\b|\bis put into exile from the battlefield\b/,
    wants: ['Blink, flicker and bounce to reuse it', 'Sacrifice outlets'],
    themes: ['blink', 'flicker'],
  },
  {
    keyword: 'tokens',
    label: 'Token maker',
    commander:
      /\bcreates?\b[^.]*?(?:\bcreature tokens?\b|\b(?:\d+|x)\/(?:\d+|x)\b|\btokens? that's a copy\b|\ba copy of\b)|\bpopulate\b|\bamass\b|\btokens? you control\b|\btokens? would be created\b|\bwhenever you create (?:a|one or more) (?:creature )?tokens?\b/,
    wants: ['Token doublers', 'Anthems and go-wide payoffs', 'Sacrifice outlets to convert tokens'],
    themes: ['tokens', 'go wide'],
    archetypeHint: Archetype.TOKENS,
  },
  {
    keyword: 'lifegain',
    label: 'Lifegain synergy',
    commander: /\bgains? \d* ?life\b|\bwhenever you gain life\b/,
    wants: ['Repeatable lifegain', 'Lifegain payoffs'],
    themes: ['lifegain', 'life gain'],
  },
  {
    keyword: 'lifeloss-drain',
    label: 'Drain / life loss',
    commander:
      /\b(?:each|target|defending|that|an) (?:opponent|player|other player)s? loses?\b[^.]*?\blife\b|\b(?:loses|they lose) (?:\d+|x|that much|half)\b[^.]*?\blife\b|\bopponents? loses? life\b|\bopponents? who lost life\b|\bdrains?\b|\bextort\b/,
    wants: ['Repeatable drain effects', 'Aristocrats payoffs'],
    themes: ['lifedrain', 'aristocrats'],
    archetypeHint: Archetype.ARISTOCRATS,
  },
  {
    keyword: 'draw',
    label: 'Card draw engine',
    commander: /\bdraws? (a|\d+|x|that many)? ?cards?\b/,
    wants: ['Low curve so you can use the cards', 'Payoffs for a full hand'],
    themes: ['card draw'],
  },
  {
    keyword: 'wheel-discard',
    label: 'Wheel / discard',
    commander:
      /\beach player discards (?:their|his or her) hand\b|\bdiscard your hand\b|\bwhenever (?:you|a player|an opponent|one or more players?) discards?\b/,
    wants: ['Discard payoffs', 'Reanimation / graveyard value'],
    themes: ['wheels', 'discard'],
  },
  {
    keyword: 'tutor',
    label: 'Tutor',
    commander:
      /\bsearch(?:es)? (?:your|their) library for (?!(?:up to (?:one|two|three|x|that many) |a |an |any number of |x )?(?:basic |snow |nonbasic )?(?:land|forest|island|mountain|plains|swamp|gate|desert|mount)s? ?(?:cards?)?\b)/,
    wants: ['High-impact targets worth tutoring for', 'Combo finishers'],
    themes: ['tutors', 'combo'],
  },
  {
    keyword: 'mill',
    label: 'Mill / self-mill',
    commander:
      /\bmills?\b|\bputs? [^.]*?\binto (?:your|their|its owner's|a|that player's|each opponent's) graveyards?\b(?! from (?:anywhere|the battlefield))/,
    wants: ['Graveyard payoffs', 'Reanimation'],
    themes: ['mill', 'graveyard'],
    archetypeHint: Archetype.REANIMATOR,
  },
  {
    keyword: 'graveyard-recursion',
    label: 'Graveyard recursion',
    commander:
      /\breturns?\b[^.]*?\bgraveyard\b|\bfrom (?:your|a|an opponent's|target opponent's|each) graveyards? (?:onto|to) the battlefield\b|\b(?:cast|play)\b[^.]*?\bfrom (?:your|a) graveyard\b|\b(?:retrace|flashback|unearth|embalm|eternalize|disturb)\b|\banother\b[^.]*?\bdies\b[^.]*?\breturn (?:it|that card|them)\b/,
    wants: ['Self-mill and discard to stock the yard', 'Recursive value targets'],
    themes: ['reanimator', 'graveyard'],
    archetypeHint: Archetype.REANIMATOR,
  },
  {
    keyword: 'spellcast',
    label: 'Spellcast trigger',
    commander:
      /^(?!.*\b(?:opponents? casts?|can't cast)\b).*(?:\bwhenever (?:you|a player) (?:cast|casts|copy)(?: or copy)? (?:an? |their |your )?(?:(?:first|second|third) (?:noncreature )?)?(?:adventure\b|noncreature|instant|sorcery|spell\b(?! (?:from|they don't own|that targets(?! only a single)))|white|blue|black|red|green|multicolored|colorless|historic|legendary|artifact, instant)|\bmagecraft\b|\bprowess\b|\binstants? (?:or|and) sorcer(?:y|ies)\b(?![^.]*?\b(?:cost[^.]*?less|from your graveyard|flashback)\b)|\binstants? and sorcery spells you cast with mana value\b|\bextort\b|\bstorm\b)/,
    wants: ['Cheap instants and sorceries', 'Cost reducers and rituals', 'Spell copy effects'],
    themes: ['spellslinger', 'storm'],
    archetypeHint: Archetype.SPELLSLINGER,
  },
  {
    keyword: 'artifact-matters',
    label: 'Artifact synergy',
    commander:
      /\b(?:treasures?|clues?|foods?|powerstones?|blood tokens?)\b|\bartifacts? (?:you control|spells?|cards?|tokens?)\b|\bother artifacts\b|\bnumber of artifacts\b|\bequipments?\b|\bequipped\b|\bhistoric\b|\baffinity for artifacts\b|\bmetalcraft\b|\bimprovise\b/,
    wants: ['Cheap artifacts and artifact tokens', 'Artifact payoffs'],
    themes: ['artifacts', 'treasures'],
    archetypeHint: Archetype.ARTIFACTS,
  },
  {
    keyword: 'enchantment-matters',
    label: 'Enchantment synergy',
    commander:
      /\bconstellation\b|(?<!or )\benchantments? (?:you control|spells?|cards?)\b|\bother enchantments\b|\bnumber of enchantments\b|(?<!non-)\bauras?\b|\bsagas?\b|\benchanted or equipped\b/,
    wants: ['Cheap enchantments and auras', 'Constellation payoffs'],
    themes: ['enchantress', 'enchantments'],
    archetypeHint: Archetype.ENCHANTRESS,
  },
  {
    keyword: 'landfall',
    label: 'Landfall',
    commander:
      /\blandfall\b|\bwhenever a land enters\b|\bplay (?:an|one|two|three|\d+) additional lands?\b|\bwhenever [^.]*?\bput (?:a|an) (?:basic )?land card\b[^.]*?\bonto the battlefield\b|\bthen you may put a land card\b[^.]*?\bonto the battlefield\b|\bland card from among (?:them|those cards)\b[^.]*?\bonto the battlefield\b|\bwhenever [^.]*?\bsearch your library for [^.]*?\blands?\b[^.]*?\bput (?:it|them) onto the battlefield\b/,
    wants: ['Extra land drops and land ramp', 'Fetch / land bounce for repeat triggers'],
    themes: ['landfall', 'lands'],
    archetypeHint: Archetype.LANDFALL,
  },
  {
    keyword: 'extra-combat',
    label: 'Extra combat',
    commander: /\badditional combat\b/,
    wants: ['Attack triggers worth repeating', 'Evasive threats'],
    themes: ['extra combat', 'combat'],
    archetypeHint: Archetype.AGGRO,
  },
  {
    keyword: 'extra-turn',
    label: 'Extra turns',
    commander: /\bextra turn\b|\badditional turn\b/,
    wants: ['Payoffs that snowball over turns', 'Protection to survive to the next one'],
    themes: ['extra turns', 'combo'],
    archetypeHint: Archetype.COMBO,
  },
  {
    keyword: 'untap-engine',
    label: 'Untap engine',
    commander: /\buntap (?!~|it\b|this\b|during\b|that creature\b)[a-z{]/,
    wants: ['Permanents worth untapping', 'Combo finishers'],
    themes: ['combo'],
    archetypeHint: Archetype.COMBO,
  },
  {
    keyword: 'monarch',
    label: 'Monarch',
    commander: /\bmonarch\b/,
    wants: ['Ways to defend the crown', 'Repeatable monarch triggers'],
    themes: ['monarch', 'politics'],
  },
  {
    keyword: 'group-hug',
    label: 'Group effects',
    commander:
      /\beach player (?:draws|gains (?!control)|may|adds|creates|loses \d+ life and draws)\b|\b(?:you and )?(?:target|each) opponent (?:each draw|may draw)\b|\bthat (?:attacking )?player draws\b|\bits controller may draw\b/,
    wants: ['Payoffs that turn shared resources to your favor', 'Protection / pillowfort'],
    themes: ['group hug', 'politics'],
  },
  {
    keyword: 'ramp',
    label: 'Mana / cost engine',
    commander:
      /\badds? (?:\{|x\b|an amount\b|one\b|two\b|three\b|that much\b|mana\b|an additional\b)|(?<!this )\bspells?\b[^.]*?\bcosts?\b[^.]*?\bless\b|\bcreates? [^.]*?\btreasure\b|\brather than pay that mana\b|\bsearch your library for [^.]*?\bland\b[^.]*?\bonto the battlefield\b|\bput (?:a|up to|any number of)[^.]*?\bland\b[^.]*?\bonto the battlefield\b/,
    wants: ['Big-mana payoffs to spend it on', 'Cost reducers'],
    themes: ['big mana', 'ramp'],
  },
];

// Voltron is detected structurally (not via a single oracle phrase). The text
// half asks whether the commander suits ITSELF up, not whether it mentions
// gear: "attach ... to ~", "if ~ is equipped", Aura/Equipment spells it makes
// cheaper or recasts, or a "commander you control" clause. Equipment tutors,
// buffs it hands to other creatures ("gains double strike") and "enchanted
// creature" removal are the gear-matters or support decks the golden set rejects.
const VOLTRON_TEXT =
  /\battach(?:ed)?\b[^.]*\bto (?:~|\b(?:it|him|her)\b)|(?:~|\b(?:it|he|she))(?: is|'s) (?:equipped|enchanted)\b|\b(?:aura|equipment)\b[^.]*\bspells?\b[^.]*\bcost\b|\bcast (?:an? )?(?:aura|equipment)\b[^.]*\bfrom\b|\bcommanders? you control\b/;
// The keyword route (evasion/protection stacks) only counts when the commander's
// text is about itself. Text that lends something to other creatures, triggers on
// other permanents or hits a target (Lyra's other Angels, Avacyn's indestructible,
// Atarka's Dragons) is a support or engine commander that happens to fly. Three or
// more keywords stand on their own.
const LENDS_OUTWARD =
  /\b(?:other|each|target|enters|dies|upkeep|proliferate)\b|\bwhenever (?:an?|you|one or more)\b|\bcreatures? you control\b/;
// A lone evasion/protection keyword plus "whenever ~ deals combat damage" is a
// commander that wants to connect (Vorosh, Black Widow).
// Double strike on its own is a voltron body unless the card hands it, or haste, to a whole team
// (Kratos, Sylvia Brightspear), and only when no engine is the main text (Oketra the True).
const TEAM_DOUBLE_STRIKE = /\b(?:all creatures|your team)\b/;
const SELF_COMBAT = /\bwhenever ~ deals combat damage\b/;
// A combat-damage payoff that rewards OTHER creatures (Prowler's counter on another target
// creature) is a support commander, not one that connects alone.
const PAYS_OTHER_CREATURES =
  /\banother (?:target )?creature\b|\btarget creature\b|\bother creatures\b|\bcreatures you control\b/;
// (a) of golden R11: the commander grows itself by its own action. A counter on
// itself from its own attack, combat damage or beginning-of-combat/turn trigger,
// or from a mana-paid activation. Growth that waits on OTHER things (another
// creature entering, you drawing) never matches because the trigger is named here.
const SELF_GROWTH =
  /\bwhenever ~ (?:attacks|deals combat damage)[^.]*(?:\.[^.]*)?\bput [^.]*?\+1\/\+1 counters? on (?:~|\b(?:it|him|her)\b)|\bwhenever ~ [^.,]*\battacks?\b[^.]*,[^.]*~ gets \+|\bat the beginning of (?:combat|your (?:upkeep|combat|turn|precombat main phase))[^.]*\bput [^.]*?\+1\/\+1 counters? on (?:~|\b(?:it|him|her)\b)|\}[^:.]*: [^.]*(?:\bput [^.]*?\+1\/\+1 counters? on (?:~|\b(?:it|him|her)\b)(?![^.]*(?:\.[^.]*)?\bcreates?\b)|~ gets \+)/;
// Evasion and protection the commander writes out on itself rather than as a
// Scryfall keyword ("can't be blocked", "it has hexproof").
const SELF_UNBLOCKABLE =
  /(?:~|\b(?:it|he|she)) can't be blocked(?! by (?:more than|creatures (?:with (?!power|greater)|of)))/;
const SELF_EVASION_TEXT: Array<[string, RegExp]> = [
  ['unblockable', SELF_UNBLOCKABLE],
  ['hexproof', /(?:~|\b(?:it|he|she)) (?:has|gains?) [^.]*\bhexproof\b/],
  ['protection', /(?:~|\b(?:it|he|she)) (?:has|gains?) [^.]*\bprotection from\b/],
  ['ward', /(?:~|\b(?:it|he|she)) (?:has|gains?) [^.]*\bward\b/],
  ['indestructible', /(?:~|\b(?:it|he|she)) (?:has|gains?) [^.]*\bindestructible\b/],
];
// Exported so the display-side playstyle index can recover these from oracle
// text for collection cards, which carry no Scryfall `keywords` array.
export const VOLTRON_KEYWORDS = new Set([
  'trample',
  'double strike',
  'flying',
  'menace',
  'hexproof',
  'shroud',
  'ward',
  'unblockable',
  'protection',
  'first strike',
  'indestructible',
  'deathtouch',
]);

// The community half of the voltron rule (golden R11). EDHREC's Voltron theme
// share is the Voltron tag's count over the sum of the page's theme counts.
// Under 4% on a page with 30 or more themed decks the commander is not voltron
// even when its text fits (Gisela, Emrakul and Gishath carry the keywords, not
// the deck). The share only vetoes: it never makes a commander voltron, and a
// thin or missing page leaves the text rule alone.
const VOLTRON_MIN_THEMED_DECKS = 30;
const VOLTRON_MIN_THEME_SHARE = 0.04;

/** The slice of EDHREC's commander-page themes the profile reads (an `EDHRECTheme` fits). */
export interface CommanderProfileTheme {
  name: string;
  slug?: string;
  count: number;
}

export interface CommanderProfileOptions {
  /** The commander's EDHREC page themes, when the page was fetched. Absent = text decides. */
  edhrecThemes?: ReadonlyArray<CommanderProfileTheme>;
}

function voltronVetoed(themes: ReadonlyArray<CommanderProfileTheme> | undefined): boolean {
  if (!themes) return false;
  let total = 0;
  let voltron = 0;
  for (const t of themes) {
    if (!(t.count > 0)) continue;
    total += t.count;
    if (t.slug === 'voltron' || t.name.toLowerCase() === 'voltron') voltron += t.count;
  }
  return total >= VOLTRON_MIN_THEMED_DECKS && voltron / total < VOLTRON_MIN_THEME_SHARE;
}

// ─── Profile builder ─────────────────────────────────────────────────

const ARCHETYPE_FALLBACK = Archetype.GOODSTUFF;

/** Past this many colors a deck needs its fixing unrestricted: the 5-color Ur-Dragon lost
 *  three shocklands to creature-only lands and its noncreature spells ran short (E1011 gate). */
const TYPAL_FIXING_MAX_COLORS = 3;

/**
 * The commander builds around one creature type, in few enough colors that a land
 * making any color for its creatures (Unclaimed Territory, Cavern of Souls) can stand
 * in for fixing: its creature spells are most of the deck.
 */
export function isTribalProfile(
  profile: Pick<CommanderProfile, 'abilities'>,
  colorIdentity: readonly string[]
): boolean {
  return (
    colorIdentity.length <= TYPAL_FIXING_MAX_COLORS &&
    profile.abilities.some((a) => a.keyword === 'tribal')
  );
}

export function buildCommanderProfile(
  commander: ScryfallCard,
  partner?: ScryfallCard | null,
  options?: CommanderProfileOptions
): CommanderProfile {
  const sources = [commander, ...(partner ? [partner] : [])];
  const text = sources.map((c) => getCombinedOracleText(withoutLandFaces(c))).join('\n');

  const abilities: CommanderAbility[] = [];
  const seen = new Set<CommanderKeyword>();

  for (const d of DETECTORS) {
    if (seen.has(d.keyword)) continue;
    const evidence = findEvidence(text, d.commander);
    if (!evidence) continue;
    seen.add(d.keyword);
    abilities.push({
      keyword: d.keyword,
      label: d.label,
      evidence,
      wants: d.wants,
      themes: d.themes,
      archetypeHint: d.archetypeHint,
    });
  }

  // Tribal: the text must say something about one of the commander's OWN creature
  // types (lords, "whenever another Elf enters", typal costs), or be a changeling
  // or "chosen type" lord. A legendary Human whose text never mentions Humans is
  // not a tribal commander (10% precision against the golden set when the type
  // line alone decided it). `tribes` stays the detected KNOWN_TRIBES subtypes.
  const tribes = [...new Set(sources.flatMap(detectTribes))];
  const typeText = typalText(text);
  const typal = [
    ...new Set(sources.flatMap((src) => ownSubtypes(src).filter((t) => mentionsType(typeText, t)))),
  ];
  const anyType = /\bchangeling\b|\bchosen creature type\b|\bcreature types?\b/.test(text);
  if (typal.length > 0 || anyType) {
    const themeNames = [...new Set(typal.map(tribeTheme))];
    abilities.push({
      keyword: 'tribal',
      label: 'Tribal',
      evidence:
        typal.length > 0 ? `Legendary ${typal.map(cap).join(' / ')}` : 'Cares about creature types',
      wants: [
        themeNames.length > 0
          ? `Other ${themeNames.join(' / ')} and tribal payoffs`
          : 'Creatures of one type and tribal payoffs',
        'Lords and anthems',
      ],
      themes: [...themeNames, 'tribal'],
      archetypeHint: Archetype.TRIBAL,
    });
  }

  // Voltron: a creature commander that suits itself up (equipment, auras, double
  // strike, a "commander you control" clause) or stacks two evasion/protection
  // keywords with no dominant engine. A lone flyer or a big vanilla body is not a
  // voltron plan: that rule alone was 12% precise against the golden set.
  const kw = new Set((commander.keywords ?? []).map((k) => k.toLowerCase()));
  const voltronHitSet = new Set([...kw].filter((k) => VOLTRON_KEYWORDS.has(k)));
  for (const [name, re] of SELF_EVASION_TEXT) if (re.test(text)) voltronHitSet.add(name);
  const voltronHits = [...voltronHitSet];
  const suitsUp = VOLTRON_TEXT.test(text) || SELF_GROWTH.test(text);
  const engineKeywords: CommanderKeyword[] = [
    'tokens',
    'sacrifice',
    'spellcast',
    'draw',
    'mill',
    'graveyard-recursion',
  ];
  const hasEngine = abilities.some((a) => engineKeywords.includes(a.keyword));
  if (
    !seen.has('voltron') &&
    !voltronVetoed(options?.edhrecThemes) &&
    frontTypeLine(commander).toLowerCase().includes('creature') &&
    (suitsUp ||
      (!hasEngine &&
        ((kw.has('double strike') && !TEAM_DOUBLE_STRIKE.test(text)) ||
          voltronHits.length >= 3 ||
          (voltronHits.length >= 2 && SELF_UNBLOCKABLE.test(text)) ||
          (voltronHits.length >= 1 && SELF_COMBAT.test(text) && !PAYS_OTHER_CREATURES.test(text)) ||
          (voltronHits.length >= 2 && !LENDS_OUTWARD.test(text)))))
  ) {
    abilities.push({
      keyword: 'voltron',
      label: 'Voltron threat',
      evidence: voltronHits.length ? `Has ${voltronHits.join(', ')}` : 'Suits up one threat',
      wants: [
        'Equipment and auras to suit it up',
        'Protection (hexproof, shroud, totem armor)',
        'Evasion to push damage',
      ],
      themes: ['voltron', 'equipment', 'auras'],
      archetypeHint: Archetype.VOLTRON,
      // Scale confidence with the evidence: a commander stacking 3-4 evasion/
      // protection keywords (flying + vigilance + deathtouch + lifelink, e.g.
      // Atraxa) is a much stronger voltron signal than the 2-keyword floor
      // that triggers this branch at all, and shouldn't lose the archetype
      // vote to a couple of incidental weight-2 oracle-text detectors
      // (e.g. extra-combat) just because they total the same as voltron's old
      // flat weight of 2. Capped so it can't run away on a keyword-heavy but
      // otherwise unfocused commander. Conversely, a text-only hit (zero
      // evasion/protection keywords — an equipment or "commander you control"
      // clause) is the weakest evidence this branch accepts and must not tie a
      // genuine signal like tribal, so it votes at weight 1 and only wins when
      // nothing else fired.
      archWeight: voltronHits.length ? Math.min(4, 2 + Math.max(0, voltronHits.length - 2)) : 1,
    });
  }

  const primaryArchetype = pickPrimaryArchetype(abilities);

  // Rank abilities by strategic weight, not detector array order: the
  // primary archetype's signals first, then by archetype weight. Without
  // this, an incidental low-weight signal (e.g. Teval's "attacks → mill"
  // attack trigger) crowds the real archetype's themes out of any
  // downstream top-N cap, so the preselected themes contradict the
  // detected archetype.
  const rankedAbilities = abilities
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const px = x.a.archetypeHint === primaryArchetype ? 0 : 1;
      const py = y.a.archetypeHint === primaryArchetype ? 0 : 1;
      if (px !== py) return px - py;
      const wx = x.a.archWeight ?? ARCH_WEIGHT_BY_KEYWORD.get(x.a.keyword) ?? 2;
      const wy = y.a.archWeight ?? ARCH_WEIGHT_BY_KEYWORD.get(y.a.keyword) ?? 2;
      if (wx !== wy) return wy - wx;
      return x.i - y.i;
    })
    .map((e) => e.a);

  // Suggested themes: strategy-ranked, deduped, breadth-first across abilities.
  // Round-robin (each ability's Nth theme in rank order) instead of draining one
  // ability's whole list first — otherwise a single ability that emits several
  // themes (e.g. an ETB → blink/flicker/etb) dominates the ordering and buries
  // every other detected ability's primary theme. Consumers (deck-identity
  // fallback themes, the playstyle index, the profile summary) all read this
  // list, so leading with one theme per ability keeps it representative of the
  // commander's distinct strategies rather than one mechanic's near-synonyms.
  const suggestedThemes: string[] = [];
  const maxThemes = rankedAbilities.reduce((m, a) => Math.max(m, a.themes.length), 0);
  for (let i = 0; i < maxThemes; i++) {
    for (const a of rankedAbilities) {
      const t = a.themes[i];
      if (t && !suggestedThemes.includes(t)) suggestedThemes.push(t);
    }
  }

  const summary = buildSummary(commander.name, rankedAbilities);

  return {
    commanderName: commander.name,
    colorIdentity: commander.color_identity ?? [],
    abilities: rankedAbilities,
    primaryArchetype,
    suggestedThemes,
    summary,
    tribes,
  };
}

// When weighted votes tie, prefer the more strategically defining
// archetype (a sacrifice/tokens/voltron identity beats incidental aggro).
const ARCHETYPE_PRECEDENCE: Archetype[] = [
  Archetype.ARISTOCRATS,
  Archetype.VOLTRON,
  Archetype.SPELLSLINGER,
  Archetype.TOKENS,
  Archetype.REANIMATOR,
  Archetype.ENCHANTRESS,
  Archetype.ARTIFACTS,
  Archetype.LANDFALL,
  Archetype.TRIBAL,
  Archetype.COMBO,
  Archetype.CONTROL,
  Archetype.AGGRO,
  Archetype.MIDRANGE,
  Archetype.GOODSTUFF,
];

const ARCH_WEIGHT_BY_KEYWORD = new Map<CommanderKeyword, number>(
  DETECTORS.map((d) => [d.keyword, d.archWeight ?? 2])
);

function pickPrimaryArchetype(abilities: CommanderAbility[]): Archetype {
  const weights = new Map<Archetype, number>();
  for (const a of abilities) {
    if (!a.archetypeHint) continue;
    const w = a.archWeight ?? ARCH_WEIGHT_BY_KEYWORD.get(a.keyword) ?? 2;
    weights.set(a.archetypeHint, (weights.get(a.archetypeHint) ?? 0) + w);
  }
  let best: Archetype | null = null;
  let bestW = 0;
  for (const [arch, w] of weights) {
    if (w > bestW) {
      best = arch;
      bestW = w;
    } else if (w === bestW && best !== null) {
      const cur = ARCHETYPE_PRECEDENCE.indexOf(best);
      const cand = ARCHETYPE_PRECEDENCE.indexOf(arch);
      if (cand !== -1 && (cur === -1 || cand < cur)) best = arch;
    }
  }
  return best ?? ARCHETYPE_FALLBACK;
}

function buildSummary(name: string, abilities: CommanderAbility[]): string {
  const short = name.includes(',') ? name.split(',')[0].trim() : name;
  if (abilities.length === 0) {
    return `${short} has no standard pattern. Pick your themes.`;
  }
  const phrases: Record<CommanderKeyword, string> = {
    etb: 'abuse enters-the-battlefield triggers',
    'creature-etb': 'profit as creatures enter the battlefield',
    'attack-trigger': 'attack to trigger powerful abilities',
    sacrifice: 'sacrifice creatures and artifacts for value',
    'dies-trigger': 'profit when your creatures die',
    'plus-one-counters': 'pile on +1/+1 counters',
    'minus-counters': 'spread -1/-1 counters',
    proliferate: 'proliferate counters',
    'counters-generic': 'build around counters',
    'leaves-battlefield': 'reuse permanents as they leave the battlefield',
    tokens: 'flood the board with tokens',
    lifegain: 'gain life and cash it in',
    'lifeloss-drain': 'drain your opponents',
    draw: 'draw a wall of cards',
    'wheel-discard': 'wheel and discard for value',
    tutor: 'tutor up your key pieces',
    mill: 'fill graveyards',
    'graveyard-recursion': 'grind value from the graveyard',
    spellcast: 'chain instants and sorceries',
    'artifact-matters': 'go wide on artifacts',
    'enchantment-matters': 'build an enchantment engine',
    landfall: 'ramp out lands for landfall',
    'extra-combat': 'take extra combat steps',
    'extra-turn': 'string together extra turns',
    'untap-engine': 'untap things for explosive turns',
    monarch: 'become and defend the monarch',
    'group-hug': 'bend shared resources your way',
    ramp: 'ramp into big plays',
    voltron: 'suit up a single threat and swing',
    tribal: 'go tall on a creature tribe',
  };
  const picks = abilities
    .slice(0, 3)
    .map((a) => phrases[a.keyword])
    .filter(Boolean);
  const list =
    picks.length <= 1
      ? (picks[0] ?? 'execute its game plan')
      : picks.slice(0, -1).join(', ') + ', and ' + picks[picks.length - 1];
  return `${short} wants to ${list}.`;
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
