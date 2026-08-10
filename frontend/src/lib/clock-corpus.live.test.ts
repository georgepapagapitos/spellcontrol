// LIVE-DATA eval harness for the assembly / kill-turn clock (#1534).
//
// Pulls REAL average decklists from EDHREC for a spread of commanders, resolves
// every card against the real Scryfall API, runs the production analysis path
// (analyzeCommanderDeck → bracket + win conditions), then runs the clock over
// the result. Dumps a per-deck JSON + a summary table for offline reading.
//
//   cd frontend && NODE_ENV=production CLOCK_EVAL=1 ./node_modules/.bin/vitest run \
//     --mode production src/lib/clock-corpus.live.test.ts
//
// --mode production AND NODE_ENV=production are required for the same reason as
// deckGenerator.live.test.ts: BASE_URL is `import.meta.env.DEV ? <dev proxy> :
// <real API>`, and a preset NODE_ENV leaves DEV=true → relative URLs → every
// fetch throws "Failed to parse URL".
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import type { DetectedCombo, ScryfallCard } from '@/deck-builder/types';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.CLOCK_EVAL_OUTDIR ?? join(tmpdir(), 'spellcontrol-clock-eval');
const ENABLED = process.env.CLOCK_EVAL === '1';

/**
 * Commanders spanning the power spectrum, by reputation — this is the anchor
 * the whole eval leans on, since no real kill-turn ground truth exists. Each
 * entry's `expect` is the community's rough read on how fast the deck ends
 * games, NOT anything the engine computes.
 */
const CORPUS: Array<{ name: string; tier: 'casual' | 'mid' | 'high' | 'cedh' }> = [
  { name: 'Lathril, Blade of the Elves', tier: 'casual' },
  { name: 'Miirym, Sentinel Wyrm', tier: 'casual' },
  { name: 'Atraxa, Praetors’ Voice', tier: 'casual' },
  { name: 'Sliver Overlord', tier: 'casual' },
  { name: 'Ghired, Conclave Exile', tier: 'casual' },
  { name: 'Meren of Clan Nel Toth', tier: 'mid' },
  { name: 'Korvold, Fae-Cursed King', tier: 'mid' },
  { name: 'Muldrotha, the Gravetide', tier: 'mid' },
  { name: 'Edgar Markov', tier: 'mid' },
  { name: 'Prosper, Tome-Bound', tier: 'mid' },
  { name: 'Krenko, Mob Boss', tier: 'mid' },
  { name: 'Yuriko, the Tiger’s Shadow', tier: 'high' },
  { name: 'Winota, Joiner of Forces', tier: 'high' },
  { name: 'Kaalia of the Vast', tier: 'high' },
  { name: 'Tergrid, God of Fright', tier: 'high' },
  { name: 'Godo, Bandit Warlord', tier: 'high' },
  { name: 'Kinnan, Bonder Prodigy', tier: 'cedh' },
  { name: 'Najeela, the Blade-Blossom', tier: 'cedh' },
  { name: 'Urza, Lord High Artificer', tier: 'cedh' },
  { name: 'Tivit, Seller of Secrets', tier: 'cedh' },
];

interface Row {
  commander: string;
  tier: string;
  deckSize: number;
  lands: number;
  ramp: number;
  cardDraw: number;
  tutors: number;
  avgCmc: number;
  bracket: number | null;
  softScore: number | null;
  winCon: string | null;
  category: string | null;
  killClock: boolean;
  assemblyOptions: number | null;
  median: number | null;
  p90: number | null;
  completeCombos: number;
  comboSample: string[];
  primaryScore: number | null;
  secondary: string[];
  assemblySample: Array<{ names: string[]; need: number; presentInLib: number }>;
  note?: string;
}

let realFetch: typeof fetch;

describe.skipIf(!ENABLED)('assembly clock — live corpus eval', () => {
  beforeAll(async () => {
    mkdirSync(OUT_DIR, { recursive: true });
    const taggerData = JSON.parse(
      readFileSync(resolve(here, '..', '..', 'public', 'tagger-tags.json'), 'utf8')
    );
    const cardSimilarData = JSON.parse(
      readFileSync(resolve(here, '..', '..', 'public', 'card-similar.json'), 'utf8')
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
        'User-Agent': 'SpellControl-ClockEvalHarness/1.0',
      };
      return realFetch(input, { ...init, headers });
    });
  }, 120_000);

  afterAll(() => vi.unstubAllGlobals());

  it(
    'runs the clock over real EDHREC average decks',
    async () => {
      const { getCardsByNames, getGameChangerNames } =
        await import('@/deck-builder/services/scryfall/client');
      const { fetchCommanderCombos } = await import('@/deck-builder/services/edhrec/client');
      const { analyzeCommanderDeck } =
        await import('@/deck-builder/services/deckBuilder/commanderDeckAnalysis');
      const { simulateAssemblyClock } = await import('./opening-hand-sim');
      const { toClockCard } = await import('./hand-classify');
      const { getCardRole } = await import('@/deck-builder/services/tagger/client');
      const { isKillClock } = await import('@/components/deck/WinConditionPanel');

      await getGameChangerNames();
      const rows: Row[] = [];

      for (const entry of CORPUS) {
        const row: Row = {
          commander: entry.name,
          tier: entry.tier,
          deckSize: 0,
          lands: 0,
          ramp: 0,
          cardDraw: 0,
          tutors: 0,
          avgCmc: 0,
          bracket: null,
          softScore: null,
          winCon: null,
          category: null,
          killClock: false,
          assemblyOptions: null,
          median: null,
          p90: null,
          completeCombos: 0,
          comboSample: [],
          primaryScore: null,
          secondary: [],
          assemblySample: [],
        };
        try {
          // 1. Real average decklist from EDHREC ("N CardName" entries).
          const slug = entry.name
            .toLowerCase()
            .replace(/[',’.]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
          const res = await realFetch(`https://json.edhrec.com/pages/average-decks/${slug}.json`, {
            headers: { 'User-Agent': 'SpellControl-ClockEvalHarness/1.0' },
          });
          if (!res.ok) {
            row.note = `average-deck fetch ${res.status}`;
            rows.push(row);
            continue;
          }
          // Live shape (2026-08): { deck: { commander: string[],
          // cards: { <TypeLine>: [[name, qty], …] } } } — NOT the flat
          // ["1 Sol Ring"] array `fetchAverageDeckMultiCopies` still expects.
          const data = (await res.json()) as {
            deck?: { commander?: string[]; cards?: Record<string, Array<[string, number]>> };
          };
          const names: string[] = [];
          for (const group of Object.values(data.deck?.cards ?? {})) {
            for (const [name, qty] of group) {
              for (let i = 0; i < (qty || 1); i++) names.push(name.trim());
            }
          }
          if (names.length === 0) {
            row.note = 'empty average deck';
            rows.push(row);
            continue;
          }

          // 2. Resolve every card for real (batched inside the client).
          //    EDHREC keeps the commander OUT of `cards` (it's in
          //    `deck.commander`), and its own spelling is the one Scryfall
          //    accepts — the corpus list here uses curly apostrophes.
          const commanderName = data.deck?.commander?.[0] ?? entry.name;
          const uniqueNames = Array.from(new Set([...names, commanderName]));
          const byName = await getCardsByNames(uniqueNames);
          const commanderCard =
            byName.get(commanderName) ?? (await resolveOne(commanderName, byName));
          if (!commanderCard) {
            row.note = 'commander unresolved';
            rows.push(row);
            continue;
          }
          const cards: ScryfallCard[] = [];
          for (const n of names) {
            if (n === commanderName) continue; // command zone
            const c = byName.get(n);
            if (c) cards.push(c);
          }
          row.deckSize = cards.length;

          // 3. Real combos for this commander, marked complete when the deck
          //    holds every piece (commander counts — it's always available).
          const inDeck = new Set(cards.map((c) => c.name));
          inDeck.add(commanderName);
          const edhrecCombos = await fetchCommanderCombos(commanderName);
          const detectedCombos: DetectedCombo[] = edhrecCombos.map((c) => {
            const cardNames = c.cards.map((cc) => cc.name);
            const missing = cardNames.filter((n) => !inDeck.has(n));
            return {
              comboId: c.comboId,
              cards: cardNames,
              results: c.results,
              isComplete: missing.length === 0,
              missingCards: missing,
              deckCount: c.deckCount,
              bracket: c.bracket,
              bracketTag: c.bracketTag,
              cardCount: c.cardCount,
            };
          });

          // 4. The production analysis path.
          // CONTRACT: analyzeCommanderDeck/detectWinConditions expect
          // combos ALREADY IN THE DECK (production feeds
          // comboMatchesToDetected(resp.inDeck), every entry isComplete).
          // The detector does NOT re-check isComplete, so passing EDHREC's
          // full combo page for the commander makes it build win paths from
          // cards the deck never runs.
          const inDeckCombos = detectedCombos.filter((c) => c.isComplete);
          const analysis = await analyzeCommanderDeck({
            commander: commanderCard,
            cards,
            deckSize: 99,
            colorIdentity: commanderCard.color_identity ?? [],
            detectedCombos: inDeckCombos,
          });
          if (!analysis) {
            row.note = 'analyzeCommanderDeck returned null';
            rows.push(row);
            continue;
          }
          row.completeCombos = detectedCombos.filter((c) => c.isComplete).length;
          row.comboSample = detectedCombos
            .filter((c) => c.isComplete)
            .slice(0, 3)
            .map((c) => c.cards.join(' + '));
          row.bracket = analysis.bracketEstimation?.bracket ?? null;
          row.softScore = analysis.bracketEstimation?.softScore ?? null;

          const clockCards = cards.map(toClockCard);
          row.lands = clockCards.filter((c) => c.isLand).length;
          row.ramp = clockCards.filter((c) => !c.isLand && c.role === 'ramp').length;
          row.cardDraw = clockCards.filter((c) => !c.isLand && c.role === 'cardDraw').length;
          row.avgCmc =
            Math.round(
              (clockCards.filter((c) => !c.isLand).reduce((s, c) => s + c.cmc, 0) /
                Math.max(1, clockCards.filter((c) => !c.isLand).length)) *
                100
            ) / 100;

          const wc = analysis.winConditions;
          row.tutors = wc?.tutors?.length ?? 0;
          const primary = wc?.primary ?? null;
          row.winCon = primary?.label ?? null;
          row.category = primary?.category ?? null;
          row.killClock = !!primary && isKillClock(primary.category);
          row.assemblyOptions = primary?.assembly?.length ?? null;
          row.primaryScore = primary?.score ?? null;
          row.secondary = (wc?.secondary ?? []).map((w) => `${w.category}:${w.score}`);
          const libNames = new Set(cards.map((c) => c.name));
          row.assemblySample = (primary?.assembly ?? []).slice(0, 4).map((o) => ({
            names: o.names.slice(0, 6),
            need: o.need,
            presentInLib: o.names.filter((n) => libNames.has(n)).length,
          }));

          if (primary?.assembly?.length) {
            const clock = simulateAssemblyClock(clockCards, primary.assembly, {
              iterations: 2000,
              seed: 99,
              wildcards: wc?.tutors,
            });
            row.median = clock?.typicalTurn ?? null;
            row.p90 = clock?.p90Turn ?? null;
            if (!clock) row.note = 'clock null (pieces absent from library)';
          } else {
            row.note = primary ? 'no assembly (generic combat)' : 'no primary win condition';
          }
          // Keep the tagger role fn referenced so an unused-import lint can't
          // silently drop the role data this whole eval depends on.
          void getCardRole;
        } catch (err) {
          row.note = `error: ${(err as Error).message}`;
        }
        rows.push(row);
        writeFileSync(join(OUT_DIR, 'rows.json'), JSON.stringify(rows, null, 2));
      }

      const table = [
        [
          'commander',
          'tier',
          'brkt',
          'soft',
          'category',
          'kill',
          'median',
          'p90',
          'lands',
          'ramp',
          'draw',
          'tutors',
          'avgCmc',
          'note',
        ].join('\t'),
        ...rows.map((r) =>
          [
            r.commander,
            r.tier,
            r.bracket ?? '-',
            r.softScore ?? '-',
            r.category ?? '-',
            r.killClock ? 'KILL' : '-',
            r.median ?? '-',
            r.p90 ?? '-',
            r.lands,
            r.ramp,
            r.cardDraw,
            r.tutors,
            r.avgCmc,
            r.note ?? '',
          ].join('\t')
        ),
      ].join('\n');
      writeFileSync(join(OUT_DIR, 'summary.tsv'), table);
      writeFileSync(join(OUT_DIR, 'rows.json'), JSON.stringify(rows, null, 2));
      expect(rows.length).toBe(CORPUS.length);
    },
    30 * 60_000
  );
});

async function resolveOne(
  name: string,
  byName: Map<string, ScryfallCard>
): Promise<ScryfallCard | undefined> {
  // EDHREC and Scryfall disagree on apostrophes for some names.
  for (const [k, v] of byName) {
    if (k.replace(/[’']/g, "'") === name.replace(/[’']/g, "'")) return v;
  }
  return undefined;
}
