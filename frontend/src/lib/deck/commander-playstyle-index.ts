import { Archetype } from '@/deck-builder/types';
import type { ScryfallCard } from '@/deck-builder/types';
import {
  buildCommanderProfile,
  getCombinedOracleText,
  VOLTRON_KEYWORDS,
} from '@/deck-builder/services/deckBuilder/commanderProfile';
import type { EnrichedCard } from '@/types/index';

/**
 * Commander → playstyle index — pure, network-free classification.
 *
 * The commander finder filters by playstyle two ways, and both read this file:
 *
 *  - **Every commander** — the finder asks Scryfall for commanders matching a
 *    playstyle's rules-text pattern ({@link playstyleScryfallClause}), and
 *    orders EDHREC's crowd list for that tag (`edhrecSlug`) first.
 *  - **Your own commanders** — classified here, instantly and offline, from the
 *    oracle text every owned card already carries.
 *
 * The rules-text pattern (`oracle`) is ONE regex source string used on both
 * sides: Scryfall runs it as `o:/…/`, and {@link classifyCommanderPlaystyles}
 * runs it as a JS RegExp. So a commander Scryfall returns for a playstyle is
 * always also classified under it here, and the tile can say so. Keep each
 * pattern inside the syntax both engines share (alternation, groups, classes,
 * `\b`, `?`, `*`; no lookbehind, no `~`).
 *
 * The local side also reuses {@link buildCommanderProfile} (the 28-detector
 * oracle reader the generator uses), so a playstyle can't drift from the
 * themes the builder detects. No I/O, no React — fully unit-testable.
 */

export interface Playstyle {
  /** Stable id (also the React key). */
  id: string;
  /** Human label for chips/headings. */
  label: string;
  /**
   * EDHREC tag slug, verified to resolve at /pages/tags/{slug}.json. Absent
   * when EDHREC has no tag for it (it has no generic typal page).
   */
  edhrecSlug?: string;
  /** One sentence saying what the playstyle does, shown when its chip is on. */
  blurb: string;
  /**
   * EDHREC theme names (as emitted by {@link buildCommanderProfile}) that signal
   * this playstyle. Theme overlap is the primary local signal.
   */
  themeSignals: string[];
  /**
   * Macro {@link Archetype}s that strongly indicate this playstyle. A primary
   * archetype match weighs more than an incidental ability hint.
   */
  archetypeSignals: Archetype[];
  /**
   * Rules-text pattern shared with Scryfall (see the file comment). Matched
   * case-insensitively against the combined oracle text, worth 1 point locally.
   */
  oracle?: string;
  /**
   * A Scryfall clause for a playstyle no rules-text pattern captures (typal),
   * paired with {@link Playstyle.localSignal} for the local side.
   */
  scryfallClause?: string;
  /** Local stand-in for `scryfallClause`, worth 1 point. */
  localSignal?: (card: { name: string; typeLine: string; oracleText: string }) => boolean;
}

/** Plural spellings a type line's singular subtype takes in rules text. */
function subtypeForms(subtype: string): string[] {
  const s = subtype.toLowerCase();
  const forms = [s, `${s}s`, `${s}es`];
  if (s.endsWith('f')) forms.push(`${s.slice(0, -1)}ves`);
  if (s.endsWith('y')) forms.push(`${s.slice(0, -1)}ies`);
  if (s === 'mouse') forms.push('mice');
  return forms;
}

/**
 * Typal: the commander's rules text names one of its own creature types
 * ("Other Goblins you control", "Squirrels you control get"), or asks for a
 * creature type. The card's own name is stripped first, so "Lathliss, Dragon
 * Queen" doesn't count the "Dragon" in its name.
 */
export function mentionsOwnSubtype(card: {
  name: string;
  typeLine: string;
  oracleText: string;
}): boolean {
  const front = card.typeLine.split(' // ')[0];
  const dash = front.indexOf('—');
  const text = card.oracleText.toLowerCase().split(card.name.toLowerCase()).join(' ');
  if (/choose a creature type|of the chosen type|creature type of your choice/.test(text)) {
    return true;
  }
  if (dash < 0) return false;
  const subtypes = front
    .slice(dash + 1)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return subtypes.some((sub) =>
    subtypeForms(sub).some((form) => new RegExp(`\\b${form}\\b`).test(text))
  );
}

/**
 * Curated, broadly-distinct playstyles. Every `oracle` pattern was checked
 * against Scryfall (2026-09-28) for a sensible commander count and top ten.
 * Order is the display order: the most-built styles first.
 */
export const PLAYSTYLES: Playstyle[] = [
  {
    id: 'aristocrats',
    label: 'Aristocrats',
    edhrecSlug: 'aristocrats',
    blurb: 'Sacrifice creatures for value and drain the table.',
    themeSignals: ['aristocrats', 'sacrifice', 'lifedrain'],
    archetypeSignals: [Archetype.ARISTOCRATS],
    oracle: String.raw`sacrifices? (a|an|another|x|one or more) (\w+ )?(creature|permanent|artifact)|whenever (a|another|one or more) (nontoken )?(\w+ )?creatures? (you control )?(dies|die)|each opponent loses \d+ life`,
  },
  {
    id: 'tokens',
    label: 'Tokens',
    edhrecSlug: 'tokens',
    blurb: 'Flood the board with tokens, then pump and swing.',
    themeSignals: ['tokens', 'go wide'],
    archetypeSignals: [Archetype.TOKENS],
    oracle: String.raw`create[sd]? [^.]*creature tokens?|creatures you control get \+|creature tokens you control|populate`,
  },
  {
    id: 'voltron',
    label: 'Voltron',
    edhrecSlug: 'voltron',
    blurb: 'Suit up one threat with equipment and auras and connect.',
    themeSignals: ['voltron', 'equipment', 'auras'],
    archetypeSignals: [Archetype.VOLTRON],
    oracle: String.raw`equipped creature|enchanted creature|\bequip\b|aura spells?|auras? (and|or) equipment|equipment (and|or) auras?`,
  },
  {
    id: 'spellslinger',
    label: 'Spellslinger',
    edhrecSlug: 'spellslinger',
    blurb: 'Chain instants and sorceries for payoffs.',
    themeSignals: ['spellslinger', 'storm'],
    archetypeSignals: [Archetype.SPELLSLINGER],
    oracle: String.raw`instant (or|and) sorcery|noncreature spells?|whenever you cast (an|your) (instant|sorcery)|copy (target|that) (instant|sorcery|spell)`,
  },
  {
    id: 'counters',
    label: '+1/+1 counters',
    edhrecSlug: 'proliferate',
    blurb: 'Grow creatures with counters and proliferate.',
    themeSignals: ['+1/+1 counters', 'counters', 'proliferate'],
    archetypeSignals: [],
    oracle: String.raw`\+1\/\+1 counters?|proliferate`,
  },
  {
    id: 'tribal',
    label: 'Tribal',
    blurb: 'Build around one creature type and its lords.',
    // Not the profile's 'tribal' theme: that fires for any creature subtype on
    // the type line, which would file every Human Wizard here.
    themeSignals: [],
    archetypeSignals: [],
    scryfallClause: 'otag:typal',
    localSignal: mentionsOwnSubtype,
  },
  {
    id: 'reanimator',
    label: 'Reanimator',
    edhrecSlug: 'reanimator',
    blurb: 'Cheat big things out of the graveyard.',
    themeSignals: ['reanimator'],
    archetypeSignals: [Archetype.REANIMATOR],
    oracle: String.raw`from (your|a|any) graveyard (on)?to the battlefield|return target creature card from (your|a) graveyard|put [^.]*graveyard onto the battlefield`,
  },
  {
    id: 'graveyard',
    label: 'Graveyard',
    edhrecSlug: 'graveyard',
    blurb: 'Use the graveyard as a second hand.',
    themeSignals: ['graveyard'],
    archetypeSignals: [],
    oracle: String.raw`cards? in your graveyard|from your graveyard|flashback|\bescape\b|delve|dredge|leaves your graveyard`,
  },
  {
    id: 'landfall',
    label: 'Landfall',
    edhrecSlug: 'landfall',
    blurb: 'Ramp extra lands for snowballing triggers.',
    themeSignals: ['landfall', 'lands'],
    archetypeSignals: [Archetype.LANDFALL],
    oracle: String.raw`landfall|whenever a land (you control )?enters|play (an|two) additional lands?|lands you control`,
  },
  {
    id: 'artifacts',
    label: 'Artifacts',
    edhrecSlug: 'artifacts',
    blurb: 'Go wide on artifacts and payoffs for casting them.',
    themeSignals: ['artifacts'],
    archetypeSignals: [Archetype.ARTIFACTS],
    oracle: String.raw`artifact spells?|artifacts you control|whenever (an|another|one or more) (nontoken )?artifacts?|artifact creature`,
  },
  {
    id: 'treasure',
    label: 'Treasure',
    edhrecSlug: 'treasure',
    blurb: 'Make Treasure and spend it on something big.',
    themeSignals: ['treasures'],
    archetypeSignals: [],
    oracle: String.raw`treasures?`,
  },
  {
    id: 'enchantress',
    label: 'Enchantress',
    edhrecSlug: 'enchantress',
    blurb: 'Draw and snowball off enchantments.',
    themeSignals: ['enchantress', 'enchantments'],
    archetypeSignals: [Archetype.ENCHANTRESS],
    oracle: String.raw`enchantment spells?|enchantments you control|whenever (an|another) enchantment|constellation`,
  },
  {
    id: 'lifegain',
    label: 'Lifegain',
    edhrecSlug: 'lifegain',
    blurb: 'Gain life and turn it into a win condition.',
    themeSignals: ['lifegain', 'life gain'],
    archetypeSignals: [],
    oracle: String.raw`whenever you gain life|you gain \d+ life|lifelink|gain life equal|your life total`,
  },
  {
    id: 'blink',
    label: 'Blink',
    edhrecSlug: 'blink',
    blurb: 'Flicker creatures to reuse what they do when they enter.',
    themeSignals: ['blink', 'flicker', 'etb'],
    archetypeSignals: [],
    oracle: String.raw`exile (another |up to (one|two|x) )?(other )?target [^.]*(return|returns) (it|that card|them|those cards) to the battlefield|flicker|triggers an additional time|leaves the battlefield, return`,
  },
  {
    id: 'control',
    label: 'Control',
    edhrecSlug: 'control',
    blurb: 'Counter, remove, and grind the game out.',
    themeSignals: ['monarch', 'politics'],
    archetypeSignals: [Archetype.CONTROL],
    oracle: String.raw`counter target|can't cast|can't attack you|tap target|destroy all|exile all`,
  },
  {
    id: 'combo',
    label: 'Combo',
    edhrecSlug: 'combo',
    blurb: 'Assemble a two- or three-card win.',
    themeSignals: ['combo', 'extra turns', 'tutors'],
    archetypeSignals: [Archetype.COMBO],
    oracle: String.raw`untap (target|another|all|each|up to)|take an extra turn|search your library for (a|an|any) card`,
  },
  {
    id: 'mill',
    label: 'Mill',
    edhrecSlug: 'mill',
    blurb: "Win by emptying an opponent's library.",
    themeSignals: ['mill'],
    archetypeSignals: [],
    oracle: String.raw`\bmills?\b|cards from the top of (their|target player's|each opponent's) library into`,
  },
  {
    id: 'wheels',
    label: 'Wheels',
    edhrecSlug: 'wheels',
    blurb: 'Make everyone discard and draw new hands, then punish the draws.',
    themeSignals: ['wheels'],
    archetypeSignals: [],
    oracle: String.raw`discards? (their|your) hand|each player draws|draws? seven|whenever an opponent draws|each player discards`,
  },
  {
    id: 'superfriends',
    label: 'Superfriends',
    edhrecSlug: 'planeswalkers',
    blurb: 'Stick planeswalkers and protect them.',
    // No detector emits either theme, so this rides on the oracle pattern.
    // Deliberately narrow: a bare "planeswalker" also matches the removal
    // boilerplate ("destroy target creature or planeswalker") half of modern
    // Magic carries, which would file most commanders here.
    themeSignals: ['superfriends', 'planeswalkers'],
    archetypeSignals: [],
    oracle: String.raw`planeswalkers? you control|you control a planeswalker|planeswalker spells?|loyalty (counters?|abilities)`,
  },
  {
    id: 'grouphug',
    label: 'Group hug',
    edhrecSlug: 'group-hug',
    blurb: 'Give everyone resources and steer the table.',
    themeSignals: ['group hug'],
    archetypeSignals: [],
    oracle: String.raw`each player (draws|may|creates|puts|gains)|each opponent (draws|may)|target opponent draws`,
  },
];

/** Compiled once: the JS side of each shared `oracle` pattern. */
const ORACLE_RE = new Map(
  PLAYSTYLES.filter((p) => p.oracle).map((p) => [p.id, new RegExp(p.oracle!, 'i')])
);

/**
 * The Scryfall clause for a playstyle: its shared rules-text regex, or the
 * dedicated clause when it has one. Null for a playstyle with neither.
 */
export function playstyleScryfallClause(p: Playstyle): string | null {
  if (p.scryfallClause) return p.scryfallClause;
  if (p.oracle) return `o:/${p.oracle}/`;
  return null;
}

const PLAYSTYLE_BY_ID = new Map(PLAYSTYLES.map((p) => [p.id, p]));
const PLAYSTYLE_ORDER = new Map(PLAYSTYLES.map((p, i) => [p.id, i]));

export interface PlaystyleMatch {
  playstyle: Playstyle;
  /** Higher = stronger fit. Theme overlap counts 1 each; a primary-archetype
   *  match counts 2, an incidental ability-hint match counts 1. */
  score: number;
}

export function playstyleById(id: string): Playstyle | undefined {
  return PLAYSTYLE_BY_ID.get(id);
}

/**
 * Classify a commander into the playstyles it fits, strongest first. Pure: runs
 * the oracle-text reader and scores each playstyle by theme + archetype overlap.
 * Returns only playstyles with a non-zero signal (empty for a commander whose
 * text matches nothing — e.g. a vanilla beater with no keywords).
 */
export function classifyCommanderPlaystyles(card: ScryfallCard): PlaystyleMatch[] {
  const profile = buildCommanderProfile(card);
  const oracleText = getCombinedOracleText(card).toLowerCase();
  const themes = new Set(profile.suggestedThemes);
  // All archetype signals the profile carries: the chosen primary, plus every
  // ability's hint (so a tokens commander that also has a sac outlet still
  // registers an aristocrats signal even when tokens won the primary vote).
  const abilityArchetypes = new Set<Archetype>();
  for (const ability of profile.abilities) {
    if (ability.archetypeHint) abilityArchetypes.add(ability.archetypeHint);
  }

  const matches: PlaystyleMatch[] = [];
  for (const playstyle of PLAYSTYLES) {
    let score = 0;
    for (const theme of playstyle.themeSignals) {
      if (themes.has(theme)) score += 1;
    }
    for (const arch of playstyle.archetypeSignals) {
      if (profile.primaryArchetype === arch) score += 2;
      else if (abilityArchetypes.has(arch)) score += 1;
    }
    if (ORACLE_RE.get(playstyle.id)?.test(oracleText)) score += 1;
    if (playstyle.localSignal?.({ name: card.name, typeLine: card.type_line ?? '', oracleText })) {
      score += 1;
    }
    if (score > 0) matches.push({ playstyle, score });
  }

  matches.sort(
    (a, b) =>
      b.score - a.score ||
      (PLAYSTYLE_ORDER.get(a.playstyle.id) ?? 0) - (PLAYSTYLE_ORDER.get(b.playstyle.id) ?? 0)
  );
  return matches;
}

/**
 * Recover a card's keyword abilities from its oracle text.
 *
 * Scryfall prints keyword abilities on their own line as a comma-separated
 * list ("Flying, first strike", "Ward {2}", "Protection from red"), while every
 * real ability line is a sentence ending in a period. That trailing period is
 * the discriminator: it keeps "target creature gains flying until end of turn."
 * from reading as a flying keyword. Reminder text in parens is stripped first,
 * since it ends in a period inside the parens.
 *
 * Only {@link VOLTRON_KEYWORDS} are recovered — they're the only keywords
 * {@link buildCommanderProfile} reads off the `keywords` array.
 */
function keywordsFromOracleText(oracleText: string): string[] {
  const segments = oracleText
    .split('\n')
    .map((line) =>
      line
        .replace(/\([^)]*\)/g, '')
        .trim()
        .toLowerCase()
    )
    .filter((line) => line.length > 0 && !line.endsWith('.'))
    .flatMap((line) => line.split(/\s*,\s*/));
  return [...VOLTRON_KEYWORDS].filter((kw) =>
    // Exact for bare keywords ("trample"), prefix for parameterized ones
    // ("ward {2}", "protection from red").
    segments.some((seg) => seg === kw || seg.startsWith(`${kw} `))
  );
}

/**
 * Convenience for an owned collection card: adapt its `oracleText`/`typeLine`
 * to the shape the classifier reads.
 *
 * EnrichedCard carries no Scryfall `keywords` array, so the Voltron playstyle —
 * which is detected structurally from keywords/power, never from an oracle
 * phrase — used to be unreachable for every owned commander, leaving that
 * bucket permanently empty. {@link keywordsFromOracleText} recovers the keyword
 * half. The `power >= 4` half stays lost (EnrichedCard has no `power`), so a
 * keyword-less big-butt commander still won't file under Voltron from the
 * collection — that's the weakest branch of the signal (archWeight 1) and would
 * need a schema change to fix.
 */
export function classifyOwnedCommanderPlaystyles(card: EnrichedCard): PlaystyleMatch[] {
  return classifyCommanderPlaystyles({
    name: card.name,
    oracle_text: card.oracleText,
    type_line: card.typeLine,
    color_identity: card.colorIdentity,
    keywords: keywordsFromOracleText(card.oracleText ?? ''),
  } as ScryfallCard);
}

/** Does a commander fit a given playstyle id? */
export function commanderMatchesPlaystyle(card: ScryfallCard, playstyleId: string): boolean {
  return classifyCommanderPlaystyles(card).some((m) => m.playstyle.id === playstyleId);
}
