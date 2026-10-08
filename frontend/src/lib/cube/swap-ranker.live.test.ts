// LIVE graded benchmark (E583): does E517's substitute ranker beat
// `swapCandidates` for cube swaps? Gated behind LIVE_CUBE_POOL like
// generate.live.test.ts, so a normal `npm test` never runs it.
//
//   cd frontend && LIVE_CUBE_POOL=C:/path/cube-pool.json \
//     ./node_modules/.bin/vitest run src/lib/cube/swap-ranker.live.test.ts
//
// Modes (LIVE_CUBE_BENCH):
//   unset / "score"  grade both rankers' top 5 against swap-ranker.judgments.json
//                    and print nDCG@5 and mean grade@1, per role and overall.
//   "dump"           write the BLIND grading sheet (slot + shuffled candidates +
//                    real oracle text, no source) and the source key to
//                    LIVE_CUBE_OUTDIR. Grade the sheet, then re-run in score mode.
//
// Fixture rubric (grade each candidate as a replacement for the slot's card,
// from the card's real oracle text, blind to which ranker proposed it):
//   3  a cube designer would take it as the direct replacement: same job at
//      the same strength and a similar cost, in the same color
//   2  a good replacement: same job, noticeably weaker or stronger, or a
//      different cost, or the same job through a different mechanism
//   1  playable in the slot but changes the role (a different job, a card
//      that only loosely fills the position)
//   0  does not belong in the slot
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import type { EnrichedCard } from '@/types';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import { ensureCardTags } from '@/lib/cards/card-tags';
import { setCardFactsSnapshot, getCardFacts } from '@/deck-builder/services/cardFacts';
import type { Snapshot } from '@/deck-builder/services/cardFacts/codec';
import { loadCardSimilar } from '@/deck-builder/services/deckBuilder/cardSimilar';
import { RUNTIME_SOURCES } from '@/deck-builder/services/substitutes';
import { roleForTaggerRole } from '@/deck-builder/services/substitutes/surfaces';
import { scoreSubstitute } from '@/deck-builder/services/substitutes/ranker';
import { loadCubeSignal } from './signal';
import { bucketOf, curveSlotOf, isLand, pairsFixedBy } from './core';
import { byQuality, generateCube, type CubeCard, type GeneratedCube, type Pick } from './generate';
import { filterPool, DEFAULT_POOL_FILTERS } from './pool-filters';
import { namesToCubePool } from './pool';
import type { OracleFacts } from './oracle';
import { swapCandidates } from './swap';

const here = dirname(fileURLToPath(import.meta.url));
const POOL_PATH = process.env.LIVE_CUBE_POOL;
const MODE = process.env.LIVE_CUBE_BENCH ?? 'score';
const OUT_DIR = process.env.LIVE_CUBE_OUTDIR ?? join(tmpdir(), 'spellcontrol-live-cube');
const FIXTURE = join(here, 'swap-ranker.judgments.json');
const TOP = 5;

/** The roles the benchmark reports on, with how many slots each gets. */
const SLOT_PLAN = [
  { role: 'removal', n: 5 },
  { role: 'creature-1', n: 2 },
  { role: 'creature-2', n: 2 },
  { role: 'creature-3', n: 2 },
  { role: 'creature-4', n: 2 },
  { role: 'creature-5+', n: 2 },
  { role: 'gold', n: 4 },
  { role: 'fixing-land', n: 4 },
  { role: 'payoff', n: 4 },
  { role: 'ramp', n: 3 },
  { role: 'card-draw', n: 3 },
] as const;
type SlotRole = (typeof SLOT_PLAN)[number]['role'];

const hash = (s: string) => createHash('sha1').update(s).digest('hex');
const isCreature = (c: CubeCard) => /\bcreature\b/i.test(c.typeLine);

function roleOf(p: Pick): SlotRole[] {
  const c = p.card;
  const out: SlotRole[] = [];
  if (c.role === 'removal') out.push('removal');
  if (c.role === 'ramp' && !isLand(c)) out.push('ramp');
  if (c.role === 'cardDraw') out.push('card-draw');
  if (isLand(c) && pairsFixedBy(c).length > 0) out.push('fixing-land');
  if (p.bucket === 'multicolor' && !isLand(c)) out.push('gold');
  if (!c.role && (c.synergyPayoffs?.length ?? 0) > 0 && !isLand(c)) out.push('payoff');
  if (!c.role && isCreature(c) && !isLand(c)) {
    const slot = Number(curveSlotOf(c.cmc));
    out.push(slot >= 5 ? 'creature-5+' : (`creature-${slot}` as SlotRole));
  }
  return out;
}

/** Deterministic spread over the cube: sort by hash, take the first n not already used. */
function chooseSlots(cube: GeneratedCube): { role: SlotRole; index: number }[] {
  const used = new Set<number>();
  const chosen: { role: SlotRole; index: number }[] = [];
  for (const { role, n } of SLOT_PLAN) {
    const pool = cube.picks
      .map((p, index) => ({ p, index }))
      .filter(({ p, index }) => !used.has(index) && roleOf(p).includes(role))
      .sort((a, b) => hash(a.p.card.name).localeCompare(hash(b.p.card.name)));
    for (const { index } of pool.slice(0, n)) {
      used.add(index);
      chosen.push({ role, index });
    }
  }
  return chosen;
}

/** E517's ranker over the cube's candidate notion: same bucket, owned, not in the cube, not banned. */
function rankerCandidates(cube: GeneratedCube, index: number, pool: CubeCard[], n: number) {
  const target = cube.picks[index];
  const inCube = new Set(cube.picks.map((p) => p.card.oracleId));
  const q = getCardFacts(target.card.name);
  if (!q) return null;
  const role = target.card.role ? roleForTaggerRole(q, target.card.role) : undefined;
  const scored: { card: CubeCard; score: number }[] = [];
  for (const c of pool) {
    if (inCube.has(c.oracleId) || bucketOf(c) !== target.bucket) continue;
    const f = getCardFacts(c.name);
    if (!f) continue;
    scored.push({
      card: c,
      score: scoreSubstitute(q, f, RUNTIME_SOURCES, { role, deck: null }).score,
    });
  }
  scored.sort((a, b) => b.score - a.score || byQuality(a.card, b.card));
  return scored.slice(0, n).map((s) => s.card);
}

const key = (slot: string, cand: string) => `${slot}::${cand}`;

function dcg(grades: number[]): number {
  return grades.reduce((s, g, i) => s + (2 ** g - 1) / Math.log2(i + 2), 0);
}
/** nDCG@5 against the best five graded candidates of the slot's union. */
function ndcg(grades: number[], ideal: number[]): number {
  const best = dcg([...ideal].sort((a, b) => b - a).slice(0, TOP));
  return best === 0 ? 0 : dcg(grades) / best;
}

describe.skipIf(!POOL_PATH)('cube swap candidates vs the E517 ranker (graded, live)', () => {
  let pool: CubeCard[];
  let cube: GeneratedCube;
  let facts: Map<string, OracleFacts>;

  beforeAll(async () => {
    const pub = (f: string) => resolve(here, '..', '..', '..', 'public', f);
    const json = (f: string) => JSON.parse(readFileSync(pub(f), 'utf8')) as unknown;
    const bodies: Record<string, unknown> = {
      '/tagger-tags.json': json('tagger-tags.json'),
      '/cube-signal.json': json('cube-signal.json'),
      '/otag-index.json': json('otag-index.json'),
      '/card-similar.json': json('card-similar.json'),
    };
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const hit = Object.keys(bodies).find((k) => url.endsWith(k));
      if (!hit) throw new Error(`[swap-bench] unexpected fetch ${url}`);
      return { ok: true, status: 200, json: async () => bodies[hit] } as Response;
    });
    await Promise.all([loadTaggerData(), loadCubeSignal(), ensureCardTags(), loadCardSimilar()]);
    setCardFactsSnapshot(json('card-facts.json') as Snapshot);
    const file = JSON.parse(readFileSync(resolve(POOL_PATH!), 'utf8')) as {
      cards: EnrichedCard[];
      facts: OracleFacts[];
    };
    facts = new Map(file.facts.map((f) => [f.name, f]));
    const collection = file.cards.flatMap((c) => {
      const copies = Math.max(1, (c as unknown as { copies?: number }).copies ?? 1);
      return Array.from({ length: copies }, (_, i) => ({ ...c, copyId: `${c.name}#${i}` }));
    });
    const allNames = new Set(file.cards.map((c) => c.name));
    pool = namesToCubePool(
      filterPool(collection, allNames, DEFAULT_POOL_FILTERS).names,
      file.cards,
      facts
    );
    cube = generateCube(pool, 360, { synergyLevel: 0.5 });
  });

  afterAll(() => vi.unstubAllGlobals());

  it('picks a spread of slots and ranks both ways', () => {
    const slots = chooseSlots(cube);
    expect(slots.length).toBeGreaterThanOrEqual(30);

    const rows = slots.map(({ role, index }) => {
      const slotName = cube.picks[index].card.name;
      const current = swapCandidates(cube, index, pool, { n: TOP }).map((s) => s.card);
      const v2 = rankerCandidates(cube, index, pool, TOP) ?? [];
      return { role, slotName, index, current, v2 };
    });

    if (MODE === 'dump') {
      mkdirSync(OUT_DIR, { recursive: true });
      const text = (name: string) => facts.get(name)?.oracle_text ?? '';
      const sheet = rows.map((r) => {
        const names = [...new Set([...r.current, ...r.v2].map((c) => c.name))].sort((a, b) =>
          hash(r.slotName + a).localeCompare(hash(r.slotName + b))
        );
        const slotCard = cube.picks[r.index].card;
        return {
          slot: r.slotName,
          slotType: slotCard.typeLine,
          slotCmc: slotCard.cmc,
          slotText: text(r.slotName),
          candidates: names.map((n) => {
            const c = pool.find((x) => x.name === n)!;
            return { name: n, type: c.typeLine, cmc: c.cmc, text: text(n) };
          }),
        };
      });
      const sourceKey = rows.map((r) => ({
        slot: r.slotName,
        role: r.role,
        current: r.current.map((c) => c.name),
        v2: r.v2.map((c) => c.name),
      }));
      writeFileSync(join(OUT_DIR, 'swap-sheet.json'), JSON.stringify(sheet, null, 1));
      writeFileSync(join(OUT_DIR, 'swap-source-key.json'), JSON.stringify(sourceKey, null, 1));
      console.log(`[swap-bench] wrote the blind sheet and the source key to ${OUT_DIR}`);
      return;
    }

    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
      grades: Record<string, number>;
    };
    const missing: string[] = [];
    const gradeOf = (slot: string, c: CubeCard) => {
      const g = fixture.grades[key(slot, c.name)];
      if (g === undefined) missing.push(key(slot, c.name));
      return g ?? 0;
    };
    type Acc = { cur: number[]; v2: number[]; cur1: number[]; v21: number[] };
    const byRole = new Map<string, Acc>();
    const all: Acc = { cur: [], v2: [], cur1: [], v21: [] };
    for (const r of rows) {
      const cg = r.current.map((c) => gradeOf(r.slotName, c));
      const vg = r.v2.map((c) => gradeOf(r.slotName, c));
      const ideal = [...new Set([...r.current, ...r.v2].map((c) => c.name))].map(
        (n) => fixture.grades[key(r.slotName, n)] ?? 0
      );
      const acc = byRole.get(r.role) ?? { cur: [], v2: [], cur1: [], v21: [] };
      for (const a of [acc, all]) {
        a.cur.push(ndcg(cg, ideal));
        a.v2.push(ndcg(vg, ideal));
        a.cur1.push(cg[0] ?? 0);
        a.v21.push(vg[0] ?? 0);
      }
      byRole.set(r.role, acc);
    }
    expect(missing).toEqual([]);
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
    const line = (name: string, a: Acc) =>
      `${name.padEnd(14)} n=${String(a.cur.length).padEnd(3)} ` +
      `nDCG@5 current ${mean(a.cur).toFixed(3)} e517 ${mean(a.v2).toFixed(3)}  ` +
      `grade@1 current ${mean(a.cur1).toFixed(2)} e517 ${mean(a.v21).toFixed(2)}`;
    console.log([...byRole].map(([r, a]) => line(r, a)).join('\n') + '\n' + line('OVERALL', all));
  });
});
