import { Archetype } from '@/deck-builder/types';
import type { ScryfallCard } from '@/deck-builder/types';
import {
  buildCommanderProfile,
  getCombinedOracleText,
  VOLTRON_KEYWORDS,
} from '@/deck-builder/services/deckBuilder/commanderProfile';
import type { EnrichedCard } from '../types';

/**
 * Commander → playstyle index — pure, network-free classification.
 *
 * Discovery by "vibe" (aristocrats, tokens, voltron, …) has two sides:
 *
 *  - **Aspirational** — "show me commanders that play like this" — is best
 *    answered by EDHREC's crowd data (`fetchPlaystyleCommanders`), which knows
 *    what real decklists do, not just what the card text says.
 *  - **From my shelf** — "which of MY commanders fit this vibe" — needs to work
 *    instantly and offline over the user's own legends. EDHREC's top-N-per-tag
 *    list misses owned commanders that aren't widely played, so we classify
 *    locally from oracle text instead.
 *
 * This module owns the local side. It reuses {@link buildCommanderProfile} (the
 * same 28-detector oracle reader the generator uses) so the playstyle a card is
 * filed under can't drift from the themes the builder already detects, then maps
 * those themes/archetype onto the curated, EDHREC-verified {@link PLAYSTYLES}
 * vocabulary. No I/O, no React — fully unit-testable.
 */

export interface Playstyle {
  /** Stable id (also the React key). */
  id: string;
  /** Human label for chips/headings. */
  label: string;
  /** EDHREC tag slug — verified to resolve at /pages/tags/{slug}.json. */
  edhrecSlug: string;
  /** One-line description shown under the chip. */
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
   * Direct oracle-text fallback for playstyles no {@link buildCommanderProfile}
   * detector covers. Matched against the combined, lowercased oracle text and
   * worth 1 point — the same as a theme hit. Only set it when the profile
   * emits nothing for this playstyle; theme/archetype overlap is the primary
   * signal everywhere else.
   */
  oracleSignal?: RegExp;
}

/**
 * Curated, broadly-distinct playstyles. Each `edhrecSlug` is a real EDHREC tag
 * (the shared source of truth for both the by-EDHREC browse path and the local
 * owned classifier). Order is the display order.
 */
export const PLAYSTYLES: Playstyle[] = [
  {
    id: 'aristocrats',
    label: 'Aristocrats',
    edhrecSlug: 'aristocrats',
    blurb: 'Sacrifice creatures for value and drain the table.',
    themeSignals: ['aristocrats', 'sacrifice', 'lifedrain'],
    archetypeSignals: [Archetype.ARISTOCRATS],
  },
  {
    id: 'tokens',
    label: 'Tokens (go wide)',
    edhrecSlug: 'tokens',
    blurb: 'Flood the board with tokens, then pump and swing.',
    themeSignals: ['tokens', 'go wide'],
    archetypeSignals: [Archetype.TOKENS],
  },
  {
    id: 'voltron',
    label: 'Voltron',
    edhrecSlug: 'voltron',
    blurb: 'Suit up one threat with equipment/auras and connect.',
    themeSignals: ['voltron', 'equipment', 'auras'],
    archetypeSignals: [Archetype.VOLTRON],
  },
  {
    id: 'spellslinger',
    label: 'Spellslinger',
    edhrecSlug: 'spellslinger',
    blurb: 'Chain instants and sorceries for payoffs.',
    themeSignals: ['spellslinger', 'storm'],
    archetypeSignals: [Archetype.SPELLSLINGER],
  },
  {
    id: 'control',
    label: 'Control',
    edhrecSlug: 'control',
    blurb: 'Counter, remove, and grind the game out.',
    themeSignals: ['monarch', 'politics', 'group hug'],
    archetypeSignals: [Archetype.CONTROL],
  },
  {
    id: 'combo',
    label: 'Combo',
    edhrecSlug: 'combo',
    blurb: 'Assemble a two- or three-card win.',
    themeSignals: ['combo', 'extra turns', 'tutors'],
    archetypeSignals: [Archetype.COMBO],
  },
  {
    id: 'reanimator',
    label: 'Reanimator',
    edhrecSlug: 'reanimator',
    blurb: 'Cheat big things out of the graveyard.',
    themeSignals: ['reanimator', 'graveyard', 'mill'],
    archetypeSignals: [Archetype.REANIMATOR],
  },
  {
    id: 'landfall',
    label: 'Landfall',
    edhrecSlug: 'landfall',
    blurb: 'Ramp extra lands for snowballing triggers.',
    themeSignals: ['landfall', 'lands'],
    archetypeSignals: [Archetype.LANDFALL],
  },
  {
    id: 'artifacts',
    label: 'Artifacts',
    edhrecSlug: 'artifacts',
    blurb: 'Go wide on artifacts and treasures.',
    themeSignals: ['artifacts', 'treasures'],
    archetypeSignals: [Archetype.ARTIFACTS],
  },
  {
    id: 'enchantress',
    label: 'Enchantress',
    edhrecSlug: 'enchantress',
    blurb: 'Draw and snowball off enchantments.',
    themeSignals: ['enchantress', 'enchantments'],
    archetypeSignals: [Archetype.ENCHANTRESS],
  },
  {
    id: 'counters',
    label: '+1/+1 Counters',
    edhrecSlug: 'proliferate',
    blurb: 'Grow creatures with counters and proliferate.',
    themeSignals: ['+1/+1 counters', 'counters', 'proliferate'],
    archetypeSignals: [],
  },
  {
    id: 'lifegain',
    label: 'Lifegain',
    edhrecSlug: 'lifegain',
    blurb: 'Gain life and turn it into a win condition.',
    themeSignals: ['lifegain', 'life gain'],
    archetypeSignals: [],
  },
  {
    id: 'blink',
    label: 'Blink',
    edhrecSlug: 'blink',
    blurb: 'Flicker creatures to abuse enter-the-battlefield effects.',
    themeSignals: ['blink', 'flicker', 'etb'],
    archetypeSignals: [],
  },
  {
    id: 'superfriends',
    label: 'Superfriends',
    edhrecSlug: 'planeswalkers',
    blurb: 'Stick planeswalkers and protect them.',
    // No detector emits either theme — this playstyle rides entirely on the
    // oracle signal below. The themes stay listed so a future superfriends
    // detector wires itself up for free.
    themeSignals: ['superfriends', 'planeswalkers'],
    archetypeSignals: [],
    // Deliberately narrow: a bare /planeswalker/ also matches the removal
    // boilerplate ("destroy target creature or planeswalker") that half of
    // modern Magic carries, which would file most commanders here.
    oracleSignal:
      /\bplaneswalkers? you control\b|\byou control a planeswalker\b|\bplaneswalker spells?\b|\bloyalty counters?\b/,
  },
];

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
    if (playstyle.oracleSignal?.test(oracleText)) score += 1;
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
