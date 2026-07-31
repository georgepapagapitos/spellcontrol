import type { Customization, EDHRECCard, EDHRECCommanderData } from '@/deck-builder/types';
import { liftDeckFloor } from '../edhrec/client';

/**
 * E221 — archetype tag-page blending.
 *
 * A niche commander × niche theme page carries very few decks, so its cardlist
 * is thin and the generator ends up filling the gaps with generic staples. The
 * theme's own EDHREC tag page (e.g. `/tags/aristocrats/golgari`) describes the
 * same archetype across *every* commander that plays it, so it can backfill
 * what the commander page doesn't know — weighted by how little local data we
 * actually have.
 *
 * Pure. The caller (dataAcquisition's pool phase) fetches the tag page and
 * applies the result to the candidate pool BEFORE the type passes run, so
 * budget, bracket, role caps, colour identity, legality, salt, ban lists and
 * price sanity all apply to injected cards unchanged, by construction.
 */

/** Weight at or below {@link BLEND_N_MIN} decks — almost no local data. */
export const BLEND_WEIGHT_MAX = 0.9;
/** Weight at or above {@link BLEND_N_MAX} decks — the tag page is a light nudge. */
export const BLEND_WEIGHT_MIN = 0.35;
export const BLEND_N_MIN = 50;
export const BLEND_N_MAX = 500;
/** Ceiling on injections per category, so a tag page can never flood a type. */
export const MAX_INJECTED_PER_CATEGORY = 15;

/** Marks a pool entry that came from the tag page rather than the commander page. */
export const ARCHETYPE_BLEND_SOURCE = 'archetype-blend';

/**
 * Unlike `resolvePriceSanity`, this has NO smart default: it's a composition
 * change that hasn't cleared a panel, so `undefined` means plainly OFF and the
 * default path stays byte-inert. Flipping the default is a separate change
 * with its own gate (spec §4.5).
 */
export function resolveArchetypeBlend(
  customization: Pick<Customization, 'archetypeBlend'>
): boolean {
  return customization.archetypeBlend ?? false;
}

/**
 * Log-interpolated injection weight from the commander page's own deck count.
 * Flat outside [50, 500]: below 50 there's nothing local to trust, above 500
 * the commander page is authoritative and the tag page only nudges.
 */
export function blendWeight(numDecks: number): number {
  const clamped = Math.min(BLEND_N_MAX, Math.max(BLEND_N_MIN, numDecks));
  const t =
    (Math.log(clamped) - Math.log(BLEND_N_MIN)) / (Math.log(BLEND_N_MAX) - Math.log(BLEND_N_MIN));
  return BLEND_WEIGHT_MAX + (BLEND_WEIGHT_MIN - BLEND_WEIGHT_MAX) * t;
}

/** The per-type buckets we inject into. `allNonLand` is the union, maintained
 *  alongside them exactly as parseCardlists does — never injected into directly. */
const CATEGORIES = [
  'creatures',
  'instants',
  'sorceries',
  'artifacts',
  'enchantments',
  'planeswalkers',
  'lands',
] as const;

export interface BlendInput {
  /** The commander pool being augmented (mutated copy returned, never in place). */
  pool: EDHRECCommanderData['cardlists'];
  /** Cardlists off the theme's tag page — same shape, from fetchTagPageData. */
  tagPageCardlists: EDHRECCommanderData['cardlists'];
  /** The tag page's own deck count — sets the per-card trust floor. */
  tagPagePotentialDecks: number;
  /** The COMMANDER page's deck count — sets the weight. */
  commanderNumDecks: number;
}

export interface BlendResult {
  cardlists: EDHRECCommanderData['cardlists'];
  /** Names injected, in injection order. Empty when the blend was a no-op. */
  injectedNames: string[];
  /** The weight actually applied, for the disclosure note. */
  weight: number;
}

/**
 * Inject tag-page cards the commander page doesn't have, per category, capped.
 *
 * Injected entries carry `inclusion = weight × tagPageInclusion`, so they enter
 * the same ranking every other candidate goes through — discounted by how much
 * local data we already had — rather than jumping the queue.
 */
export function blendTagPageIntoPool(input: BlendInput): BlendResult {
  const { pool, tagPageCardlists, tagPagePotentialDecks, commanderNumDecks } = input;
  const weight = blendWeight(commanderNumDecks);

  // Reuse the lift pipeline's adaptive floor (#965) rather than inventing a
  // second threshold: a tag-page card seen in too few of the page's own decks
  // is noise, and "too few" already scales with how big the page is.
  const floor = liftDeckFloor(tagPagePotentialDecks);

  const known = new Set<string>();
  for (const category of CATEGORIES) {
    for (const card of pool[category]) known.add(card.name.toLowerCase());
  }
  for (const card of pool.allNonLand) known.add(card.name.toLowerCase());

  const next: EDHRECCommanderData['cardlists'] = {
    creatures: [...pool.creatures],
    instants: [...pool.instants],
    sorceries: [...pool.sorceries],
    artifacts: [...pool.artifacts],
    enchantments: [...pool.enchantments],
    planeswalkers: [...pool.planeswalkers],
    lands: [...pool.lands],
    allNonLand: [...pool.allNonLand],
  };

  const injectedNames: string[] = [];

  for (const category of CATEGORIES) {
    const candidates = tagPageCardlists[category]
      .filter((c) => c.num_decks >= floor)
      .filter((c) => !known.has(c.name.toLowerCase()))
      .sort((a, b) => b.inclusion - a.inclusion)
      .slice(0, MAX_INJECTED_PER_CATEGORY);

    for (const candidate of candidates) {
      // Guard the cross-category case too: a tag page can list the same card
      // under more than one bucket, and a double-inject would double-count it.
      if (known.has(candidate.name.toLowerCase())) continue;
      known.add(candidate.name.toLowerCase());

      const injected: EDHRECCard = {
        ...candidate,
        inclusion: candidate.inclusion * weight,
        blendSource: ARCHETYPE_BLEND_SOURCE,
      };
      next[category].push(injected);
      if (category !== 'lands') next.allNonLand.push(injected);
      injectedNames.push(injected.name);
    }
  }

  // Keep every bucket in the inclusion-descending order the rest of the
  // pipeline assumes parseCardlists left them in.
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    next[key].sort((a, b) => b.inclusion - a.inclusion);
  }

  return { cardlists: next, injectedNames, weight };
}

/**
 * Build-report disclosure. Names the real data lineage and the sample size that
 * justified reaching for it — never a bare "N cards added".
 */
export function buildArchetypeBlendNote(
  themeName: string,
  injectedCount: number,
  commanderNumDecks: number
): string | undefined {
  if (injectedCount === 0) return undefined;
  return `Added ${injectedCount} card${injectedCount === 1 ? '' : 's'} from the ${themeName} archetype page — this commander has only ${commanderNumDecks.toLocaleString()} deck${commanderNumDecks === 1 ? '' : 's'} on record, so the theme page filled the gaps.`;
}
