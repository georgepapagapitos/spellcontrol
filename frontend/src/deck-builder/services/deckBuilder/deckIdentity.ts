import { Archetype } from '@/deck-builder/types';
import type { ScryfallCard, ThemeResult } from '@/deck-builder/types';
import type { CommanderProfile } from './commanderProfile';
import type { CurveSlot } from './deckAnalyzer';
import { inferArchetype } from './roleTargets';
import { detectPacing, type Pacing } from './pacingDetector';
import { ARCHETYPE_LABEL } from './strategyVocabulary';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';

/**
 * The live-computed "identity" of a deck — its macro archetype, its pacing
 * (derived from the actual mana curve), and the themes it leans into. Unlike
 * the commander profile (a frozen pre-build read of the commander alone), this
 * is recomputed from the deck's *current* contents, so it stays honest as the
 * user edits the list. It works for any deck with a commander — generated,
 * imported, or hand-built — not just freshly generated ones.
 *
 * Wording is sourced from the canonical strategy vocabulary
 * ({@link ARCHETYPE_LABEL}) so it reads consistently with the rest of the deck
 * builder.
 */
export interface DeckIdentity {
  /** Title-Case archetype name for display, e.g. "Aristocrats". */
  archetypeLabel: string;
  /** Short badge form of the pacing, e.g. "Late game". */
  pacingShort: string;
  /** Theme names to show as chips (selected themes, else commander suggestions). */
  themes: string[];
}

const MAX_THEME_CHIPS = 5;

/**
 * Build the minimal {@link CurveSlot} array `detectPacing` needs — one bucket
 * per integer mana value across non-land cards. `detectPacing` only reads
 * `cmc`/`current`, so `target`/`delta` are inert here.
 */
function buildCurve(nonLandCards: ScryfallCard[]): CurveSlot[] {
  const counts = new Map<number, number>();
  for (const c of nonLandCards) {
    const cmc = Math.max(0, Math.round(c.cmc ?? 0));
    counts.set(cmc, (counts.get(cmc) ?? 0) + 1);
  }
  return [...counts.entries()].map(([cmc, current]) => ({ cmc, current, target: 0, delta: 0 }));
}

function isLand(card: ScryfallCard): boolean {
  return getFrontFaceTypeLine(card).toLowerCase().includes('land');
}

/** Short Title-Case badge form of a pacing, e.g. 'late-game' → 'Late game'. */
function shortPacing(p: Pacing): string {
  const words = p.split('-');
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

function uniqueLower(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const key = n.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(n.trim());
  }
  return out;
}

/**
 * Prefer the archetype implied by the user's explicitly selected themes (their
 * stated intent for a generated deck); fall back to the commander's detected
 * archetype when there are no selected themes or they don't imply one.
 */
function pickArchetype(profile: CommanderProfile, selectedThemes: ThemeResult[]): Archetype {
  if (selectedThemes.length > 0) {
    const fromThemes = inferArchetype(selectedThemes);
    if (fromThemes !== Archetype.GOODSTUFF) return fromThemes;
  }
  return profile.primaryArchetype;
}

export function deriveDeckIdentity(input: {
  profile: CommanderProfile;
  /** The deck's selected themes (generated decks); empty for manual/imported. */
  selectedThemes?: ThemeResult[];
  /** Full mainboard (commanders optional); lands are filtered out internally. */
  cards: ScryfallCard[];
}): DeckIdentity {
  const selectedThemes = (input.selectedThemes ?? []).filter((t) => t.isSelected);
  const nonLand = input.cards.filter((c) => !isLand(c));

  const archetypeLabel = ARCHETYPE_LABEL[pickArchetype(input.profile, selectedThemes)];

  const { pacing } = detectPacing(nonLand, buildCurve(nonLand));
  const pacingShort = shortPacing(pacing);

  const selectedNames = uniqueLower(selectedThemes.map((t) => t.name));
  const themes = (
    selectedNames.length > 0 ? selectedNames : uniqueLower(input.profile.suggestedThemes)
  ).slice(0, MAX_THEME_CHIPS);

  return { archetypeLabel, pacingShort, themes };
}
