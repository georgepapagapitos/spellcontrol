import { Archetype } from '@/deck-builder/types';
import type { ArchetypeProvenance, ScryfallCard, ThemeResult } from '@/deck-builder/types';
import type { DeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import type { CommanderProfile } from './commanderProfile';
import type { CurveSlot } from './deckAnalyzer';
import { inferArchetype } from './roleTargets';
import { detectPacing, type Pacing } from './pacingDetector';
import { ARCHETYPE_LABEL, THEME_TO_ARCHETYPE } from './strategyVocabulary';
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
  return inferArchetype(selectedThemes, profile.primaryArchetype);
}

/**
 * The archetype a decisive engine implies, or undefined when none clearly
 * leads. Decisive means the busiest axis is a real engine (invested: enough
 * cards, producers and payoffs both present) and at least twice the size of
 * the next one. An engine whose axis only maps to Goodstuff or Midrange says
 * nothing sharper than the fallback, so it doesn't count either.
 */
export function engineArchetype(synergy: DeckSynergy): Archetype | undefined {
  const [top, next] = synergy.axes;
  if (!top || !synergy.invested.includes(top.axis)) return undefined;
  // ponytail: a flat 2x lead; tune against real decks if a mixed build flips.
  if (next && next.total * 2 > top.total) return undefined;
  const archetype = THEME_TO_ARCHETYPE[top.axis];
  return archetype && archetype !== Archetype.GOODSTUFF && archetype !== Archetype.MIDRANGE
    ? archetype
    : undefined;
}

/**
 * The archetype a deck shows on Auto. Precedence: the owner's pick; a theme
 * the owner chose at generation; the deck's own decisive engine; the
 * generator's EDHREC read; and, for a deck with none of those, the commander
 * guess inside `deriveDeckIdentity`. The engine outranks the generator's read
 * because it counts the cards actually in the list: a Sram deck whose EDHREC
 * themes split three ways (Equipment, Voltron, Auras) was generated as
 * "balanced Goodstuff" while 30 of its cards built one equipment engine. The
 * generator's read stays in the build report as a record of the build.
 */
export function resolveAutoArchetype(input: {
  override?: Archetype | null;
  build?: { archetype?: Archetype; archetypeProvenance?: ArchetypeProvenance };
  engine: DeckSynergy;
}): Archetype | undefined {
  if (input.override) return input.override;
  const built = input.build?.archetype;
  if (built && input.build?.archetypeProvenance === 'user-theme') return built;
  return engineArchetype(input.engine) ?? built;
}

export function deriveDeckIdentity(input: {
  profile: CommanderProfile;
  /** The deck's selected themes (generated decks); empty for manual/imported. */
  selectedThemes?: ThemeResult[];
  /** Full mainboard (commanders optional); lands are filtered out internally. */
  cards: ScryfallCard[];
  /**
   * The archetype already settled for this deck (`resolveAutoArchetype`: the
   * owner's pick, a chosen theme, the deck's engine, or the generator's read).
   * Undefined when none applies, which keeps the commander-text fallback.
   */
  persistedArchetype?: Archetype;
}): DeckIdentity {
  const selectedThemes = (input.selectedThemes ?? []).filter((t) => t.isSelected);
  const nonLand = input.cards.filter((c) => !isLand(c));

  const archetype = input.persistedArchetype ?? pickArchetype(input.profile, selectedThemes);
  const archetypeLabel = ARCHETYPE_LABEL[archetype];

  const { pacing } = detectPacing(nonLand, buildCurve(nonLand));
  const pacingShort = shortPacing(pacing);

  const selectedNames = uniqueLower(selectedThemes.map((t) => t.name));
  const themes = (
    selectedNames.length > 0 ? selectedNames : uniqueLower(input.profile.suggestedThemes)
  ).slice(0, MAX_THEME_CHIPS);

  return { archetypeLabel, pacingShort, themes };
}
