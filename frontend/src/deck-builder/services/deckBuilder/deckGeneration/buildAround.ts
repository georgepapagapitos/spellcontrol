// "Build around these cards" (E1116). The player names a few cards; each is
// seated as a must-include, leads the lift seed order, and brings the cards
// that play best with it into the pick pool. Today a card found only through
// lift is a suggestion (phaseLiftPicks); for a named seed it is a candidate.
//
// Everything here is inert with no build-around cards: an empty list returns
// empty results and the generator takes no new path.
import type {
  BuildAroundRow,
  Customization,
  EDHRECCard,
  LiftEntry,
  ScryfallCard,
} from '@/deck-builder/types';
import { frontFaceName } from '@/lib/cards/card-text';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import { aggregateLiftCandidates, buildLiftIndex } from '../liftSynergy';
import type { GenerationState } from './state';
import { STAPLE_INCLUSION_BAR } from '../roleCapAllowance';

/** Each seed costs one throttled EDHREC card-page fetch. */
export const MAX_BUILD_AROUND = 12;
/** Off-page candidates the seeds may add to the pick pool. */
export const MAX_SEED_ADMITS = 40;
/**
 * An admitted card's stand-in inclusion is the share of its seed's decks that
 * play it, held just under the staple bar: a card this commander's page never
 * lists must not enter the staple tier ahead of the page's own staples (the
 * #3044 lesson: a lift lane never outranks a high-inclusion on-theme card).
 */
export const SEED_ADMIT_MAX_INCLUSION = STAPLE_INCLUSION_BAR - 1;

/**
 * How much of a seed's co-play share an admitted card stands at. The share is
 * measured in the seed's own decks, where the seed is the plan; in this
 * commander's deck the seed is one package among others. At full value every
 * admitted card outranked the page's 30 to 39% cards, and the first seeded
 * panel traded Demonic Tutor, Vampiric Tutor and Fierce Guardianship for mill
 * spells in Yuriko while weaker cards stayed. At half, the same panel kept all
 * three and still seated five mill cards (35 package cards over 8 decks, from 41).
 */
export const SEED_ADMIT_DISCOUNT = 0.5;

/**
 * Candidates fetched per admitted slot. A seed's co-play list spans every
 * commander that plays it, so for a one-color deck most of the strongest
 * entries are off-identity: cutting to MAX_SEED_ADMITS before the identity
 * filter left Krenko's treasure seeds with nothing to bring in. The cut now
 * happens in seatSeedAdmits, after the filter.
 */
export const ADMIT_OVERFETCH = 3;

// Worded without the finder's `build-around` class name: the stylesheet
// ownership guard reads any string holding a class token as a use of it.
export const LABEL = 'Plays with the cards you built around';

/** The player's build-around cards: trimmed, deduped, capped. */
export function buildAroundNames(cards: readonly string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of cards ?? []) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_BUILD_AROUND) break;
  }
  return out;
}

/**
 * The customization the generator runs on: build-around cards are must-includes
 * too. One list for every rule that already knows a must-include (the owned-only
 * skip, "Skip my cards", the search's locks, the invariants), so none of them
 * has to learn a second one. Returns the same object when no card is named.
 */
export function asMustIncludes(customization: Customization): Customization {
  const names = buildAroundNames(customization.buildAroundCards);
  if (names.length === 0) return customization;
  const have = new Set(names.map((n) => n.toLowerCase()));
  const rest = (customization.mustIncludeCards ?? []).filter((n) => !have.has(n.toLowerCase()));
  return { ...customization, mustIncludeCards: [...names, ...rest] };
}

/** Names as a deck or a pool may spell them: whole, and front face only. */
const spellings = (name: string): string[] => [
  name.toLowerCase(),
  frontFaceName(name).toLowerCase(),
];

/** The fetched lift pools that belong to the player's seeds. */
export function seedPoolsOf(
  liftSeedPools: ReadonlyMap<string, LiftEntry[]>,
  seeds: readonly string[]
): Map<string, LiftEntry[]> {
  const wanted = new Set(seeds.map((s) => s.toLowerCase()));
  return new Map([...liftSeedPools].filter(([seed]) => wanted.has(seed.toLowerCase())));
}

export interface SeedAdmit {
  name: string;
  /** Stand-in inclusion for the pick score (see SEED_ADMIT_MAX_INCLUSION). */
  inclusion: number;
  /** The seeds that play with it, strongest first. */
  seeds: string[];
}

/**
 * Off-page cards the seeds bring into the pool: connected to a seed with a
 * real sample, strongest cluster first. `excludeNames` is everything already
 * a candidate or ruled out (the pool, used cards, bans).
 */
export function selectSeedAdmits(
  seedPools: ReadonlyMap<string, LiftEntry[]>,
  typePools: Readonly<Record<string, readonly EDHRECCard[]>>,
  alsoExclude: ReadonlyArray<Iterable<string>> = []
): SeedAdmit[] {
  if (seedPools.size === 0) return [];
  const excludeNames = new Set<string>(alsoExclude.flatMap((names) => [...names]));
  for (const pool of Object.values(typePools)) for (const c of pool) excludeNames.add(c.name);
  return aggregateLiftCandidates(seedPools, { excludeNames })
    .filter((c) => !c.lowSample)
    .sort((a, b) => b.clusterScore - a.clusterScore || a.name.localeCompare(b.name))
    .slice(0, MAX_SEED_ADMITS * ADMIT_OVERFETCH)
    .map((c) => ({
      name: c.name,
      inclusion: Math.min(
        SEED_ADMIT_MAX_INCLUSION,
        Math.round(
          SEED_ADMIT_DISCOUNT *
            Math.max(...c.edges.filter((e) => e.numDecks >= 50).map((e) => e.coPlayPct), 0)
        )
      ),
      seeds: [...c.edges].sort((a, b) => b.coPlayPct - a.coPlayPct).map((e) => e.seed),
    }));
}

/** The player's seeds for one run: their lift pools, a score over those pools
 *  alone, and the cards admitted from off the page with their stand-in inclusion
 *  (state.seedAdmitInclusion, filled by seatSeedAdmits). */
export interface SeedLift {
  pools: Map<string, LiftEntry[]>;
  scoreOf: (name: string) => number;
  admitted: Map<string, number>;
}

export function seedLift(
  state: Pick<GenerationState, 'liftSeedPools' | 'cfg' | 'seedAdmitInclusion' | 'categories'>
): SeedLift {
  // Only a seed that was seated steers the deck: one that was skipped (banned,
  // off-color, not owned in an owned-only build) must not fill the deck with
  // cards that play with a card it does not hold.
  const held = new Set(
    Object.values(state.categories ?? {})
      .flat()
      .flatMap((c) => spellings(c.name))
  );
  const seated = (state.cfg.buildAround ?? []).filter((n) => spellings(n).some((s) => held.has(s)));
  const pools = seedPoolsOf(state.liftSeedPools, seated);
  const index = buildLiftIndex(pools);
  return {
    pools,
    scoreOf: (name) => index.get(name.toLowerCase())?.clusterScore ?? 0,
    admitted: state.seedAdmitInclusion ?? new Map<string, number>(),
  };
}

/**
 * Seats each admitted card in the type pool its front face belongs to (the
 * first that matches, creature first) and records why it is a candidate.
 * `allowed` is the caller's hard filter (identity, legality, salt, ownership).
 * Lands are skipped: the land phase owns them.
 */
export function seatSeedAdmits(
  admits: readonly SeedAdmit[],
  cardMap: ReadonlyMap<string, ScryfallCard>,
  typePools: Record<string, EDHRECCard[]>,
  seeds: SeedLift,
  provenance: Map<string, string>,
  allowed: (card: ScryfallCard) => boolean
): void {
  let seated = 0;
  for (const admit of admits) {
    if (seated >= MAX_SEED_ADMITS) break;
    const card = cardMap.get(admit.name);
    if (!card || !allowed(card)) continue;
    const typeLine = getFrontFaceTypeLine(card).toLowerCase();
    if (typeLine.includes('land')) continue;
    const type = Object.keys(typePools).find((t) => typeLine.includes(t));
    if (!type) continue;
    typePools[type].push(seedAdmitPoolCard(admit, type.charAt(0).toUpperCase() + type.slice(1)));
    seated++;
    const why = `Plays with ${admit.seeds.slice(0, 2).join(' and ')}`;
    for (const name of new Set([admit.name, card.name])) {
      seeds.admitted.set(name, admit.inclusion);
      provenance.set(name, why);
    }
  }
}

/** The pool row for an admitted card. Never a theme-synergy card, and never
 *  in `allNonLand`, so it cannot move the role targets (E1061 step 3). */
export function seedAdmitPoolCard(admit: SeedAdmit, primaryType: string): EDHRECCard {
  return {
    name: admit.name,
    sanitized: admit.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    primary_type: primaryType,
    inclusion: admit.inclusion,
    num_decks: 0,
    synergy: 0,
    isThemeSynergyCard: false,
    isGameChanger: false,
  };
}

/**
 * The build report's "Built around" rows: per seed, the final-deck cards it
 * brought in. `credited` is the cards that are in the deck because of a seed
 * (admitted from off the page, or lifted by the build-around boost); a staple
 * that merely appears in a seed's pool is not credited to it.
 */
export function summarizeBuildAround(params: {
  seeds: readonly string[];
  seedPools: ReadonlyMap<string, LiftEntry[]>;
  credited: ReadonlySet<string>;
  deckNames: readonly string[];
  /** The build had no EDHREC data at all (a Scryfall stand-in pool). */
  noEdhrec?: boolean;
}): BuildAroundRow[] {
  const { seeds, seedPools, credited, deckNames, noEdhrec } = params;
  const pools = new Map([...seedPools].map(([seed, pool]) => [seed.toLowerCase(), pool]));
  const inDeck = new Set(deckNames.flatMap(spellings));
  const holds = (name: string) => spellings(name).some((s) => inDeck.has(s));
  return seeds.map((seed) => {
    if (!holds(seed)) return { seed, broughtIn: [], notSeated: true };
    const pool = pools.get(seed.toLowerCase());
    if (!pool || pool.length === 0) {
      return { seed, broughtIn: [], ...(noEdhrec ? { noEdhrec: true } : { noData: true }) };
    }
    const broughtIn = pool
      .filter((e) => credited.has(e.name) && holds(e.name))
      .sort((x, y) => y.coPlayPct - x.coPlayPct || x.name.localeCompare(y.name))
      .map((e) => e.name);
    return { seed, broughtIn: [...new Set(broughtIn)] };
  });
}

/**
 * The build report rows for this run, or undefined when no card was named. A
 * seed is credited with the off-page cards it brought in and nothing else: an
 * on-page card the seed boost helped is one the page already offered, and
 * crediting every boosted name listed Sol Ring under each seed (the first
 * seeded panel).
 */
export function report(
  seedNames: readonly string[],
  seeds: SeedLift,
  deck: ReadonlyArray<{ name: string }>,
  noEdhrec = false
): BuildAroundRow[] | undefined {
  if (seedNames.length === 0) return undefined;
  return summarizeBuildAround({
    noEdhrec,
    seeds: seedNames,
    seedPools: seeds.pools,
    credited: new Set(seeds.admitted.keys()),
    deckNames: deck.map((c) => c.name),
  });
}
