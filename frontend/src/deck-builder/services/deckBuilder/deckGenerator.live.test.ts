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
import type { Customization, GeneratedDeck, ScryfallCard } from '@/deck-builder/types';
import type { GenerationContext } from './deckGeneration/state';
import { generateDeck, clearGenerationCache } from './deckGenerator';
import { assembleBuildReport } from './buildReport';
import { getCardByName, getCardPrice } from '@/deck-builder/services/scryfall/client';
import { validateCardRole, getCardTags } from '@/deck-builder/services/tagger/client';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.LIVE_GEN_OUTDIR ?? join(tmpdir(), 'spellcontrol-live-gen');

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
    collectionStrategy: 'full',
    collectionOwnedPercent: 75,
    arenaOnly: false,
    scryfallQuery: '',
    comboCount: 1,
    hyperFocus: false,
    balancedRoles: true,
    currency: 'USD',
    appliedExcludeLists: [],
    appliedIncludeLists: [],
    advancedTargets: {
      curvePercentages: null,
      typePercentages: null,
      roleTargets: null,
      edhrecBlendWeight: null,
      edhrecInclusionThreshold: null,
    },
    tempoAutoDetect: true,
    tempoPacing: 'balanced',
    saltTolerance: 2,
    generationMode: 'edhrec',
    artThemeTag: '',
    historicalYear: 2005,
    permanentsOnly: false,
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
  error?: string;
}

const summaries: SummaryEntry[] = [];

describe.skipIf(!process.env.LIVE_GEN)('deckGenerator LIVE eval', () => {
  it.each(RUNS)(
    '$commanderName [$variant]',
    async (spec) => {
      const slug = slugify(spec.commanderName, spec.variant);
      const entry: SummaryEntry = { slug, commander: spec.commanderName, variant: spec.variant };
      const t0 = Date.now();
      try {
        clearGenerationCache();
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
          selectedThemes: [],
        };

        const deck = await generateDeck(ctx);
        const buildReport = assembleBuildReport({
          generated: deck,
          customization: custom,
          collectionNames: new Set(),
        });

        const decklist: Record<string, ReturnType<typeof projectCard>[]> = {};
        for (const [cat, cards] of Object.entries(deck.categories)) {
          decklist[cat] = cards.map((c) => projectCard(c, deck));
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
    expect(summaries.length).toBe(RUNS.length);
  });
});
