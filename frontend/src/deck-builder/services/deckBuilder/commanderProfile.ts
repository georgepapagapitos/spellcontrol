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
    commander: /\b(when|whenever)\b[^.]*?\benters\b/,
    wants: ['Blink and flicker effects to re-trigger it', 'Creatures with strong ETB abilities'],
    themes: ['blink', 'flicker', 'etb'],
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
    commander: /\bsacrifices?\b/,
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
    commander: /\bproliferate\b/,
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
    commander: /\bleaves the battlefield\b/,
    wants: ['Blink, flicker and bounce to reuse it', 'Sacrifice outlets'],
    themes: ['blink', 'flicker'],
  },
  {
    keyword: 'tokens',
    label: 'Token maker',
    commander: /\b(create|creates)\b[^.]*?\btoken\b/,
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
    commander: /\beach opponent loses\b|\bdrains?\b|\bloses? \d* ?life\b/,
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
    commander: /\beach player (draws|discards)\b|\bdiscards? (their|your) hand\b/,
    wants: ['Discard payoffs', 'Reanimation / graveyard value'],
    themes: ['wheels', 'discard'],
  },
  {
    keyword: 'tutor',
    label: 'Tutor',
    commander: /\bsearch(es)? your library\b/,
    wants: ['High-impact targets worth tutoring for', 'Combo finishers'],
    themes: ['tutors', 'combo'],
  },
  {
    keyword: 'mill',
    label: 'Mill / self-mill',
    commander: /\bmills?\b|\bputs? [^.]*?into [^.]*?graveyard from [^.]*?library\b/,
    wants: ['Graveyard payoffs', 'Reanimation'],
    themes: ['mill', 'graveyard'],
    archetypeHint: Archetype.REANIMATOR,
  },
  {
    keyword: 'graveyard-recursion',
    label: 'Graveyard recursion',
    commander: /\breturns? [^.]*?from [^.]*?graveyard\b|\bfrom your graveyard\b/,
    wants: ['Self-mill and discard to stock the yard', 'Recursive value targets'],
    themes: ['reanimator', 'graveyard'],
    archetypeHint: Archetype.REANIMATOR,
  },
  {
    keyword: 'spellcast',
    label: 'Spellcast trigger',
    commander: /\bwhenever you cast\b[^.]*?\b(instant|sorcery|spell)\b|\bmagecraft\b|\bprowess\b/,
    wants: ['Cheap instants and sorceries', 'Cost reducers and rituals', 'Spell copy effects'],
    themes: ['spellslinger', 'storm'],
    archetypeHint: Archetype.SPELLSLINGER,
  },
  {
    keyword: 'artifact-matters',
    label: 'Artifact synergy',
    commander: /\bartifacts?\b/,
    wants: ['Cheap artifacts and artifact tokens', 'Artifact payoffs'],
    themes: ['artifacts', 'treasures'],
    archetypeHint: Archetype.ARTIFACTS,
  },
  {
    keyword: 'enchantment-matters',
    label: 'Enchantment synergy',
    commander: /\benchantments?\b|\bconstellation\b/,
    wants: ['Cheap enchantments and auras', 'Constellation payoffs'],
    themes: ['enchantress', 'enchantments'],
    archetypeHint: Archetype.ENCHANTRESS,
  },
  {
    keyword: 'landfall',
    label: 'Landfall',
    commander: /\blandfall\b|\bwhenever a land enters\b|\bplay an additional land\b/,
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
    commander: /\buntaps?\b[^.]*?\b(target|all|each|it)\b/,
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
    commander: /\beach player (draws|gains|may)\b/,
    wants: ['Payoffs that turn shared resources to your favor', 'Protection / pillowfort'],
    themes: ['group hug', 'politics'],
  },
  {
    keyword: 'ramp',
    label: 'Mana / cost engine',
    commander: /\badds? \{|\bmana of any\b|\bspells? [^.]*?costs? [^.]*?less\b/,
    wants: ['Big-mana payoffs to spend it on', 'Cost reducers'],
    themes: ['big mana', 'ramp'],
  },
];

// Voltron is detected structurally (not via a single oracle phrase).
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

// ─── Profile builder ─────────────────────────────────────────────────

const ARCHETYPE_FALLBACK = Archetype.GOODSTUFF;

export function buildCommanderProfile(
  commander: ScryfallCard,
  partner?: ScryfallCard | null
): CommanderProfile {
  const sources = [commander, ...(partner ? [partner] : [])];
  const text = sources.map(getCombinedOracleText).join('\n');

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

  // Tribal detection from the commander's own creature subtypes.
  const tribes = [...new Set(sources.flatMap(detectTribes))];
  if (tribes.length > 0) {
    const themeNames = [...new Set(tribes.map(tribeTheme))];
    abilities.push({
      keyword: 'tribal',
      label: 'Tribal',
      evidence: `Legendary ${tribes.map(cap).join(' / ')}`,
      wants: [`Other ${themeNames.join(' / ')} and tribal payoffs`, 'Lords and anthems'],
      themes: [...themeNames, 'tribal'],
      archetypeHint: Archetype.TRIBAL,
    });
  }

  // Voltron: a creature commander with stacked evasion/protection keywords
  // or notable power, and no dominant engine, wants equipment/auras.
  const kw = new Set((commander.keywords ?? []).map((k) => k.toLowerCase()));
  const voltronHits = [...kw].filter((k) => VOLTRON_KEYWORDS.has(k));
  const power = Number.parseInt(commander.power ?? '', 10);
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
    frontTypeLine(commander).toLowerCase().includes('creature') &&
    (voltronHits.length >= 2 || (!hasEngine && (voltronHits.length >= 1 || power >= 4)))
  ) {
    abilities.push({
      keyword: 'voltron',
      label: 'Voltron threat',
      evidence: voltronHits.length
        ? `Has ${voltronHits.join(', ')}`
        : `${commander.power ?? '?'} power evasive threat`,
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
      // otherwise unfocused commander. Conversely, a power-only hit (zero
      // evasion/protection keywords — e.g. a vanilla-statted 4-power typal
      // commander like High Perfect Morcant) is the weakest evidence this
      // branch accepts and must not tie a genuine signal like tribal, so it
      // votes at weight 1 and only wins when nothing else fired.
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
