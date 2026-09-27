#!/usr/bin/env node
// Builds public/cube-signal-pauper.json and public/cube-signal-peasant.json —
// per-card cube popularity scoped to well-regarded pauper/peasant CubeCobra
// cubes, consumed by lib/cube/signal.ts's scoped load.
//
// WHY: refresh-cube-signal.mjs's all-cube signal is dominated by power/legacy/
// vintage cubes, so a pauper staple like Kor Skyfisher or Ninja of the Deep
// Hours ranks hundreds to thousands of places worse than it should when a
// pauper/peasant pool is built from it (design doc #5). There is no CubeCobra
// endpoint that scopes popularity to a named corpus (topcards' `f=` filter
// narrows by card properties across the WHOLE database, not by which cubes
// hold a tag), so per-corpus inclusion counting is the only correct approach:
// mirrors mine-cube-targets.mjs's corpus-fetch half (a `category:` search +
// a name-regex guard + a likes floor), not refresh-cube-signal.mjs's
// whole-database topcards walk.
//
// Corpus: top 20 public cubes each (>= MIN_LIKES, mainboard >= MIN_MAINBOARD —
// without that floor a "top-N by likes" cut let a 10-card novelty cube, "Pets
// Peasant Cube" at 52 likes, into the sample) for `category:Pauper` and
// `category:Peasant`, each additionally guarded by a /pauper/i or /peasant/i
// name check. The peasant corpus UNIONS in the pauper cubes — every pauper
// card is peasant-legal by definition, and peasant-tagged cubes alone
// under-sample pure-common picks (measured overlap was only ~30% before the
// union).
//
// Auto-invoked by predev; `prebuild` passes --no-fetch so a build keeps the
// committed snapshots and never touches the network. The weekly
// refresh-snapshots workflow re-runs it past MAX_AGE_DAYS.
//
// Output shape (kept tiny — fetched at cube-build time, not bundled):
//   { generatedAt, source, cards: { [name]: corpusPlaySharePct } }
//
// Flags:
//   --force     rebuild unconditionally, bypassing the age check and shrink guard
//   --no-fetch  keep the committed snapshots whatever their age; never touch
//               the network (ignored when --force is also passed)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SEARCH_URL = 'https://cubecobra.com/search/getmoresearchitems';
export const UA = 'spellcontrol-cube-miner (github.com/spellcontrol)';
export const MAX_AGE_DAYS = 30; // same cadence as refresh-cube-signal.mjs
export const PAGE_DELAY_MS = 700; // same pacing as mine-cube-targets.mjs / refresh-cube-signal.mjs
export const TARGET_PER_BAND = 20; // open question 1: revisit if the harness shows tie-heavy ordering hurts
export const MIN_LIKES = 10;
export const MIN_MAINBOARD = 100; // open question 5: drops joke/novelty lists (e.g. a 10-card "Pets Peasant Cube")
const MAX_SHRINK_RATIO = 0.2;

export const BANDS = {
  pauper: { query: 'category:Pauper', nameRe: /pauper/i },
  peasant: { query: 'category:Peasant', nameRe: /peasant/i },
};

const here = dirname(fileURLToPath(import.meta.url));
export const destOf = (band) => resolve(here, '..', 'public', `cube-signal-${band}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cubeJSONUrl = (id) => `https://cubecobra.com/cube/api/cubeJSON/${id}`;
export const cardName = (c) => c.details?.name ?? c.name ?? '';

// --- pure parts (unit-testable: no network) ---

/** Public, well-liked, name-matching candidates — the corpus's likes/name guard. */
export function filterCandidates(rawCubes, nameRe, minLikes = MIN_LIKES) {
  return rawCubes
    .filter((c) => c.visibility === 'pu' && (c.likeCount ?? 0) >= minLikes)
    .map((c) => ({ id: c.id, name: c.name ?? '', likes: c.likeCount ?? 0 }))
    .filter((c) => nameRe.test(c.name));
}

/** Drops any fetched cube under the mainboard-size floor — the joke-list guard. */
export function passesSizeFloor(mainboardLength, floor = MIN_MAINBOARD) {
  return mainboardLength >= floor;
}

/** Adds `own`'s cubes not already in `base` (by id) — the peasant-unions-pauper step. */
export function unionCubes(base, own) {
  const seen = new Set(base.map((c) => c.id));
  return [...base, ...own.filter((c) => !seen.has(c.id))];
}

/**
 * Per-card share of `cubes` (each `{ id, names: Set<string> }`) holding the
 * card, in percent — same convention as the all-cube signal's `cubePop`
 * (Lightning Bolt ≈ 26). Keys sorted for a stable, diffable snapshot.
 */
export function corpusInclusion(cubes) {
  const counts = new Map();
  for (const cube of cubes) for (const name of cube.names) counts.set(name, (counts.get(name) ?? 0) + 1);
  const total = cubes.length || 1;
  const cards = {};
  for (const name of [...counts.keys()].sort()) {
    cards[name] = +(((counts.get(name) ?? 0) / total) * 100).toFixed(2);
  }
  return cards;
}

// --- network I/O ---

async function listCandidateCubes(query) {
  const out = [];
  let lastKey = null;
  for (let page = 0; page < 5 && out.length < TARGET_PER_BAND * 3; page++) {
    const res = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ query, order: 'pop', ascending: false, lastKey }),
    });
    if (!res.ok) throw new Error(`search "${query}" page ${page}: HTTP ${res.status}`);
    const data = await res.json();
    out.push(...(data.cubes ?? []));
    lastKey = data.lastKey;
    if (!lastKey) break;
    await sleep(PAGE_DELAY_MS);
  }
  return out;
}

async function fetchCube(id) {
  const res = await fetch(cubeJSONUrl(id), { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`cubeJSON ${id}: HTTP ${res.status}`);
  return res.json();
}

/** Fetches up to TARGET_PER_BAND cubes for `band` past every guard. */
async function mineBand(band) {
  const { query, nameRe } = BANDS[band];
  const candidates = filterCandidates(await listCandidateCubes(query), nameRe);
  const out = [];
  for (const seed of candidates) {
    if (out.length >= TARGET_PER_BAND) break;
    try {
      const cube = await fetchCube(seed.id);
      const main = cube.cards?.mainboard ?? [];
      if (!passesSizeFloor(main.length)) {
        process.stderr.write(`  skip ${seed.name} (mainboard ${main.length} < ${MIN_MAINBOARD})\n`);
      } else {
        const names = new Set(main.map(cardName).filter(Boolean));
        out.push({ id: seed.id, name: seed.name, names });
        process.stderr.write(`  ✓ ${seed.name} (${main.length} cards, ${seed.likes} likes)\n`);
      }
    } catch (e) {
      process.stderr.write(`  ✗ ${seed.name}: ${e.message}\n`);
    }
    await sleep(PAGE_DELAY_MS);
  }
  return out;
}

async function readSnapshot(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function ageDays(snapshot) {
  const generatedAt = new Date(snapshot?.generatedAt).getTime();
  return Number.isFinite(generatedAt) ? (Date.now() - generatedAt) / 86_400_000 : Infinity;
}

async function main() {
  const force = process.argv.includes('--force');
  const noFetch = !force && process.argv.includes('--no-fetch');

  const prev = { pauper: await readSnapshot(destOf('pauper')), peasant: await readSnapshot(destOf('peasant')) };
  const age = Math.min(ageDays(prev.pauper), ageDays(prev.peasant));

  if (noFetch && Number.isFinite(age)) {
    console.log(`[cube-signal-budget] --no-fetch, keeping the committed snapshots (${age.toFixed(1)}d old)`);
    return;
  }
  if (!force && age < MAX_AGE_DAYS) {
    console.log(`[cube-signal-budget] snapshots are ${age.toFixed(1)}d old (< ${MAX_AGE_DAYS}d), skipping refresh`);
    return;
  }

  let out;
  try {
    console.log('[cube-signal-budget] Mining pauper corpus');
    const pauperCubes = await mineBand('pauper');
    console.log('[cube-signal-budget] Mining peasant corpus');
    const peasantOwn = await mineBand('peasant');
    const peasantCubes = unionCubes(peasantOwn, pauperCubes);

    const pauperCards = corpusInclusion(pauperCubes);
    const peasantCards = corpusInclusion(peasantCubes);

    for (const [band, cards] of [
      ['pauper', pauperCards],
      ['peasant', peasantCards],
    ]) {
      const before = Object.keys(prev[band]?.cards ?? {}).length;
      if (!force && before > 0 && Object.keys(cards).length < before * (1 - MAX_SHRINK_RATIO)) {
        throw new Error(
          `${band}: card pool collapsed ${before} → ${Object.keys(cards).length}; suspect a truncated fetch. Re-run with --force to write anyway.`
        );
      }
    }

    const generatedAt = new Date().toISOString();
    out = {
      pauper: {
        generatedAt,
        source: `CubeCobra ${SEARCH_URL} (category:Pauper, public cubes, >= ${MIN_LIKES} likes, >= ${MIN_MAINBOARD} mainboard); cards.value = % of the ${pauperCubes.length}-cube pauper corpus holding the card`,
        cards: pauperCards,
      },
      peasant: {
        generatedAt,
        source: `CubeCobra ${SEARCH_URL} (category:Peasant UNION category:Pauper, public cubes, >= ${MIN_LIKES} likes, >= ${MIN_MAINBOARD} mainboard); cards.value = % of the ${peasantCubes.length}-cube peasant+pauper corpus holding the card`,
        cards: peasantCards,
      },
    };
    console.log(
      `[cube-signal-budget] pauper: ${pauperCubes.length} cubes, ${Object.keys(pauperCards).length} cards`
    );
    console.log(
      `[cube-signal-budget] peasant: ${peasantCubes.length} cubes (${peasantOwn.length} tagged + ${peasantCubes.length - peasantOwn.length} unioned from pauper), ${Object.keys(peasantCards).length} cards`
    );
  } catch (err) {
    // A stale snapshot beats no snapshot: the committed copy is what ships.
    if (prev.pauper && prev.peasant) {
      console.warn(`[cube-signal-budget] Refresh failed (${err.message}), keeping existing snapshots`);
      return;
    }
    console.error(`[cube-signal-budget] Refresh failed and no local copy exists: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  await mkdir(dirname(destOf('pauper')), { recursive: true });
  await writeFile(destOf('pauper'), JSON.stringify(out.pauper));
  await writeFile(destOf('peasant'), JSON.stringify(out.peasant));
  console.log(`[cube-signal-budget] Wrote ${destOf('pauper')} and ${destOf('peasant')}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await main();
