// LIVE-DATA evaluation of the Coach tab (E538 + E539).
//
// Runs the deck page's real Coach pipeline (analyzeCommanderDeck, then the
// page's wiring in coachView.ts) on LIVE_GEN panel dumps, with the data
// sources the app uses: EDHREC and Scryfall through the app's own clients,
// replayed from the shared HTTP cache; card records from the Scryfall bulk
// file, served where the app asks its own backend (/api/cards/lookup and
// /api/cards/named answer from the nightly bulk dump). A cache miss goes live
// only while this process holds the shared live lock.
//
// Two modes, both gated behind LIVE_GEN=1 so a normal `npm test` skips them:
//
//   COACH_EVAL_ADVISE="standard=<dir>#standard--,collection=<dir>"
//     For each dump: record every Coach move with its rank, surface and why;
//     apply the top N (COACH_EVAL_N, default 5) the way a user does
//     (applyCoachMoves.ts); write <out>/<panel>/original/<file>.json (the
//     input) and <out>/<panel>/advised/<file>.json (same format, gate-ready);
//     then run a second Coach pass on the advised deck for ping-pong.
//     "#prefix" keeps only files starting with it.
//
//   COACH_EVAL_BENCH="E509r1=<newDir>|<baseDir>|<gate output json>,..."
//     For each deck the blind gate judged: extract card labels from its
//     critic and differ (coachLabels.ts), run Coach on the judged dump, and
//     again with E510's ordering subtracted, and score the ranked lists
//     (coachReport.ts).
//
//   cd frontend && LIVE_GEN=1 NODE_ENV=production COACH_EVAL_OUT=<dir> \
//     LIVE_GEN_HTTP_CACHE=../../.deckgen-http-cache COACH_EVAL_ADVISE=... \
//     ./node_modules/.bin/vitest run --mode production \
//     src/deck-builder/services/deckBuilder/coachEval/coachEval.live.test.ts
//
// Other knobs: COACH_EVAL_BULK (oracle_cards .jsonl.gz, default the newest in
// node_modules/.cache/card-facts), COACH_EVAL_OWNED (owned names for
// collection rows, default the harness fixture), COACH_EVAL_ONLY (substring
// filter), COACH_EVAL_OFFLINE=1 (a cache miss fails instead of going live),
// COACH_EVAL_LOCK (the live lock dir, default ../../.deckgen-live.lock).
import { describe, it, beforeAll, afterAll, vi, expect } from 'vitest';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import type {
  Customization,
  DeckDataSource,
  EDHRECCommanderData,
  ScryfallCard,
} from '@/deck-builder/types';
import type { ComboMatchResponse } from '@/types/combos';
import {
  analyzeCommanderDeck,
  buildInclusionIndex,
  computeRoleCounts,
  detectCombosForAnalysis,
  lookupInclusion,
  type CommanderDeckAnalysisResult,
} from '../commanderDeckAnalysis';
import { estimateBracket } from '../bracketEstimator';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import { setCardFactsSnapshot } from '@/deck-builder/services/cardFacts';
import {
  fetchCommanderCombos,
  fetchCommanderData,
  fetchCommanderThemeData,
  fetchPartnerCommanderData,
  fetchPartnerThemeData,
} from '@/deck-builder/services/edhrec/client';
import { getGameChangerNames, searchCards } from '@/deck-builder/services/scryfall/client';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { rankReplacementCuts } from '@/lib/coach/intelligent-cuts';
import { axisKeys } from '@/lib/coach/axis-overlap';
import { frontFaceName } from '@/lib/cards/card-text';
import { isBasicLandName } from '@/lib/collection/allocations';
import { HARDCODED_GAME_CHANGERS } from '@spellcontrol/deck-metrics';
import {
  coachDeckSettings,
  cutKeepsSettings,
  fitsSettings,
  settingsChecker,
} from '@/lib/coach/deck-settings-fit';
import type { SubstituteCandidate } from '../substituteFinder';
import { dumpPage, resolveName } from '../deckObjective/panelDump';
import { deckEdhrecSource, fetchDeckEdhrecPage, type DeckEdhrecSource } from '../deckEdhrecSource';
import { synergyStrength } from '../synergyLift';
import { buildCoachView, combosFromEdhrec, type CoachView } from './coachView';
import {
  applyCoachMoves,
  auditMoves,
  orderedCoachMoves,
  type ApplyEnv,
  type CoachMove,
  type DeckSettings,
  type EvalDeckState,
  type MoveAudit,
} from './applyCoachMoves';
import { advisedDump, rebuildDeck, stampGenerationFlags, type CoachDump } from './coachDump';
import { buildNameMatcher, extractDeckLabels } from './coachLabels';
import {
  adviseMarkdown,
  adviseNumbers,
  benchMarkdown,
  benchNumbers,
  IMPLICIT_REVERSAL,
  type AdviseRecord,
  type AuditedMove,
  type BenchRecord,
  type SurfaceLists,
} from './coachReport';

// E510 retro: while `__coachEvalPreE510` is set, every E510 consumer reads
// EDHREC's synergy as the subtraction it replaced (the pre-E510 code: sort and
// filter by `synergy`, signature = synergy > 0.3).
vi.mock('../synergyLift', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../synergyLift')>();
  const pre = () => (globalThis as { __coachEvalPreE510?: boolean }).__coachEvalPreE510 === true;
  return {
    ...orig,
    synergyStrength: (c: Parameters<typeof orig.synergyStrength>[0]) =>
      pre() ? (c.synergy ?? 0) : orig.synergyStrength(c),
    bySynergyStrength: (
      a: Parameters<typeof orig.bySynergyStrength>[0],
      b: Parameters<typeof orig.bySynergyStrength>[1]
    ) => (pre() ? (b.synergy ?? 0) - (a.synergy ?? 0) : orig.bySynergyStrength(a, b)),
    isSignatureSynergy: (c: Parameters<typeof orig.isSignatureSynergy>[0]) =>
      pre() ? (c.synergy ?? 0) > orig.LEGACY_SIGNATURE_SYNERGY : orig.isSignatureSynergy(c),
  };
});

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(here, '..', '..', '..', '..', '..');
const DEV_ROOT = resolve(FRONTEND, '..', '..');
const OUT = process.env.COACH_EVAL_OUT ?? join(tmpdir(), 'spellcontrol-coach-eval');
const HTTP_CACHE = process.env.LIVE_GEN_HTTP_CACHE;
const LOCK = process.env.COACH_EVAL_LOCK ?? join(DEV_ROOT, '.deckgen-live.lock');
const OFFLINE = process.env.COACH_EVAL_OFFLINE === '1';
const N = Number(process.env.COACH_EVAL_N ?? 5);
const AUDIT_K = 10;
const ONLY = process.env.COACH_EVAL_ONLY?.split(',').filter(Boolean);
/** The prescan's premium watchlist (deckgen-eval-gate/scripts/prescan.py). */
const WATCHLIST = new Set([
  'Rhystic Study', 'Fierce Guardianship', 'Sylvan Library', 'Heroic Intervention',
  'Lightning Greaves', 'Supreme Verdict', 'Snuff Out', 'Misdirection', 'Toxic Deluge',
  'Force of Will', 'Ugin, the Spirit Dragon', "Bolas's Citadel", 'Jace, the Mind Sculptor',
  'Blood Artist', 'Skullclamp', 'Path to Exile', 'Craterhoof Behemoth', 'Sol Ring',
  'Arcane Signet', 'Smothering Tithe', 'Cyclonic Rift', 'Deflecting Swat',
  "Teferi's Protection", 'Swiftfoot Boots',
]); // prettier-ignore

// ---- Panels -------------------------------------------------------------------

interface AdvisePanel {
  name: string;
  dir: string;
  prefix: string;
}
interface BenchGate {
  name: string;
  newDir: string;
  baseDir: string;
  output: string;
}

function advisePanels(): AdvisePanel[] {
  return (process.env.COACH_EVAL_ADVISE ?? '')
    .split(',')
    .filter(Boolean)
    .map((spec) => {
      const [name, rest] = spec.split('=');
      const [dir, prefix = ''] = rest.split('#');
      return { name, dir, prefix };
    });
}

function benchGates(): BenchGate[] {
  return (process.env.COACH_EVAL_BENCH ?? '')
    .split(',')
    .filter(Boolean)
    .map((spec) => {
      const [name, rest] = spec.split('=');
      const [newDir, baseDir, output] = rest.split('|');
      return { name, newDir, baseDir, output };
    });
}

const keep = (file: string) => !ONLY?.length || ONLY.some((o) => file.includes(o));

function dumpFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'summary.json' && f.startsWith(prefix))
    .filter(keep)
    .sort();
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const writeJson = (path: string, value: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
};

// ---- Card records from the Scryfall bulk file ---------------------------------

const BY_NAME = new Map<string, ScryfallCard>();
/** Lowercased front face → card: the backend's lookup key (cache.ts getCheapestByName). */
const BY_LOWER_FRONT = new Map<string, ScryfallCard>();
const UNIVERSE: string[] = [];

function bulkPath(): string {
  if (process.env.COACH_EVAL_BULK) return process.env.COACH_EVAL_BULK;
  const dir = join(FRONTEND, 'node_modules', '.cache', 'card-facts');
  const file = readdirSync(dir)
    .filter((f) => /^oracle-cards-\d+\.jsonl\.gz$/.test(f))
    .sort()
    .at(-1);
  if (!file) throw new Error(`no oracle_cards bulk file in ${dir} (set COACH_EVAL_BULK)`);
  return join(dir, file);
}

/** Only what the engines read; images and URIs dropped to keep 30k cards small. */
function slim(c: Record<string, unknown>): ScryfallCard {
  const faces = (c.card_faces as Record<string, unknown>[] | undefined)?.map((f) => ({
    name: f.name,
    mana_cost: f.mana_cost,
    type_line: f.type_line,
    oracle_text: f.oracle_text,
    colors: f.colors,
    power: f.power,
    toughness: f.toughness,
    loyalty: f.loyalty,
    cmc: f.cmc,
  }));
  const pick = [
    'id', 'oracle_id', 'name', 'mana_cost', 'cmc', 'type_line', 'oracle_text', 'colors',
    'color_identity', 'keywords', 'power', 'toughness', 'loyalty', 'produced_mana', 'legalities',
    'games', 'rarity', 'set', 'set_name', 'layout', 'prices', 'edhrec_rank', 'game_changer',
    'reserved', 'released_at',
  ]; // prettier-ignore
  const out: Record<string, unknown> = {};
  for (const k of pick) if (c[k] !== undefined) out[k] = c[k];
  if (faces) out.card_faces = faces;
  return out as unknown as ScryfallCard;
}

async function loadBulk(path: string): Promise<void> {
  const lines = createInterface({
    input: createReadStream(path).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  const better = (prev: ScryfallCard | undefined, c: ScryfallCard) =>
    !prev || (prev.legalities?.commander !== 'legal' && c.legalities?.commander === 'legal');
  for await (const line of lines) {
    if (!line) continue;
    const raw = JSON.parse(line) as Record<string, unknown>;
    if (/token|emblem|art_series/.test(String(raw.layout ?? ''))) continue;
    const c = slim(raw);
    if (better(BY_NAME.get(c.name), c)) BY_NAME.set(c.name, c);
    const front = frontFaceName(c.name);
    if (front !== c.name && better(BY_NAME.get(front), c) && !BY_NAME.has(front))
      BY_NAME.set(front, c);
    const low = front.toLowerCase();
    if (better(BY_LOWER_FRONT.get(low), c)) BY_LOWER_FRONT.set(low, c);
    if (c.legalities?.commander === 'legal') UNIVERSE.push(c.name);
  }
}

const cardFor = (name: string) =>
  resolveName(BY_NAME, name) ?? BY_LOWER_FRONT.get(frontFaceName(name).trim().toLowerCase());

// ---- Network: HTTP cache replay, backend card routes from the bulk file ------

let lockHeld = false;
async function acquireLock(): Promise<void> {
  if (lockHeld) return;
  for (;;) {
    try {
      mkdirSync(LOCK);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
  writeFileSync(join(LOCK, 'owner'), process.env.COACH_EVAL_LOCK_OWNER ?? 'coach-eval');
  lockHeld = true;
}
function releaseLock(): void {
  if (!lockHeld) return;
  rmSync(LOCK, { recursive: true, force: true });
  lockHeld = false;
}
process.on('exit', releaseLock);

const netStats = { hits: 0, misses: 0, live: 0, bulk: 0 };
const missedUrls: string[] = [];
/** Names the bulk file couldn't answer (the app's backend would miss them too). */
const bulkMisses = new Set<string>();
let realFetch: typeof fetch;

/**
 * The backend answers a name with its cheapest PRICED printing
 * (cache.ts getCheapestByName). oracle_cards carries one printing per card,
 * sometimes one with no USD price (Overgrown Tomb 'trk', Fellwar Stone 'mbc'),
 * which the budget checks then read as free. Fill such a card's price from
 * Scryfall's cheapest priced printing, through the HTTP cache.
 */
const priceHydrated = new Set<string>();
async function hydratePrice(card: ScryfallCard | undefined): Promise<void> {
  if (!card || card.prices?.usd || priceHydrated.has(card.name)) return;
  priceHydrated.add(card.name);
  if (isBasicLandName(card.name)) return;
  const q = encodeURIComponent(`!"${frontFaceName(card.name)}" usd>0`);
  const url = `https://api.scryfall.com/cards/search?q=${q}&unique=prints&order=usd&dir=asc`;
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const body = (await res.json()) as { data?: ScryfallCard[] };
    const usd = body.data?.find((c) => c.prices?.usd)?.prices?.usd;
    if (usd) card.prices = { ...card.prices, usd };
  } catch {
    // No price found: the card stays unpriced, which the budget check hides.
  }
}

async function lookupResponse(body: { names?: string[]; ids?: string[] }): Promise<Response> {
  const byName: Record<string, ScryfallCard> = {};
  for (const n of body.names ?? []) {
    const c = cardFor(n);
    await hydratePrice(c);
    if (c) byName[n] = c;
    else bulkMisses.add(n);
  }
  netStats.bulk++;
  return new Response(JSON.stringify({ byName, byId: {} }), { status: 200 });
}

function installFetch(): void {
  const snapshot = (file: string) => readFileSync(join(FRONTEND, 'public', file), 'utf8');
  const statics: Record<string, string> = {
    '/tagger-tags.json': snapshot('tagger-tags.json'),
    '/card-similar.json': snapshot('card-similar.json'),
    '/card-facts.json': snapshot('card-facts.json'),
    '/otag-index.json': snapshot('otag-index.json'),
  };
  realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    for (const [suffix, body] of Object.entries(statics)) {
      if (url.endsWith(suffix)) return new Response(body, { status: 200 });
    }
    if (url.startsWith('/api/cards/lookup')) {
      return lookupResponse(JSON.parse(String(init?.body ?? '{}')));
    }
    if (url.startsWith('/api/cards/named')) {
      const name = new URL(url, 'http://x').searchParams.get('exact') ?? '';
      const card = cardFor(name) ?? null;
      await hydratePrice(card ?? undefined);
      netStats.bulk++;
      return new Response(JSON.stringify({ card }), { status: card ? 200 : 404 });
    }
    if (url.startsWith('/')) return new Response('{"error":"no backend"}', { status: 503 });
    const key = createHash('sha1')
      .update(`${init?.method ?? 'GET'} ${url} ${typeof init?.body === 'string' ? init.body : ''}`)
      .digest('hex');
    const file = HTTP_CACHE ? join(HTTP_CACHE, `${key}.json`) : null;
    if (file && existsSync(file)) {
      netStats.hits++;
      const hit = readJson<{ status: number; body: string }>(file);
      return new Response(hit.body, { status: hit.status });
    }
    netStats.misses++;
    missedUrls.push(url);
    if (OFFLINE) return new Response('{"error":"not in the HTTP cache"}', { status: 404 });
    await acquireLock();
    netStats.live++;
    const headers = {
      ...(init?.headers as Record<string, string> | undefined),
      'User-Agent': 'SpellControl-CoachEval/1.0',
    };
    const res = await realFetch(input, { ...init, headers });
    if (file && (res.ok || res.status === 404)) {
      const body = await res.text();
      writeFileSync(file, JSON.stringify({ status: res.status, body }));
      return new Response(body, { status: res.status });
    }
    return res;
  });
}

// ---- Shared per-run data --------------------------------------------------------

let GAME_CHANGERS = new Set<string>();
let OWNED_NAMES = new Set<string>();
let OWNED_POOL: SubstituteCandidate[] = [];
let OWNED_LANDS: ScryfallCard[] = [];

beforeAll(async () => {
  if (!process.env.LIVE_GEN) return;
  if (HTTP_CACHE) mkdirSync(HTTP_CACHE, { recursive: true });
  await loadBulk(bulkPath());
  installFetch();
  if (!(await loadTaggerData())) throw new Error('tagger snapshot did not load');
  setCardFactsSnapshot(readJson(join(FRONTEND, 'public', 'card-facts.json')));
  // The E510 switch must reach the engines' copy of synergyLift, or the retro
  // compares a thing with itself.
  const probe = { inclusion: 12, synergy: 0.11, potential_decks: 20_000, num_decks: 2_400 };
  (globalThis as { __coachEvalPreE510?: boolean }).__coachEvalPreE510 = true;
  const preReading = synergyStrength(probe);
  (globalThis as { __coachEvalPreE510?: boolean }).__coachEvalPreE510 = false;
  if (preReading !== 0.11 || synergyStrength(probe) === 0.11) {
    throw new Error('E510 retro switch is not reaching synergyLift');
  }
  GAME_CHANGERS = await getGameChangerNames().catch(() => new Set(HARDCODED_GAME_CHANGERS));
  const ownedFile =
    process.env.COACH_EVAL_OWNED ??
    join(here, '..', '__fixtures__', 'owned-collection.fixture.json');
  const owned = readJson<string[] | { names: string[]; pool?: SubstituteCandidate[] }>(ownedFile);
  OWNED_NAMES = new Set(Array.isArray(owned) ? owned : owned.names);
  OWNED_POOL = Array.isArray(owned) ? [] : (owned.pool ?? []);
  OWNED_LANDS = [...OWNED_NAMES]
    .map((n) => cardFor(n))
    .filter((c): c is ScryfallCard => !!c && /land/i.test(c.type_line ?? ''));
}, 600_000);

afterAll(() => {
  releaseLock();
  vi.unstubAllGlobals();
});

// ---- One Coach pass -------------------------------------------------------------

function settingsOf(dump: CoachDump): DeckSettings {
  const cz = dump.customization as Record<string, unknown>;
  const tb = cz.targetBracket;
  return {
    colorIdentity: dump.colorIdentity,
    deckBudget: (cz.deckBudget as number | null) ?? null,
    maxCardPrice: (cz.maxCardPrice as number | null) ?? null,
    targetBracket: typeof tb === 'number' ? tb : null,
    gameChangerLimit: (cz.gameChangerLimit as DeckSettings['gameChangerLimit']) ?? 'unlimited',
    maxRarity: (cz.maxRarity as DeckSettings['maxRarity']) ?? null,
    collectionMode: cz.collectionMode === true,
    collectionStrategy: (cz.collectionStrategy as DeckSettings['collectionStrategy']) ?? 'full',
    collectionOwnedPercent: Number(cz.collectionOwnedPercent ?? 75),
    ignoreOwnedBudget: cz.ignoreOwnedBudget === true,
    ignoreOwnedRarity: cz.ignoreOwnedRarity === true,
    ownedNames: cz.collectionMode === true ? OWNED_NAMES : new Set<string>(),
  };
}

interface CoachPass {
  analysis: CommanderDeckAnalysisResult;
  view: CoachView;
  moves: CoachMove[];
  env: ApplyEnv;
  page: EDHRECCommanderData | null;
  combos: ReturnType<typeof combosFromEdhrec>;
}

const fixingLandCache = new Map<string, ScryfallCard[]>();
async function fixingLands(identity: string[]): Promise<ScryfallCard[]> {
  // DeckEditorPage fetchFixingLands: 2+ colours only, the search hook's 60.
  if (identity.length < 2) return [];
  const key = [...identity].sort().join('');
  if (!fixingLandCache.has(key)) {
    const res = await searchCards('t:land -t:basic', key.split(''), { order: 'edhrec' }).catch(
      () => ({ data: [] as ScryfallCard[] })
    );
    fixingLandCache.set(key, res.data.slice(0, 60));
  }
  return fixingLandCache.get(key)!;
}

/** The deck's EDHREC source as the app reads it off a saved generated deck. */
function sourceOf(dump: CoachDump): DeckEdhrecSource | undefined {
  const page = dumpPage(dump);
  const cz = dump.customization as Partial<Customization>;
  return deckEdhrecSource({
    generationContext: {
      selectedThemes: page.theme
        ? [{ name: page.theme, slug: page.theme, source: 'edhrec', isSelected: true }]
        : [],
      targetBracket: cz.targetBracket ?? 'all',
      landCount: 0,
      collectionMode: cz.collectionMode === true,
      customization: cz,
    },
    buildReport: dump.buildReport as { dataSource?: DeckDataSource } | undefined,
  });
}

async function coachPass(dump: CoachDump, deck: EvalDeckState): Promise<CoachPass> {
  const settings = settingsOf(dump);
  const { commander, partner, cards } = deck;
  // DeckEditorPage's analysis reads the page the deck was built from.
  const edhrecSource = sourceOf(dump);
  const page = await fetchDeckEdhrecPage(commander, partner, edhrecSource).catch(() => null);
  const edhrecCombos = await fetchCommanderCombos(commander.name);
  const allNames = [
    commander.name,
    ...(partner ? [partner.name] : []),
    ...cards.map((c) => c.name),
  ];
  const combos = combosFromEdhrec(edhrecCombos, allNames);
  const response: ComboMatchResponse = {
    ...combos,
    almostInCollection: [],
    source: 'local',
    almostInCollectionTotal: 0,
  };
  const detected = await detectCombosForAnalysis(response, [
    commander,
    ...(partner ? [partner] : []),
    ...cards,
  ]);
  const buildReport = dump.buildReport as { archetypeBlendNames?: string[] } | undefined;
  const analysis = await analyzeCommanderDeck({
    commander,
    partnerCommander: partner,
    cards,
    deckSize: 99,
    colorIdentity: dump.colorIdentity,
    detectedCombos: detected,
    oneAwayCombos: combos.oneAway,
    archetypeBlendNames: buildReport?.archetypeBlendNames,
    edhrecSource,
  });
  if (!analysis) throw new Error('analyzeCommanderDeck returned null');
  if (analysis.edhrecMissing) throw new Error('EDHREC missing for this commander');

  const strategy = settings.collectionStrategy;
  // DeckEditorPage `useCoachSettings`: the saved customization, no stated target,
  // against the deck as it stands (the replace prompt reads the live deck).
  const fitFor = (deckCards: readonly ScryfallCard[]) =>
    fitsSettings(
      settingsChecker(
        coachDeckSettings({
          generationContext: {
            selectedThemes: [],
            targetBracket: settings.targetBracket ?? 'all',
            landCount: 0,
            collectionMode: settings.collectionMode,
            customization: dump.customization as Partial<Customization>,
          },
          bracketOverride: null,
        }),
        {
          cards: deckCards,
          isOwned: (name) => settings.ownedNames.has(name),
          full: deckCards.length >= 99 - (partner ? 1 : 0),
          gameChangerNames: GAME_CHANGERS,
          cardData: (name) => analysis.suggestionCards?.[name],
        }
      )
    );
  const view = buildCoachView({
    commander,
    partner,
    cards,
    analysis,
    ownedNames: settings.ownedNames,
    ownedPool: settings.collectionMode ? OWNED_POOL : [],
    ownedLands: settings.collectionMode ? OWNED_LANDS : [],
    fixingLands: await fixingLands(dump.colorIdentity),
    combos,
    ownedOnly: settings.collectionMode && (strategy === 'full' || strategy === 'available'),
    substitutesReady: true,
    settingsFit: fitFor(cards),
  });
  const commanderNames = allNames.slice(0, partner ? 2 : 1);
  const env: ApplyEnv = {
    resolve: cardFor,
    rankCuts: (addCard, current) =>
      rankReplacementCuts({
        addCard,
        deckCards: current.map((card, i) => ({ slotId: String(i), card })),
        // The persisted analysis (DeckEditorPage passes the deck, commander
        // included): it doesn't recompute between quick applies.
        analysis: { ...analysis, commander, partnerCommander: partner },
        inDeckCombos: combosFromEdhrec(edhrecCombos, [
          ...commanderNames,
          ...current.map((c) => c.name),
        ]).inDeck,
        keepsSettings: cutKeepsSettings(fitFor(current), addCard),
      }).map((r) => ({ name: r.card.name, reason: r.reason })),
    bracketOf: (current) => {
      const names = [...commanderNames, ...current.map((c) => c.name)];
      const nonLand = current.filter((c) => !/land/i.test(c.type_line ?? ''));
      const avg = nonLand.reduce((s, c) => s + (c.cmc ?? 0), 0) / Math.max(1, nonLand.length);
      const inDeck = combosFromEdhrec(edhrecCombos, names).inDeck;
      return estimateBracket(
        names,
        inDeck.map((m) => ({
          comboId: m.combo.id,
          cards: m.combo.cards.map((c) => c.cardName),
          results: m.combo.produces,
          isComplete: true,
          missingCards: [],
          deckCount: m.combo.popularity,
          bracket: m.combo.bracket,
          bracketTag: m.combo.bracketTag ?? null,
          cardCount: m.combo.cardCount,
        })),
        avg,
        undefined,
        computeRoleCounts([...current]).roleCounts,
        GAME_CHANGERS,
        commanderNames
      ).bracket;
    },
    isGameChanger: (name) => GAME_CHANGERS.has(name) || GAME_CHANGERS.has(frontFaceName(name)),
  };
  const moves = orderedCoachMoves(view);
  // The app prices a card on apply from its cheapest priced printing.
  for (const m of moves) await hydratePrice(cardFor(m.name));
  return { analysis, view, moves, env, page, combos };
}

/** A card a cut should never take: ≥40% on the page, a Game Changer, a watchlist premium. */
function isStaple(index: Map<string, number>, name: string): boolean {
  return (
    (lookupInclusion(index, name) ?? 0) >= 40 ||
    GAME_CHANGERS.has(name) ||
    WATCHLIST.has(frontFaceName(name))
  );
}

/**
 * The deck as the app holds it after a save: the dump's cards with the flags
 * generation stamped on them, read back from the EDHREC pages the generation
 * read (dumpPage: base, budget/bracket, theme).
 */
async function generatedDeck(dump: CoachDump): Promise<EvalDeckState> {
  const deck = rebuildDeck(dump, BY_NAME);
  const page = dumpPage(dump);
  const budget = page.budgetOption && page.budgetOption !== 'any' ? page.budgetOption : undefined;
  const bracket =
    page.targetBracket && page.targetBracket !== 'all' ? page.targetBracket : undefined;
  const commanderPage = (b?: typeof budget, t?: typeof bracket) =>
    page.partner
      ? fetchPartnerCommanderData(page.commander, page.partner, b, t)
      : fetchCommanderData(page.commander, b, t);
  const pages = [commanderPage()];
  if (budget || bracket) pages.push(commanderPage(budget, bracket));
  if (page.theme) {
    pages.push(
      page.partner
        ? fetchPartnerThemeData(page.commander, page.partner, page.theme, budget, bracket)
        : fetchCommanderThemeData(page.commander, page.theme, budget, bracket)
    );
  }
  const synergy = new Set<string>();
  for (const r of await Promise.allSettled(pages)) {
    if (r.status !== 'fulfilled') continue;
    for (const c of [...r.value.cardlists.allNonLand, ...r.value.cardlists.lands]) {
      if (c.isThemeSynergyCard) synergy.add(c.name);
    }
  }
  return { ...deck, cards: stampGenerationFlags(deck.cards, GAME_CHANGERS, synergy) };
}

/** Error-bucket flags a setting can't express: a staple cut, an off-plan add. */
function flagAudit(audit: MoveAudit[], pass: CoachPass, deck: EvalDeckState): AuditedMove[] {
  const index = pass.page ? buildInclusionIndex(pass.page) : new Map<string, number>();
  const invested = new Set<string>(analyzeDeckSynergy(deck.cards).invested);
  return audit.map((a) => {
    const cutsStaple = !!a.cut && isStaple(index, a.cut);
    let offPlan = false;
    if (a.move.type !== 'cut') {
      const card = cardFor(a.move.name);
      const onPage = lookupInclusion(index, a.move.name) != null;
      const fits = card
        ? [...axisKeys(card)].some((k) => invested.has(k.slice(0, k.indexOf(':'))))
        : false;
      offPlan = !onPage && !fits && !/land/i.test(card?.type_line ?? '');
    }
    return {
      surface: a.move.surface,
      type: a.move.type,
      name: a.move.name,
      cut: a.cut,
      violations: a.violations,
      cutsStaple,
      offPlan,
    };
  });
}

function cutSurface(id: string, lane: string, group?: string): string {
  if (id.startsWith('cardfit:')) return 'misfit';
  if (lane === 'bracket-fit') return 'bracket-fit';
  const g = (group ?? 'other').startsWith('excess:') ? 'excess-role' : (group ?? 'other');
  return `optimize:${g}`;
}

function listsOf(pass: CoachPass, audit: MoveAudit[], appliedCuts: string[]): SurfaceLists {
  const { view, moves, analysis } = pass;
  const cutsBySurface: Record<string, string[]> = {};
  for (const r of view.cuts) {
    const s = cutSurface(r.change.id, r.change.lane, r.change.group);
    (cutsBySurface[s] ??= []).push(r.change.name);
  }
  // Diagnostics: the same cut candidates in the optimizer's own order, and
  // lowest play rate first, against the lane's order.
  cutsBySurface['diag:optimizer-order'] = [
    ...(analysis.optimizeSwaps?.removals ?? []).map((o) => o.name),
    ...(analysis.misfits ?? []).map((m) => m.name),
  ];
  cutsBySurface['diag:lowest-inclusion-first'] = [...view.cuts]
    .sort((a, b) => (a.change.inclusion ?? -1) - (b.change.inclusion ?? -1))
    .map((r) => r.change.name);

  const addsBySurface: Record<string, string[]> = {};
  for (const m of moves) {
    if (m.type === 'cut') continue;
    const s = m.source === 'nbm' ? 'nbm' : m.surface;
    (addsBySurface[s] ??= []).push(m.name);
  }
  addsBySurface['hidden-gems'] = view.hiddenGems.map((g) => g.name);
  addsBySurface['add-panel:staples'] = view.suggestions.staples.map((s) => s.name);
  addsBySurface['add-panel:gems'] = view.suggestions.gems.map((s) => s.name);
  addsBySurface['synergy'] = (analysis.synergyAnalysis?.suggestions ?? []).map((s) => s.cardName);

  const universe = new Set<string>([
    ...moves.filter((m) => m.type !== 'cut').map((m) => m.name),
    ...view.hiddenGems.map((g) => g.name),
    ...view.suggestions.staples.map((s) => s.name),
    ...view.suggestions.combos.map((s) => s.name),
    ...(analysis.gapAnalysis ?? []).map((g) => g.name),
    ...(analysis.optimizeSwaps?.additions ?? []).map((o) => o.name),
  ]);
  return {
    cutsLane: view.cuts.map((r) => r.change.name),
    cutsBySurface,
    swapOuts: moves.filter((m) => m.type === 'swap' && m.outName).map((m) => m.outName!),
    replaceCuts: audit.filter((a) => a.move.type === 'add' && a.cut).map((a) => a.cut!),
    appliedCuts,
    feedAdds: moves.filter((m) => m.type !== 'cut').map((m) => m.name),
    addsBySurface,
    universeAdds: [...universe],
  };
}

function priceOf(cards: readonly ScryfallCard[]): number {
  return (
    Math.round(
      cards.reduce((s, c) => s + (Number(c.prices?.usd ?? c.prices?.usd_foil ?? 0) || 0), 0) * 100
    ) / 100
  );
}

function moveRecord(m: CoachMove) {
  return {
    rank: m.rank,
    source: m.source,
    surface: m.surface,
    type: m.type,
    name: m.name,
    outName: m.outName ?? null,
    tier: m.tier ?? null,
    reason: m.reason ?? null,
    whyFactors: m.whyFactors ?? null,
    inclusion: m.inclusion ?? null,
    ownership: m.ownership ?? null,
  };
}

// ---- E538: advise -----------------------------------------------------------------

const adviseRows = advisePanels().flatMap((p) =>
  existsSync(p.dir) ? dumpFiles(p.dir, p.prefix).map((file) => ({ panel: p, file })) : []
);
const adviseRecords = new Map<string, AdviseRecord[]>();

describe.skipIf(!process.env.LIVE_GEN || adviseRows.length === 0)('Coach eval: advise', () => {
  it.each(adviseRows)(
    '$panel.name $file',
    async ({ panel, file }) => {
      const dump = readJson<CoachDump>(join(panel.dir, file));
      const records = adviseRecords.get(panel.name) ?? [];
      adviseRecords.set(panel.name, records);
      const base = join(OUT, panel.name);
      writeJson(join(base, 'original', file), dump);
      const record: AdviseRecord = {
        panel: panel.name,
        deck: file.replace(/\.json$/, ''),
        applied: [],
        skipped: [],
        tiers: { t1: 0, t2: 0, t3: 0, cuts: 0, nbmCardMoves: 0 },
        highConfidence: 0,
        reversed: [],
        audit: [],
        priceBefore: 0,
        priceAfter: 0,
        bracketBefore: null,
        bracketAfter: null,
        appliedStapleCuts: [],
        selfReversed: [],
      };
      try {
        const deck = await generatedDeck(dump);
        const settings = settingsOf(dump);
        const pass1 = await coachPass(dump, deck);
        const audit = auditMoves(deck, pass1.moves, settings, pass1.env, AUDIT_K);
        const result = applyCoachMoves(deck, pass1.moves, settings, pass1.env, N);
        const pass2 = await coachPass(dump, result.deck);
        const audit2 = auditMoves(result.deck, pass2.moves, settings, pass2.env, AUDIT_K);

        const index = pass1.page ? buildInclusionIndex(pass1.page) : new Map<string, number>();
        // Complete combos and one-card near misses, the generator's own shape.
        const detected2 = [...pass2.combos.inDeck, ...pass2.combos.oneAway].map((m) => ({
          comboId: m.combo.id,
          cards: m.combo.cards.map((c) => c.cardName),
          results: m.combo.produces,
          isComplete: m.missingOracleIds.length === 0,
          missingCards: m.missingOracleIds,
          deckCount: m.combo.popularity,
          bracket: m.combo.bracket,
          bracketTag: m.combo.bracketTag ?? null,
          cardCount: m.combo.cardCount,
        }));
        const advised = advisedDump(dump, BY_NAME, result.deck, {
          applied: result.applied,
          skipped: result.skipped,
          inclusionOf: (name) => lookupInclusion(index, name) ?? null,
          resolve: cardFor,
          bracketEstimation: pass2.analysis.bracketEstimation,
          deckGrade: pass2.analysis.deckGrade ?? null,
          gapAnalysis: pass2.analysis.gapAnalysis ?? null,
          detectedCombos: detected2,
        });
        writeJson(join(base, 'advised', file), advised);

        // Ping-pong: the second pass wants an added card out, or a cut card back.
        const top2 = pass2.moves.slice(0, AUDIT_K);
        const addsBack = new Set(top2.filter((m) => m.type !== 'cut').map((m) => m.name));
        const outs2 = new Set([
          ...pass2.view.cuts.slice(0, AUDIT_K).map((r) => r.change.name),
          ...top2.filter((m) => m.type === 'swap' && m.outName).map((m) => m.outName!),
        ]);
        const promptCuts2 = new Set(audit2.map((a) => a.cut).filter((c): c is string => !!c));
        for (const a of result.applied) {
          if (a.added && outs2.has(a.added))
            record.reversed.push({ move: `+${a.added}`, how: 'second pass lists it as a cut' });
          else if (a.added && promptCuts2.has(a.added))
            record.reversed.push({ move: `+${a.added}`, how: IMPLICIT_REVERSAL });
          if (a.cut && addsBack.has(a.cut))
            record.reversed.push({ move: `-${a.cut}`, how: 'second pass suggests adding it back' });
        }

        const feedTiers = pass1.view.feed.map((r) => r.tier);
        const nbmCard = pass1.view.nbm.filter((m) => m.cardName);
        record.tiers = {
          t1: feedTiers.filter((t) => t === 1).length,
          t2: feedTiers.filter((t) => t === 2).length,
          t3: feedTiers.filter((t) => t === 3).length,
          cuts: pass1.view.cuts.length,
          nbmCardMoves: nbmCard.length,
        };
        record.highConfidence =
          record.tiers.t1 +
          record.tiers.t2 +
          nbmCard.filter(
            (m) => m.tier <= 2 && !pass1.view.feed.some((r) => r.change.name === m.cardName)
          ).length;
        record.applied = result.applied.map((a) => ({
          surface: a.move.surface,
          type: a.move.type,
          added: a.added,
          cut: a.cut,
          cutSource: a.cutSource,
        }));
        record.skipped = result.skipped.map((s) => ({
          surface: s.move.surface,
          violations: s.violations,
        }));
        record.audit = flagAudit(audit, pass1, deck);
        record.selfReversed = result.applied
          .filter((a, i) => a.cut && result.applied.slice(0, i).some((b) => b.added === a.cut))
          .map((a) => a.cut!);
        record.appliedStapleCuts = result.applied
          .map((a) => a.cut)
          .filter((c): c is string => !!c && isStaple(index, c));
        record.priceBefore = priceOf(deck.cards);
        record.priceAfter = priceOf(result.deck.cards);
        record.bracketBefore = pass1.analysis.bracketEstimation.bracket;
        record.bracketAfter = pass2.analysis.bracketEstimation.bracket;

        writeJson(join(base, 'coach', file), {
          deck: record.deck,
          settings: { ...settings, ownedNames: settings.ownedNames.size },
          nextBestMoves: pass1.view.nbm,
          moves: pass1.moves.map(moveRecord),
          cuts: pass1.view.cuts.map((r) => ({
            name: r.change.name,
            surface: cutSurface(r.change.id, r.change.lane, r.change.group),
            reason: r.change.reason ?? null,
            whyFactors: r.change.whyFactors ?? null,
            inclusion: r.change.inclusion ?? null,
          })),
          hiddenGems: pass1.view.hiddenGems,
          audit: record.audit,
          applied: result.applied,
          skipped: result.skipped,
          secondPass: {
            nextBestMoves: pass2.view.nbm,
            moves: pass2.moves.slice(0, 20).map(moveRecord),
            cuts: pass2.view.cuts.slice(0, 20).map((r) => r.change.name),
            audit: audit2.map((a) => ({ name: a.move.name, cut: a.cut ?? null })),
          },
          record,
        });
      } catch (err) {
        record.error = err instanceof Error ? err.message : String(err);
        console.error(`[coach-eval] ${panel.name}/${file} FAILED:`, err);
      } finally {
        releaseLock();
        records.push(record);
      }
      expect(true).toBe(true);
    },
    900_000
  );

  it('writes the advise report', () => {
    const md: string[] = [];
    for (const [panel, records] of adviseRecords) {
      const numbers = adviseNumbers(records);
      writeJson(join(OUT, panel, 'report.json'), { numbers, records, net: netStats });
      md.push(adviseMarkdown(panel, numbers));
    }
    writeFileSync(join(OUT, 'advise-report.md'), md.join('\n\n'));
    writeJson(join(OUT, 'missed-urls.json'), missedUrls);
    writeJson(join(OUT, 'bulk-misses.json'), [...bulkMisses]);
    console.log(`[coach-eval] advise:\n${md.join('\n\n')}\nnet ${JSON.stringify(netStats)}`);
  });
});

// ---- E539: benchmark ---------------------------------------------------------------

interface GateOutput {
  result: {
    scores: { deck: string; flaws: string[] }[];
    verdicts: { deck: string; payoffsLost: string[] }[];
  };
}

const benchRows = benchGates().flatMap((g) => {
  if (!existsSync(g.output)) return [];
  const out = readJson<GateOutput>(g.output).result;
  return out.scores
    .filter((s) => keep(s.deck) && existsSync(join(g.newDir, `${s.deck}.json`)))
    .map((s) => ({
      gate: g,
      deck: s.deck,
      flaws: s.flaws,
      payoffsLost: out.verdicts.find((v) => v.deck === s.deck)?.payoffsLost ?? [],
    }));
});
const benchRecords: BenchRecord[] = [];
let universeMatcherNames: string[] | null = null;

async function benchLists(dump: CoachDump, deck: EvalDeckState, pre: boolean) {
  (globalThis as { __coachEvalPreE510?: boolean }).__coachEvalPreE510 = pre;
  try {
    const settings = settingsOf(dump);
    const pass = await coachPass(dump, deck);
    const audit = auditMoves(deck, pass.moves, settings, pass.env, AUDIT_K);
    const applied = applyCoachMoves(deck, pass.moves, settings, pass.env, N);
    const strategy = pass.view.nbm.find((m) => m.id === 'strategy')?.cardName ?? null;
    return {
      pass,
      audit,
      lists: listsOf(
        pass,
        audit,
        applied.applied.map((a) => a.cut).filter((c): c is string => !!c)
      ),
      strategy,
    };
  } finally {
    (globalThis as { __coachEvalPreE510?: boolean }).__coachEvalPreE510 = false;
  }
}

describe.skipIf(!process.env.LIVE_GEN || benchRows.length === 0)('Coach eval: benchmark', () => {
  it.each(benchRows)(
    '$gate.name $deck',
    async ({ gate, deck: name, flaws, payoffsLost }) => {
      try {
        const dump = readJson<CoachDump>(join(gate.newDir, `${name}.json`));
        const baseFile = join(gate.baseDir, `${name}.json`);
        const base = existsSync(baseFile) ? readJson<CoachDump>(baseFile) : null;
        const deck = await generatedDeck(dump);
        const post = await benchLists(dump, deck, false);
        const pre = await benchLists(dump, deck, true);

        const flat = (d: CoachDump | null) =>
          d
            ? Object.values(d.decklist)
                .flat()
                .map((c) => c.name)
            : [];
        const pageNames = post.pass.page
          ? [...post.pass.page.cardlists.allNonLand, ...post.pass.page.cardlists.lands].map(
              (c) => c.name
            )
          : [];
        universeMatcherNames ??= UNIVERSE;
        const commanders = [dump.commander, ...(dump.partner ? [dump.partner] : [])];
        const matcher = buildNameMatcher(
          [...commanders, ...flat(dump), ...flat(base), ...pageNames, ...post.lists.universeAdds],
          universeMatcherNames
        );
        const labels = extractDeckLabels({
          deck: name,
          flaws,
          payoffsLost,
          newDeck: flat(dump),
          baseDeck: flat(base),
          commanders,
          matcher,
        });
        const record: BenchRecord = {
          gate: gate.name,
          deck: name,
          deckSize: deck.cards.length,
          labels: {
            weak: labels.weak,
            missing: labels.missing,
            lostPremium: labels.lostPremium,
            replacedBy: labels.replacedBy,
          },
          post: post.lists,
          pre: pre.lists,
          audit: flagAudit(post.audit, post.pass, deck),
          nbmStrategy: { post: post.strategy, pre: pre.strategy },
        };
        benchRecords.push(record);
        writeJson(join(OUT, 'benchmark', gate.name, `${name}.json`), {
          ...record,
          mentions: labels.mentions,
          moves: post.pass.moves.slice(0, 30).map(moveRecord),
        });
      } catch (err) {
        console.error(`[coach-eval] bench ${gate.name}/${name} FAILED:`, err);
        writeJson(join(OUT, 'benchmark', gate.name, `${name}.error.json`), {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        releaseLock();
      }
      expect(true).toBe(true);
    },
    900_000
  );

  it('writes the benchmark report', () => {
    const numbers = benchNumbers(benchRecords);
    const byGate: Record<string, ReturnType<typeof benchNumbers>> = {};
    for (const g of new Set(benchRecords.map((r) => r.gate))) {
      byGate[g] = benchNumbers(benchRecords.filter((r) => r.gate === g));
    }
    writeJson(join(OUT, 'benchmark', 'report.json'), { numbers, byGate, net: netStats });
    writeJson(join(OUT, 'missed-urls.json'), missedUrls);
    writeJson(join(OUT, 'bulk-misses.json'), [...bulkMisses]);
    const md = benchMarkdown(numbers);
    writeFileSync(join(OUT, 'benchmark', 'report.md'), md);
    console.log(
      `[coach-eval] benchmark over ${benchRecords.length} decks:\n${md}\nnet ${JSON.stringify(netStats)}`
    );
  });
});
