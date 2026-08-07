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
 * Unlike `resolvePriceSanity`, this has NO smart default: `undefined` means
 * plainly OFF and the default path stays byte-inert.
 *
 * ── E228 DEFAULT-ON: GATED 2026-08-07 AND REJECTED. DO NOT RE-RUN. ──
 *
 * A/B on `LIVE_GEN_PANEL=popular` (the no-harm instrument built for exactly this
 * question, #1524): 32 cards changed across 6 of 8 decks, against a ship
 * condition of neutral-across-the-board. {@link BLEND_WEIGHT_MIN} 0.35 is too
 * high — movement damps with popularity but does not reach zero until ~2500+
 * decks, and at 1398 (Muldrotha) and 2710 (Sythis) decks, commanders with no
 * thin pool to backfill, the blend still rewrote 7-9 cards. Two watchlist
 * premiums were lost outright (Craterhoof on Lathril elves, Path to Exile on
 * Sythis).
 *
 * The blend stays CORRECT for thin pools (NICHE_RUNS, 7-159 decks) — this
 * rejects default-on, not the mechanism. Any re-attempt must first lower the
 * floor or gate the blend on a deck-count threshold, then re-run the popular
 * panel.
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

/**
 * Ceiling on the theme-synergy tier. Separate from the per-category cap because
 * this list is the point of the feature — it's what actually defines the
 * archetype — while the type buckets are ordered by raw inclusion and skew
 * toward generic goodstuff.
 */
export const MAX_INJECTED_SYNERGY = 15;

export interface BlendInput {
  /** The commander pool being augmented (mutated copy returned, never in place). */
  pool: EDHRECCommanderData['cardlists'];
  /** Cardlists off the theme's tag page — same shape, from fetchTagPageData. */
  tagPageCardlists: EDHRECCommanderData['cardlists'];
  /**
   * Names off the tag page's `highsynergycards` list — the archetype-defining
   * cards. Injected FIRST and marked `isThemeSynergyCard`, which is what earns
   * them priority in cardPicking's `isHighSynergyCard` split regardless of
   * their `Unknown` primary_type. Deliberately NOT `topcards`/`gamechangers`:
   * those are generic power in these colours, i.e. the goodstuff this feature
   * exists to be an alternative to.
   */
  highSynergyNames?: readonly string[];
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

  // ── Tier 1: the archetype-defining cards ──────────────────────────────────
  // These live only in the tag page's `allNonLand` union (parseCardlists gives
  // highsynergycards no type bucket), which is exactly why the type-bucket loop
  // below can't see them. Injected first so they claim their slots before the
  // generic buckets, and marked isThemeSynergyCard so cardPicking prioritizes
  // them despite carrying primary_type 'Unknown'.
  const highSynergy = new Set((input.highSynergyNames ?? []).map((n) => n.toLowerCase()));
  if (highSynergy.size > 0) {
    const candidates = tagPageCardlists.allNonLand
      .filter((c) => highSynergy.has(c.name.toLowerCase()))
      .filter((c) => c.num_decks >= floor)
      .filter((c) => !known.has(c.name.toLowerCase()))
      .sort((a, b) => b.inclusion - a.inclusion)
      .slice(0, MAX_INJECTED_SYNERGY);

    for (const candidate of candidates) {
      known.add(candidate.name.toLowerCase());
      next.allNonLand.push({
        ...candidate,
        inclusion: candidate.inclusion * weight,
        isThemeSynergyCard: true,
        blendSource: ARCHETYPE_BLEND_SOURCE,
      });
      injectedNames.push(candidate.name);
    }
  }

  // ── Tier 2: per-type backfill ─────────────────────────────────────────────
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
 * Narrow the pool-level injection list to the cards that actually SHIPPED in
 * the finished deck, and word the disclosure off that number.
 *
 * The distinction is load-bearing in both directions. The blend puts up to 15
 * cards per category into the candidate pool — ~90 for a thin commander — but
 * only a handful survive the type passes into the final 99. Reporting the pool
 * count reads as "we added 93 cards to your deck", which is simply false. And
 * the misfit exemption should cover exactly the cards on the list: one that
 * never made the deck can't be flagged as a misfit anyway.
 */
export function summarizeSeatedBlend(
  injectedNames: readonly string[],
  finalDeck: readonly { name: string }[],
  themeName: string | undefined,
  commanderNumDecks: number | undefined
): { names: string[] | undefined; note: string | undefined } {
  if (injectedNames.length === 0 || !themeName) return { names: undefined, note: undefined };

  const inDeck = new Set(finalDeck.map((c) => c.name.toLowerCase()));
  const names = injectedNames.filter((n) => inDeck.has(n.toLowerCase()));
  if (names.length === 0) return { names: undefined, note: undefined };

  const decks = commanderNumDecks ?? 0;
  const sample =
    decks > 0
      ? ` — this commander has only ${decks.toLocaleString()} deck${decks === 1 ? '' : 's'} on record, so the theme page filled the gaps.`
      : ` — the theme page filled gaps this commander's own page couldn't.`;
  return {
    names,
    note: `${names.length} card${names.length === 1 ? '' : 's'} in this deck came from the ${themeName} archetype page${sample}`,
  };
}
