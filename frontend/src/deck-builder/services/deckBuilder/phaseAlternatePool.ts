// Alternative-generator pool builder.
//
// The default generator sources its candidate pool from EDHREC's per-commander
// recommendation lists. The "alternative generators" instead synthesize the same
// `EDHRECCommanderData` shape from deterministic Scryfall searches, so the entire
// downstream pipeline (curve/role/type targeting, combo audit, trim, analytics,
// bracket estimation) runs unchanged — the only thing that differs is *where the
// candidate cards come from*:
//
//   • oracle-role — cards chosen by function (Scryfall oracle tags: otag:ramp,
//     otag:removal, …) plus a creatures backbone. Works for ANY commander, even
//     ones EDHREC has no data for. Optional permanents-only restriction.
//   • art-theme  — every card depicts one motif (arttag:dragon, arttag:cat, …),
//     ranked by playability. The deck reads like a curated gallery.
//   • historical — only cards printed on/before a chosen year (year<=2005).
//
// Pool queries always run against the LIVE Scryfall API (the generator sets the
// force-live flag): the offline query parser can't evaluate otag:/arttag:/year.
import { logger } from '@/lib/logger';
import { searchCards } from '@/deck-builder/services/scryfall/client';
import type {
  Customization,
  DeckDataSource,
  EDHRECCard,
  EDHRECCommanderData,
  EDHRECCommanderStats,
  GenerationMode,
  ScryfallCard,
} from '@/deck-builder/types';

export interface AlternatePoolResult {
  /** Synthetic EDHREC-shaped data the downstream pipeline consumes. */
  data: EDHRECCommanderData;
  /** dataSource tag for the build report. */
  dataSource: DeckDataSource;
  /** Distinct nonland cards gathered (a thin pool → more basic-land padding). */
  poolSize: number;
  /** Human descriptor for the report (art motif, or "year<=YYYY"). */
  detail?: string;
  /** Set when historical relaxed its year ceiling to find a workable pool. */
  relaxedNote?: string;
  /**
   * The Scryfall constraint that actually defines this pool, AS BUILT — e.g. the
   * RELAXED `year<=2010` after historical eased its ceiling, not the requested
   * year. The generator appends this to `scryfallQuery` so the strict printing
   * upgrade and fallback fills enforce exactly the constraint the pool used (a
   * mismatch here would delete the relaxed-era cards we just fetched).
   */
  effectiveConstraint: string;
}

/** Curated art motifs for the Art Theme picker — populous, visually iconic tags.
 *  Counts are pre-color-identity (a real build filters by `id<=…` on top), so
 *  these all stay workable for most commanders. Free-text tags are allowed too. */
export const ART_THEME_PRESETS: ReadonlyArray<{ tag: string; label: string }> = [
  { tag: 'dragon', label: 'Dragons' },
  { tag: 'cat', label: 'Cats' },
  { tag: 'angel', label: 'Angels' },
  { tag: 'demon', label: 'Demons' },
  { tag: 'zombie', label: 'Zombies' },
  { tag: 'skeleton', label: 'Skeletons' },
  { tag: 'wolf', label: 'Wolves' },
  { tag: 'bird', label: 'Birds' },
  { tag: 'snake', label: 'Snakes' },
  { tag: 'goblin', label: 'Goblins' },
  { tag: 'elf', label: 'Elves' },
  { tag: 'vampire', label: 'Vampires' },
  { tag: 'dinosaur', label: 'Dinosaurs' },
  { tag: 'horror', label: 'Horrors' },
  { tag: 'fire', label: 'Fire' },
  { tag: 'forest', label: 'Forests' },
  { tag: 'sword', label: 'Swords' },
  { tag: 'moon', label: 'Moons' },
];

/** Earliest selectable print year (Alpha shipped in 1993). */
export const HISTORICAL_MIN_YEAR = 1995;
/** Curated era presets for the Historical picker. */
export const HISTORICAL_PRESETS: ReadonlyArray<{ year: number; label: string; blurb: string }> = [
  { year: 2000, label: 'Classic', blurb: 'Pre-2000 — the foundational era' },
  { year: 2005, label: 'Old-School', blurb: 'Through 2005 — Kamigawa & Ravnica' },
  { year: 2010, label: 'Golden Age', blurb: 'Through 2010 — the first Commander decks' },
  { year: 2015, label: 'Modern', blurb: 'Through 2015 — Khans & origins' },
];

// Oracle role facets — each pulls the globally best cards that perform a function,
// ranked by playability (order:edhrec). `take` is the per-facet pool cap; the sum
// across facets gives the engine ~4× the ~62 nonland slots to select from.
const ROLE_FACETS: ReadonlyArray<{ query: string; take: number; flexible?: boolean }> = [
  { query: 't:creature', take: 150 }, // the body of the deck
  { query: 'otag:ramp', take: 30, flexible: true },
  { query: 'otag:removal', take: 40, flexible: true },
  { query: 'otag:draw', take: 28, flexible: true },
  { query: 'otag:card-advantage', take: 24, flexible: true },
  { query: 'otag:board-wipe', take: 12, flexible: true },
  { query: 'otag:tutor', take: 12, flexible: true },
  { query: 'otag:counterspell', take: 14, flexible: true },
  { query: 'otag:protection', take: 14, flexible: true },
  { query: 'otag:win-condition', take: 12, flexible: true },
];

const SCRYFALL_PAGE_SIZE = 175; // Scryfall's max results per search page
/** Below this nonland-pool size the historical era is too thin → relax the year. */
const HISTORICAL_MIN_POOL = 70;

/**
 * Build the Scryfall constraint that defines a mode and is appended to *every*
 * downstream search (pool, role-shortfall fills, and the strict printing upgrade
 * at generation time) so the whole deck — not just the initial pool — stays on
 * theme. Returns '' for plain EDHREC mode.
 */
export function buildModeConstraint(customization: Customization): string {
  switch (customization.generationMode) {
    case 'art-theme':
      return customization.artThemeTag.trim() ? `art:${slugifyTag(customization.artThemeTag)}` : '';
    case 'historical':
      return `year<=${customization.historicalYear}`;
    case 'oracle-role':
      return customization.permanentsOnly ? 'is:permanent -t:land' : '';
    default:
      return '';
  }
}

/** Normalize a user-typed art tag to Scryfall's slug form ("Sea Serpent" → "sea-serpent"). */
export function slugifyTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function buildAlternatePool(
  mode: GenerationMode,
  customization: Customization,
  colorIdentity: string[],
  onProgress?: (message: string, percent: number) => void
): Promise<AlternatePoolResult> {
  switch (mode) {
    case 'art-theme':
      return buildArtThemePool(customization, colorIdentity, onProgress);
    case 'historical':
      return buildHistoricalPool(customization, colorIdentity, onProgress);
    case 'oracle-role':
    default:
      return buildOraclePool(customization, colorIdentity, onProgress, undefined);
  }
}

// ── Oracle Role ──────────────────────────────────────────────────────────────

async function buildOraclePool(
  customization: Customization,
  colorIdentity: string[],
  onProgress: ((message: string, percent: number) => void) | undefined,
  extraConstraint: string | undefined
): Promise<AlternatePoolResult> {
  const constraint = [
    customization.permanentsOnly ? 'is:permanent -t:land' : '',
    extraConstraint ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  onProgress?.('Sorting cards by what they do…', 8);
  const collected = new Map<string, { card: ScryfallCard; flexHits: number }>();

  let done = 0;
  for (const facet of ROLE_FACETS) {
    const query = constraint ? `${facet.query} ${constraint}` : facet.query;
    const cards = await fetchPool(query, colorIdentity, facet.take);
    for (const card of cards) {
      const existing = collected.get(card.name);
      if (existing) {
        if (facet.flexible) existing.flexHits++;
      } else {
        collected.set(card.name, { card, flexHits: facet.flexible ? 1 : 0 });
      }
    }
    done++;
    onProgress?.('Sorting cards by what they do…', 8 + Math.round((done / ROLE_FACETS.length) * 6));
  }

  const data = synthesize(
    [...collected.values()].map((e) => ({ card: e.card, flexHits: e.flexHits }))
  );
  return {
    data,
    dataSource: 'oracle-role',
    poolSize: data.cardlists.allNonLand.length,
    detail: customization.permanentsOnly ? 'permanents only' : undefined,
    effectiveConstraint: constraint,
  };
}

// ── Art Theme ────────────────────────────────────────────────────────────────

async function buildArtThemePool(
  customization: Customization,
  colorIdentity: string[],
  onProgress?: (message: string, percent: number) => void
): Promise<AlternatePoolResult> {
  const tag = slugifyTag(customization.artThemeTag);
  if (!tag) {
    // No motif chosen — empty pool signals the caller to surface an error.
    return { data: emptyData(), dataSource: 'art-theme', poolSize: 0, effectiveConstraint: '' };
  }

  onProgress?.(`Gathering ${customization.artThemeTag} art…`, 8);
  // The art constraint IS the pool: take the most playable cards depicting the
  // motif across all types, then let the engine pick by type/curve from them.
  const cards = await fetchPool(`art:${tag} -t:land`, colorIdentity, 320);
  const data = synthesize(cards.map((card) => ({ card, flexHits: 0 })));
  onProgress?.(`Gathering ${customization.artThemeTag} art…`, 14);

  return {
    data,
    dataSource: 'art-theme',
    poolSize: data.cardlists.allNonLand.length,
    detail: tag,
    effectiveConstraint: `art:${tag}`,
  };
}

// ── Historical ───────────────────────────────────────────────────────────────

async function buildHistoricalPool(
  customization: Customization,
  colorIdentity: string[],
  onProgress?: (message: string, percent: number) => void
): Promise<AlternatePoolResult> {
  const requested = customization.historicalYear;
  // Progressive relaxation: niche colors + an old ceiling can starve the pool.
  // Step the ceiling forward until there's enough to build, then report it.
  for (const bump of [0, 5, 10]) {
    const year = requested + bump;
    onProgress?.(
      bump === 0 ? `Reaching back to ${requested}…` : `Few cards that old — easing to ${year}…`,
      8
    );
    // permanentsOnly is an oracle-role-only toggle; don't let a stale flag
    // silently strip instants/sorceries from a historical build.
    const result = await buildOraclePool(
      { ...customization, permanentsOnly: false },
      colorIdentity,
      onProgress,
      `year<=${year}`
    );
    if (result.poolSize >= HISTORICAL_MIN_POOL || bump === 10) {
      return {
        ...result,
        dataSource: 'historical',
        detail: `year<=${year}`,
        relaxedNote:
          bump > 0
            ? `Cards from ${requested} were too few, so we reached forward to ${year}.`
            : undefined,
      };
    }
  }
  // Unreachable (loop always returns on bump===10), but satisfies the type.
  return {
    data: emptyData(),
    dataSource: 'historical',
    poolSize: 0,
    effectiveConstraint: `year<=${requested}`,
  };
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/** Page through a Scryfall search until `take` playable cards are gathered. */
async function fetchPool(
  query: string,
  colorIdentity: string[],
  take: number
): Promise<ScryfallCard[]> {
  const out: ScryfallCard[] = [];
  const pages = Math.ceil(take / SCRYFALL_PAGE_SIZE);
  for (let page = 1; page <= pages; page++) {
    try {
      const res = await searchCards(query, colorIdentity, { order: 'edhrec', page });
      out.push(...res.data);
      if (!res.has_more || out.length >= take) break;
    } catch (err) {
      // A facet that matches nothing (e.g. counterspells off-color) 404s — fine,
      // just contributes nothing to the pool.
      logger.debug(`[AltPool] query "${query}" page ${page} returned nothing:`, err);
      break;
    }
  }
  return out.slice(0, take);
}

/** Turn gathered Scryfall cards into the EDHREC-shaped data the pipeline expects. */
function synthesize(entries: Array<{ card: ScryfallCard; flexHits: number }>): EDHRECCommanderData {
  // Rank by playability (edhrec_rank asc; unranked sink to the bottom) so the
  // synthetic `inclusion` mirrors how the EDHREC path orders its pools.
  const ranked = [...entries].sort(
    (a, b) => (a.card.edhrec_rank ?? Infinity) - (b.card.edhrec_rank ?? Infinity)
  );

  const cardlists = emptyCardlists();
  const n = ranked.length;
  ranked.forEach(({ card, flexHits }, i) => {
    const type = primaryType(card.type_line);
    if (type === 'Land' || type === 'Unknown') return; // lands come from the land generator
    const edhrecCard: EDHRECCard = {
      name: card.name,
      sanitized: card.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      primary_type: type,
      // Monotonic-decreasing synthetic inclusion (100 → 1) by quality rank.
      inclusion: Math.max(1, Math.round(100 - (i / Math.max(1, n - 1)) * 99)),
      num_decks: 1000,
      // Cards that fill multiple roles are flagged as flexible → a small priority nudge.
      synergy: flexHits >= 2 ? 0.35 : 0,
      isThemeSynergyCard: flexHits >= 2,
      cmc: card.cmc,
      color_identity: card.color_identity,
    };
    pushTyped(cardlists, type, edhrecCard);
    cardlists.allNonLand.push(edhrecCard);
  });

  return { themes: [], stats: emptyStats(), cardlists, similarCommanders: [] };
}

/** First/primary card type, matching how the EDHREC path buckets cards.
 *  Order matters: an "Artifact Creature" is a Creature; a planeswalker outranks
 *  its supertypes; lands are detected so they can be excluded from the pool. */
function primaryType(typeLine: string): string {
  const front = (typeLine.split('//')[0] ?? '').split('—')[0];
  for (const t of [
    'Creature',
    'Planeswalker',
    'Instant',
    'Sorcery',
    'Battle',
    'Artifact',
    'Enchantment',
    'Land',
  ]) {
    if (front.includes(t)) return t;
  }
  return 'Unknown';
}

function pushTyped(
  cardlists: EDHRECCommanderData['cardlists'],
  type: string,
  card: EDHRECCard
): void {
  switch (type) {
    case 'Creature':
      cardlists.creatures.push(card);
      break;
    case 'Instant':
      cardlists.instants.push(card);
      break;
    case 'Sorcery':
      cardlists.sorceries.push(card);
      break;
    case 'Artifact':
      cardlists.artifacts.push(card);
      break;
    case 'Enchantment':
      cardlists.enchantments.push(card);
      break;
    case 'Planeswalker':
      cardlists.planeswalkers.push(card);
      break;
  }
}

function emptyCardlists(): EDHRECCommanderData['cardlists'] {
  return {
    creatures: [],
    instants: [],
    sorceries: [],
    artifacts: [],
    enchantments: [],
    planeswalkers: [],
    lands: [],
    allNonLand: [],
  };
}

// numDecks:0 makes calculateTargetCounts use its balanced fallback curve/type
// targets — exactly what we want when there's no per-commander EDHREC stats.
function emptyStats(): EDHRECCommanderStats {
  return {
    avgPrice: 0,
    numDecks: 0,
    deckSize: 0,
    manaCurve: {},
    typeDistribution: {
      creature: 0,
      instant: 0,
      sorcery: 0,
      artifact: 0,
      enchantment: 0,
      land: 0,
      planeswalker: 0,
      battle: 0,
    },
    landDistribution: { basic: 0, nonbasic: 0, total: 0 },
  };
}

function emptyData(): EDHRECCommanderData {
  return { themes: [], stats: emptyStats(), cardlists: emptyCardlists(), similarCommanders: [] };
}
