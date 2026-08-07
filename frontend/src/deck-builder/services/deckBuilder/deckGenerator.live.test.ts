// LIVE-DATA eval harness for generateDeck().
//
// Unlike deckGenerator.golden.test.ts (mocked EDHREC/Scryfall/tagger fixtures,
// pinned output), this hits the REAL Scryfall + EDHREC APIs and dumps full
// generated decks (+ build report + coach explanations) to disk as JSON for
// offline expert critique. Gated behind LIVE_GEN=1 so a normal `npm test`
// never fires network calls:
//
//   cd frontend && NODE_ENV=production LIVE_GEN=1 ./node_modules/.bin/vitest run --mode production \
//     src/deck-builder/services/deckBuilder/deckGenerator.live.test.ts
//
// --mode production AND NODE_ENV=production are required: BASE_URL in
// scryfall/client.ts and edhrec/client.ts is
// `import.meta.env.DEV ? '<relative dev-proxy path>' : '<real API>'`, and
// vitest only derives import.meta.env.DEV from --mode when NODE_ENV is unset —
// a preset NODE_ENV silently wins and leaves DEV=true (relative URLs → every
// fetch throws "Failed to parse URL" in Node). LIVE_GEN_OUTDIR overrides the
// output directory.
//
// Only tagger-tags.json and card-similar.json are stubbed (served from the
// committed public/ snapshots, mirroring liftSynergy.eval.test.ts) — every
// other fetch goes out for real, with a User-Agent header merged in (Scryfall
// 400s on Node's default UA; EDHREC doesn't care).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import type {
  Customization,
  CollectionStrategy,
  GeneratedDeck,
  ManaPhilosophy,
  ScryfallCard,
} from '@/deck-builder/types';
import type { GenerationContext } from './deckGeneration/state';
import { generateDeck, clearGenerationCache } from './deckGenerator';
import { assembleBuildReport } from './buildReport';
import { getCardByName, getCardPrice } from '@/deck-builder/services/scryfall/client';
import { getScryfallStats, resetScryfallStats, type ScryfallStats } from '@/lib/scryfall-fetch';
import { validateCardRole, getCardTags } from '@/deck-builder/services/tagger/client';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.LIVE_GEN_OUTDIR ?? join(tmpdir(), 'spellcontrol-live-gen');

// E122: env-gated owned-collection knob so the panel can A/B
// collectionStrategy=prefer (and 'partial'/'available') against a real
// generation. LIVE_GEN_COLLECTION points at a JSON file — either a bare
// string[] of card names or `{ names: string[], ... }` (the committed
// __fixtures__/owned-collection.fixture.json is the latter; any other keys,
// e.g. `_assembly`, are ignored). Unset by default, so every other LIVE_GEN
// run is untouched. LIVE_GEN_COLLECTION_STRATEGY overrides the strategy
// (defaults to 'prefer' once a collection is supplied — the one E122 exists
// to test).
const COLLECTION_PATH = process.env.LIVE_GEN_COLLECTION;
const COLLECTION_NAMES: Set<string> | undefined = COLLECTION_PATH
  ? new Set<string>(
      (() => {
        const parsed: unknown = JSON.parse(readFileSync(resolve(COLLECTION_PATH), 'utf8'));
        return Array.isArray(parsed) ? parsed : (parsed as { names: string[] }).names;
      })()
    )
  : undefined;
const COLLECTION_STRATEGY: CollectionStrategy | undefined =
  (process.env.LIVE_GEN_COLLECTION_STRATEGY as CollectionStrategy | undefined) ??
  (COLLECTION_NAMES ? 'prefer' : undefined);

// E231 A/B knob: LIVE_GEN_MANA_PHILOSOPHY="reliable,greedy,spelllands,budget"
// (four raw numbers — the engine normalizes them) forces the mana-philosophy
// wheel on; unset leaves the product default, which is OFF (no wheel pass at
// all, manabase byte-identical).
function manaPhilosophyEnv(): ManaPhilosophy | undefined {
  const raw = process.env.LIVE_GEN_MANA_PHILOSOPHY;
  if (!raw) return undefined;
  const [reliable, greedy, spelllands, budget] = raw.split(',').map((v) => Number(v.trim()) || 0);
  return { reliable, greedy, spelllands, budget };
}

// ---- Customization factory (copied from deckGenerator.golden.test.ts) -----

function customization(overrides: Partial<Customization> = {}): Customization {
  return {
    deckFormat: 99, // app store defaults (landCount 37 / nonBasic 15) so auto-land-count engages like in-app
    landCount: 37,
    nonBasicLandCount: 15,
    bannedCards: [],
    banLists: [],
    mustIncludeCards: [],
    tempBannedCards: [],
    tempMustIncludeCards: [],
    maxCardPrice: null,
    deckBudget: null,
    budgetOption: 'any',
    gameChangerLimit: 'unlimited',
    targetBracket: 'all',
    maxRarity: null,
    tinyLeaders: false,
    ignoreOwnedBudget: false,
    ignoreOwnedRarity: false,
    collectionMode: false,
    collectionStrategy: COLLECTION_STRATEGY ?? 'full',
    collectionOwnedPercent: 75,
    arenaOnly: false,
    scryfallQuery: '',
    comboCount: 1,
    balancedRoles: true,
    currency: 'USD',
    appliedExcludeLists: [],
    appliedIncludeLists: [],
    tempoAutoDetect: true,
    tempoPacing: 'balanced',
    saltTolerance: 2,
    generationMode: 'edhrec',
    artThemeTag: '',
    historicalYear: 2005,
    permanentsOnly: false,
    brewLevel: 0.5,
    // E80 A/B knob, two-way: LIVE_GEN_PRICE_SANITY=1 forces the flag ON,
    // =0 forces it OFF, unset leaves it undefined (the product default —
    // resolvePriceSanity's budgetOption inference — applies). Lets the
    // orchestrator run the same panel three ways (product default / forced
    // on / forced off) without new RUNS entries.
    priceSanity:
      process.env.LIVE_GEN_PRICE_SANITY === '1'
        ? true
        : process.env.LIVE_GEN_PRICE_SANITY === '0'
          ? false
          : undefined,
    // E221 A/B knob, same two-way shape: LIVE_GEN_ARCHETYPE_BLEND=1 forces
    // archetype tag-page blending ON, =0 forces it OFF, unset leaves the
    // product default (OFF until the panel clears).
    archetypeBlend:
      process.env.LIVE_GEN_ARCHETYPE_BLEND === '1'
        ? true
        : process.env.LIVE_GEN_ARCHETYPE_BLEND === '0'
          ? false
          : undefined,
    manaPhilosophy: manaPhilosophyEnv(),
    ...overrides,
  };
}

// ---- Network stub: real fetch for everything except the two static assets --

let realFetch: typeof fetch;

beforeAll(async () => {
  mkdirSync(OUT_DIR, { recursive: true });

  const taggerData = JSON.parse(
    readFileSync(resolve(here, '..', '..', '..', '..', 'public', 'tagger-tags.json'), 'utf8')
  );
  const cardSimilarData = JSON.parse(
    readFileSync(resolve(here, '..', '..', '..', '..', 'public', 'card-similar.json'), 'utf8')
  );

  realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith('/tagger-tags.json')) {
      return { ok: true, status: 200, json: async () => taggerData } as Response;
    }
    if (url.endsWith('/card-similar.json')) {
      return { ok: true, status: 200, json: async () => cardSimilarData } as Response;
    }
    const headers = {
      ...(init?.headers as Record<string, string> | undefined),
      'User-Agent': 'SpellControl-DeckGen-EvalHarness/1.0',
    };
    return realFetch(input, { ...init, headers });
  });
}, 120_000);

afterAll(() => vi.unstubAllGlobals());

// ---- Runs -------------------------------------------------------------------

interface RunSpec {
  commanderName: string;
  variant: string;
  overrides?: Partial<Customization>;
}

const BASE_COMMANDERS = [
  "Atraxa, Praetors' Voice",
  'The Ur-Dragon',
  'Krenko, Mob Boss',
  'Talrand, Sky Summoner',
  'Meren of Clan Nel Toth',
  "Yuriko, the Tiger's Shadow",
  "Sythis, Harvest's Hand",
  'Isshin, Two Heavens as One',
  'Kozilek, the Great Distortion',
  'Lathril, Blade of the Elves',
];

const RUNS: RunSpec[] = [
  ...BASE_COMMANDERS.map((commanderName) => ({ commanderName, variant: 'base' })),
  { commanderName: 'Krenko, Mob Boss', variant: 'budget50', overrides: { deckBudget: 50 } },
  {
    commanderName: 'Meren of Clan Nel Toth',
    variant: 'budget100',
    overrides: { deckBudget: 100 },
  },
  {
    commanderName: "Atraxa, Praetors' Voice",
    variant: 'budget75',
    overrides: { deckBudget: 75 },
  },
  {
    commanderName: "Atraxa, Praetors' Voice",
    variant: 'bracket2',
    overrides: { targetBracket: 2 },
  },
  {
    commanderName: "Yuriko, the Tiger's Shadow",
    variant: 'bracket4',
    overrides: { targetBracket: 4 },
  },
];

/**
 * E221 NICHE PANEL — the panel that measures whether archetype tag-page
 * blending actually does anything.
 *
 * The standard RUNS panel above is the WRONG instrument for this mechanism,
 * twice over:
 *   1. Every commander on it has hundreds-to-thousands of EDHREC decks, so the
 *      blend weight floors at 0.35 and there's no thin pool to backfill.
 *   2. More fundamentally, it passes `selectedThemes: []` — no theme is ever
 *      selected, so the blend has no tag page to blend FROM and cannot fire at
 *      all. A flat result there is evidence of inapplicability, not safety.
 *
 * These pairs were chosen by QUERYING EDHREC for the real commander-theme deck
 * count (`/pages/commanders/{slug}/{theme}.json`, 2026-07-31) rather than
 * guessing which commanders are niche — the count is recorded per row so the
 * selection is auditable and re-checkable when the data shifts. They span
 * 7 → 159 decks, i.e. weight ~0.9 down to ~0.55.
 */
interface NicheSpec extends RunSpec {
  themeName: string;
  themeSlug: string;
  /** EDHREC decks on this commander-theme page when the panel was fixed. */
  measuredDecks: number;
}

const NICHE_RUNS: NicheSpec[] = [
  {
    commanderName: 'Obeka, Brute Chronologist',
    variant: 'wheels',
    themeName: 'Wheels',
    themeSlug: 'wheels',
    measuredDecks: 7,
  },
  {
    commanderName: 'Obeka, Brute Chronologist',
    variant: 'sacrifice',
    themeName: 'Sacrifice',
    themeSlug: 'sacrifice',
    measuredDecks: 9,
  },
  {
    commanderName: 'Sefris of the Hidden Ways',
    variant: 'zombies',
    themeName: 'Zombies',
    themeSlug: 'zombies',
    measuredDecks: 14,
  },
  {
    commanderName: 'Gisa, Glorious Resurrector',
    variant: 'zombies',
    themeName: 'Zombies',
    themeSlug: 'zombies',
    measuredDecks: 29,
  },
  {
    commanderName: 'Gnostro, Voice of the Crags',
    variant: 'spellslinger',
    themeName: 'Spellslinger',
    themeSlug: 'spellslinger',
    measuredDecks: 39,
  },
  {
    commanderName: 'Sefris of the Hidden Ways',
    variant: 'mill',
    themeName: 'Mill',
    themeSlug: 'mill',
    measuredDecks: 47,
  },
  {
    commanderName: 'Sivitri, Dragon Master',
    variant: 'control',
    themeName: 'Control',
    themeSlug: 'control',
    measuredDecks: 71,
  },
  {
    // Just above the niche band on purpose: the weight is nearly floored here,
    // so this row is the control — a big blend effect on THIS deck would mean
    // the weight curve isn't doing its job.
    commanderName: 'Gisa, Glorious Resurrector',
    variant: 'aristocrats',
    themeName: 'Aristocrats',
    themeSlug: 'aristocrats',
    measuredDecks: 159,
  },
];

/**
 * E228 — the POPULAR-commander-WITH-a-theme panel. The third instrument, and
 * the one E221's default-on decision actually hinges on.
 *
 * NICHE_RUNS above proves the blend HELPS where the pool is thin. It cannot
 * prove the blend DOESN'T HURT everywhere else, and the standard RUNS panel
 * can't either — it passes `selectedThemes: []`, so the blend never fires and
 * a flat result there is evidence of inapplicability, not of safety. That left
 * the no-harm case with zero evidence.
 *
 * These are commanders whose theme page is far past the point where the blend
 * weight floors at 0.35 — yet the blend STILL injects up to 15/category + 15
 * synergy. That injection, into decks with no thin-data problem to solve, is
 * exactly the risk default-on would take on.
 *
 * Ship condition (spec 4.5): NEUTRAL across the board is the no-harm evidence
 * needed to flip. Movement here means the floor isn't low enough and default-on
 * is wrong — even though NICHE_RUNS still improves.
 *
 * Counts MEASURED against live EDHREC (`/pages/commanders/{slug}.json`,
 * `panels.taglinks[].count`) on 2026-08-07 — same method as NICHE_RUNS, so the
 * selection stays auditable and re-checkable as the data shifts. They span
 * 515 → 7030 decks: the whole floored band, against NICHE_RUNS' 7 → 159.
 *
 * NB the spec sketched "Atraxa x Superfriends"; EDHREC has no `superfriends`
 * slug — the real tag for that page is `planeswalkers` (2519 decks).
 */
const POPULAR_THEMED_RUNS: NicheSpec[] = [
  {
    commanderName: 'Edgar Markov',
    variant: 'vampires',
    themeName: 'Vampires',
    themeSlug: 'vampires',
    measuredDecks: 7030,
  },
  {
    commanderName: 'Krenko, Mob Boss',
    variant: 'goblins',
    themeName: 'Goblins',
    themeSlug: 'goblins',
    measuredDecks: 6213,
  },
  {
    commanderName: 'Yuriko, the Tiger’s Shadow',
    variant: 'ninjutsu',
    themeName: 'Ninjutsu',
    themeSlug: 'ninjutsu',
    measuredDecks: 5324,
  },
  {
    commanderName: 'Sythis, Harvest’s Hand',
    variant: 'enchantress',
    themeName: 'Enchantress',
    themeSlug: 'enchantress',
    measuredDecks: 2710,
  },
  {
    commanderName: 'Meren of Clan Nel Toth',
    variant: 'aristocrats',
    themeName: 'Aristocrats',
    themeSlug: 'aristocrats',
    measuredDecks: 2591,
  },
  {
    commanderName: 'Atraxa, Praetors’ Voice',
    variant: 'planeswalkers',
    themeName: 'Planeswalkers',
    themeSlug: 'planeswalkers',
    measuredDecks: 2519,
  },
  {
    commanderName: 'Muldrotha, the Gravetide',
    variant: 'reanimator',
    themeName: 'Reanimator',
    themeSlug: 'reanimator',
    measuredDecks: 1398,
  },
  {
    // The boundary control, mirroring NICHE_RUNS' 159-deck row at the opposite
    // end: just past n>=500, so the weight is floored but the pool is the
    // thinnest here. If any row is going to move, it is this one — and if ONLY
    // this one moves, the floor is doing its job.
    commanderName: 'Lathril, Blade of the Elves',
    variant: 'plus-1-plus-1-counters',
    themeName: '+1/+1 Counters',
    themeSlug: 'plus-1-plus-1-counters',
    measuredDecks: 515,
  },
];

/**
 * LIVE_GEN_PANEL swaps the panel: `niche` = E221's thin-pool panel,
 * `popular` = E228's floored-weight no-harm panel, unset = the standard runs.
 */
const PANEL =
  process.env.LIVE_GEN_PANEL === 'niche'
    ? NICHE_RUNS
    : process.env.LIVE_GEN_PANEL === 'popular'
      ? POPULAR_THEMED_RUNS
      : RUNS;

function slugify(name: string, variant: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return variant === 'base' ? base : `${base}-${variant}`;
}

// ---- Projection --------------------------------------------------------------

function oracleTextOf(card: ScryfallCard): string {
  if (card.oracle_text) return card.oracle_text;
  if (card.card_faces?.length) {
    return card.card_faces
      .map((f) => f.oracle_text ?? '')
      .filter(Boolean)
      .join(' // ');
  }
  return '';
}

function projectCard(card: ScryfallCard, deck: GeneratedDeck) {
  return {
    name: card.name,
    mana_cost: card.mana_cost ?? null,
    cmc: card.cmc,
    type_line: card.type_line,
    price_usd: getCardPrice(card, 'USD'),
    oracle_text_snippet: oracleTextOf(card).slice(0, 140),
    edhrec_inclusion: deck.cardInclusionMap?.[card.name] ?? null,
    role: validateCardRole(card),
    tags: getCardTags(card.name),
  };
}

function totalPriceUsd(deck: GeneratedDeck): number {
  let total = 0;
  for (const cards of Object.values(deck.categories)) {
    for (const card of cards) {
      const p = getCardPrice(card, 'USD');
      if (p) total += parseFloat(p);
    }
  }
  return Math.round(total * 100) / 100;
}

// E78 item 6: this dump previously labeled these two sub-fields "inclusion"/
// "relevancy" — easy to misread as one normalized scale when scanning raw
// JSON. They're deliberately different scales with no production UI
// consumer (neither cardInclusionMap nor cardRelevancyMap is rendered
// anywhere in the app today — verified by exhaustive grep): EDHREC inclusion
// is a bounded 0-100 percentage; the relevancy score is an unbounded
// composite (synergy + role-deficit + curve/type fit + combo boosts, often
// several hundred) used only for internal re-ranking. Renamed so a future
// critic reading this dump can't mistake one for a normalized version of
// the other.
function buildCardRelevancy(
  deck: GeneratedDeck
): Record<string, { edhrecInclusionPct?: number; synergyScoreRaw?: number }> {
  const names = new Set([
    ...Object.keys(deck.cardInclusionMap ?? {}),
    ...Object.keys(deck.cardRelevancyMap ?? {}),
  ]);
  const out: Record<string, { edhrecInclusionPct?: number; synergyScoreRaw?: number }> = {};
  for (const name of names) {
    out[name] = {
      edhrecInclusionPct: deck.cardInclusionMap?.[name],
      synergyScoreRaw: deck.cardRelevancyMap?.[name],
    };
  }
  return out;
}

interface SummaryEntry {
  slug: string;
  commander: string;
  variant: string;
  totalCards?: number;
  lands?: number;
  avgCmc?: number;
  totalPriceUsd?: number;
  bracket?: { bracket: number; label: string } | null;
  deckGrade?: GeneratedDeck['deckGrade'] | null;
  deckScore?: number | null;
  generationSeconds?: number;
  /**
   * What this one generation cost Scryfall: requests sent, 429s eaten, ms
   * parked in the shared cooldown. `requests` is the figure that decides
   * whether card resolution should move onto the bulk dump we already ingest
   * nightly (`backend/src/scryfall-bulk.ts`) instead of the public API — a
   * generation still firing hundreds of requests for data sitting in our own
   * SQLite is the case for building that endpoint.
   *
   * NOTE: this panel runs in node, where `indexedDB` is undefined, so the
   * persistent card cache is a deliberate no-op here. These numbers measure the
   * limiter and the raw request volume, NOT the cache — cold-vs-warm cache
   * behavior can only be measured in a browser.
   */
  scryfall?: ScryfallStats;
  error?: string;
}

const summaries: SummaryEntry[] = [];

// LIVE_GEN_ONLY: comma-separated substrings to restrict the panel to a subset
// (e.g. LIVE_GEN_ONLY="atraxa,meren" for a fast bounded A/B). Matches against the
// slug and the commander name. Empty/unset → the full panel.
const ONLY = process.env.LIVE_GEN_ONLY?.split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const ACTIVE_RUNS =
  ONLY && ONLY.length > 0
    ? PANEL.filter((r) =>
        ONLY.some(
          (o) =>
            slugify(r.commanderName, r.variant).includes(o) ||
            r.commanderName.toLowerCase().includes(o)
        )
      )
    : PANEL;

describe.skipIf(!process.env.LIVE_GEN)('deckGenerator LIVE eval', () => {
  it.each(ACTIVE_RUNS)(
    '$commanderName [$variant]',
    async (spec) => {
      const slug = slugify(spec.commanderName, spec.variant);
      const entry: SummaryEntry = { slug, commander: spec.commanderName, variant: spec.variant };
      const t0 = Date.now();
      try {
        clearGenerationCache();
        resetScryfallStats();
        const commander = await getCardByName(spec.commanderName);
        if (!commander)
          throw new Error(`getCardByName returned nothing for "${spec.commanderName}"`);
        const colorIdentity = commander.color_identity;
        const custom = customization(spec.overrides);
        const ctx: GenerationContext = {
          commander,
          partnerCommander: null,
          colorIdentity,
          customization: custom,
          // Niche-panel rows carry a real EDHREC theme (source 'edhrec' + slug
          // is what state.ts requires to populate selectedThemesWithSlugs);
          // the standard panel stays theme-less exactly as before.
          selectedThemes:
            'themeSlug' in spec
              ? [
                  {
                    name: (spec as NicheSpec).themeName,
                    slug: (spec as NicheSpec).themeSlug,
                    source: 'edhrec' as const,
                    isSelected: true,
                  },
                ]
              : [],
          collectionNames: COLLECTION_NAMES,
        };

        const deck = await generateDeck(ctx);
        const buildReport = assembleBuildReport({
          generated: deck,
          customization: custom,
          collectionNames: COLLECTION_NAMES ?? new Set(),
        });

        const decklist: Record<string, ReturnType<typeof projectCard>[]> = {};
        for (const [cat, cards] of Object.entries(deck.categories)) {
          decklist[cat] = cards.map((c) => projectCard(c, deck));
        }

        // E130: role truth by NAME. Decklist buckets are TYPE-routed
        // (routeCardByType — a creature wipe sits in `creatures`), so a bucket
        // like boardWipes can be empty while the deck has wipes; two iter-19
        // blind critics misread exactly that as "zero board wipes". This is
        // roleCounts with names, lands excluded to match computeRoleCounts.
        const roleCardNames: Record<string, string[]> = {};
        for (const [cat, cards] of Object.entries(decklist)) {
          if (cat === 'lands') continue;
          for (const c of cards) {
            if (!c.role) continue;
            (roleCardNames[c.role] ??= []).push(c.name);
          }
        }

        const output = {
          commander: spec.commanderName,
          variant: spec.variant,
          colorIdentity,
          decklist,
          stats: {
            totalCards: deck.stats.totalCards,
            manaCurve: deck.stats.manaCurve,
            typeDistribution: deck.stats.typeDistribution,
            colorDistribution: deck.stats.colorDistribution,
            averageCmc: deck.stats.averageCmc,
            totalPriceUsd: totalPriceUsd(deck),
          },
          roleCounts: deck.roleCounts ?? null,
          roleCardNames,
          roleTargets: deck.roleTargets ?? null,
          roleTargetBreakdown: deck.roleTargetBreakdown ?? null,
          bracketEstimation: deck.bracketEstimation ?? null,
          deckGrade: deck.deckGrade ?? null,
          deckScore: deck.deckScore ?? null,
          detectedArchetype: deck.detectedArchetype ?? null,
          detectedPacing: deck.detectedPacing ?? null,
          manabase: deck.manabase ?? null,
          gapAnalysis: deck.gapAnalysis ?? null,
          detectedCombos: deck.detectedCombos ?? null,
          packagePicks: deck.packagePicks ?? null,
          liftPicksNote: deck.liftPicksNote ?? null,
          generationRelaxedNote: deck.generationRelaxedNote ?? null,
          buildReport,
          cardRelevancy: buildCardRelevancy(deck),
        };

        writeFileSync(join(OUT_DIR, `${slug}.json`), JSON.stringify(output, null, 2));

        entry.totalCards = deck.stats.totalCards;
        entry.lands = deck.categories.lands.length;
        entry.avgCmc = deck.stats.averageCmc;
        entry.totalPriceUsd = output.stats.totalPriceUsd;
        entry.bracket = deck.bracketEstimation
          ? { bracket: deck.bracketEstimation.bracket, label: deck.bracketEstimation.label }
          : null;
        entry.deckGrade = deck.deckGrade ?? null;
        entry.deckScore = deck.deckScore ?? null;
      } catch (err) {
        entry.error = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
        console.error(`[deckGen-live] FAILED ${spec.commanderName} [${spec.variant}]:`, err);
      } finally {
        entry.generationSeconds = Math.round((Date.now() - t0) / 100) / 10;
        entry.scryfall = getScryfallStats();
        console.log(
          `[deckGen-live] ${slug}: ${entry.scryfall.requests} scryfall requests, ` +
            `${entry.scryfall.throttled} × 429, ${entry.scryfall.cooldownMs}ms parked`
        );
        summaries.push(entry);
      }
      // Never fail the run over one bad commander — the point is the dump,
      // errors are captured in summary.json instead.
      expect(true).toBe(true);
    },
    600_000
  );

  it('writes summary.json after all runs', () => {
    // Depends on it.each above having populated `summaries` — vitest runs
    // its within a describe block in declaration order.
    writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(summaries, null, 2));

    // Panel-wide Scryfall cost, printed so an A/B is readable without opening
    // summary.json. Per-deck averages are what to compare across branches.
    const totals = summaries.reduce(
      (acc, s) => ({
        requests: acc.requests + (s.scryfall?.requests ?? 0),
        throttled: acc.throttled + (s.scryfall?.throttled ?? 0),
        gaveUp: acc.gaveUp + (s.scryfall?.gaveUp ?? 0),
        cooldownMs: acc.cooldownMs + (s.scryfall?.cooldownMs ?? 0),
      }),
      { requests: 0, throttled: 0, gaveUp: 0, cooldownMs: 0 }
    );
    const perDeck = summaries.length > 0 ? Math.round(totals.requests / summaries.length) : 0;
    console.log(
      `[deckGen-live] SCRYFALL TOTAL over ${summaries.length} decks: ` +
        `${totals.requests} requests (${perDeck}/deck), ${totals.throttled} × 429, ` +
        `${totals.gaveUp} gave up, ${Math.round(totals.cooldownMs / 1000)}s parked`
    );

    expect(summaries.length).toBe(ACTIVE_RUNS.length);
  });
});
