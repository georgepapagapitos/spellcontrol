// Mine empirical cube-design targets from a corpus of well-regarded public
// CubeCobra cubes. Build-time only — NOT shipped or imported by the app.
//
// WHY this exists: every cube-building blog disagrees on the "right" ratios
// (color split, removal %, fixing count, curve). Those numbers fail
// cross-source verification. Real, popular cubes are the ground truth instead.
// This fetches the most-popular public cubes per size band from CubeCobra and
// derives the target distributions (median + p25/p75) the generator aims at.
//
// Reproducible: re-run `node frontend/scripts/mine-cube-targets.mjs` to refresh
// frontend/src/lib/cube/cube-targets.json. The corpus is whatever CubeCobra
// ranks most popular at run time — recorded in the output's provenance block.
//
// Role classification uses the SAME tagger-tags.json the runtime generator
// uses (frontend/public/tagger-tags.json), so corpus targets and owned-pool
// selection are classified identically.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const BANDS = [360, 450, 540, 720];
const TARGET_PER_BAND = 20; // top-N popular public cubes to sample per band
const MIN_LIKES = 10; // "well-regarded" floor — keeps the long tail of personal cubes out
const UA = 'spellcontrol-cube-miner (github.com/spellcontrol)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- tagger role classifier (mirror of frontend tagger getCardRole priority) ---
const tagger = JSON.parse(readFileSync(join(ROOT, 'public/tagger-tags.json'), 'utf8'));
const tagSet = {};
for (const [tag, names] of Object.entries(tagger.tags)) tagSet[tag] = new Set(names);
const has = (tag, name) => tagSet[tag]?.has(name) ?? false;
function cardRole(name) {
  if (has('boardwipe', name)) return 'boardwipe';
  if (has('removal', name) || has('spot-removal', name) || has('counterspell', name)) return 'removal';
  if (has('ramp', name) || has('cost-reducer', name) || has('mana-dork', name) || has('mana-rock', name))
    return 'ramp';
  if (has('card-advantage', name) || has('tutor', name) || has('draw', name) || has('wheel', name) || has('cantrip', name))
    return 'cardDraw';
  return null;
}
// A cube's "fixing" manabase is its nonbasic lands. CubeCobra keeps basics in a
// separate board, so mainboard lands are nonbasic by construction; we still
// exclude any "Basic Land" defensively. (The `mana-fix` tagger tag is too sparse
// — 52 mostly-nonland entries — to measure this.)
const isFixingLand = (typeLine) => /land/i.test(typeLine) && !/basic/i.test(typeLine);

// --- corpus fetch ---
async function listPopularCubes(size, want) {
  const out = [];
  let lastKey = null;
  for (let page = 0; page < 5 && out.length < want * 2; page++) {
    const res = await fetch('https://cubecobra.com/search/getmoresearchitems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ query: `cards=${size}`, order: 'pop', ascending: false, lastKey }),
    });
    if (!res.ok) throw new Error(`search ${size} page ${page}: HTTP ${res.status}`);
    const data = await res.json();
    for (const c of data.cubes ?? []) {
      if (c.visibility === 'pu' && (c.likeCount ?? 0) >= MIN_LIKES) {
        out.push({ id: c.id, name: c.name, likes: c.likeCount ?? 0, decks: c.numDecks ?? 0 });
      }
    }
    lastKey = data.lastKey;
    if (!lastKey) break;
    await sleep(700);
  }
  return out.slice(0, want);
}

async function fetchCube(id) {
  const res = await fetch(`https://cubecobra.com/cube/api/cubeJSON/${id}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`cubeJSON ${id}: HTTP ${res.status}`);
  return res.json();
}

// --- per-cube distribution ---
// CubeCobra cards carry the canonical Scryfall fields under `details` (always
// present — it's the oracle join); the top-level type_line/cmc/colors are
// user-overridable and absent on many cubes. Read details-first.
const cardName = (c) => c.details?.name ?? c.name ?? '';
const cardType = (c) => (c.details?.type_line ?? c.details?.type ?? c.type_line ?? '').toLowerCase();
const cardCmc = (c) => Number(c.details?.cmc ?? c.cmc ?? 0) || 0;
const cardColors = (c) => c.details?.colors ?? c.colors ?? [];
function colorBucket(c) {
  if (cardType(c).includes('land')) return 'land';
  const colors = cardColors(c);
  if (colors.length === 0) return 'colorless';
  if (colors.length > 1) return 'multicolor';
  return colors[0]; // W/U/B/R/G
}
function distribution(cube) {
  const cards = (cube.cards?.mainboard || []).filter((c) => cardName(c));
  const n = cards.length || 1;
  const nonland = cards.filter((c) => !cardType(c).includes('land'));
  const nn = nonland.length || 1;

  const color = { W: 0, U: 0, B: 0, R: 0, G: 0, multicolor: 0, colorless: 0, land: 0 };
  for (const c of cards) color[colorBucket(c)]++;
  for (const k in color) color[k] /= n;

  const curve = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  for (const c of nonland) curve[Math.min(7, Math.max(0, Math.round(cardCmc(c))))]++;
  for (const k in curve) curve[k] /= nn;

  const TYPES = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle'];
  const type = Object.fromEntries(TYPES.map((t) => [t, 0]));
  for (const c of cards) {
    const t = cardType(c);
    const hit = TYPES.find((x) => t.includes(x));
    if (hit) type[hit]++;
  }
  for (const k in type) type[k] /= n;

  const role = { removal: 0, boardwipe: 0, ramp: 0, cardDraw: 0 };
  for (const c of nonland) {
    const r = cardRole(cardName(c));
    if (r) role[r]++;
  }
  for (const k in role) role[k] /= nn;

  const fixingLands = cards.filter((c) => isFixingLand(cardType(c))).length;

  return { color, curve, type, role, fixingLands };
}

// --- aggregate: median + p25/p75 across cubes ---
const quantile = (sorted, q) => {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
function agg(values) {
  const s = [...values].sort((a, b) => a - b);
  return {
    median: +quantile(s, 0.5).toFixed(4),
    p25: +quantile(s, 0.25).toFixed(4),
    p75: +quantile(s, 0.75).toFixed(4),
  };
}
function aggregateBand(dists) {
  const pick = (path) => dists.map((d) => path.split('.').reduce((o, k) => o[k], d));
  const aggGroup = (group) => Object.fromEntries(Object.keys(dists[0][group]).map((k) => [k, agg(pick(`${group}.${k}`))]));
  return {
    color: aggGroup('color'),
    curve: aggGroup('curve'),
    type: aggGroup('type'),
    role: aggGroup('role'),
    fixingLands: agg(dists.map((d) => d.fixingLands)),
  };
}

// --- main ---
const bands = {};
const provBands = {};
for (const size of BANDS) {
  process.stderr.write(`\n[band ${size}] listing popular public cubes…\n`);
  const seeds = await listPopularCubes(size, TARGET_PER_BAND);
  process.stderr.write(`  ${seeds.length} cubes >= ${MIN_LIKES} likes\n`);
  const dists = [];
  const used = [];
  for (const seed of seeds) {
    try {
      const cube = await fetchCube(seed.id);
      const main = cube.cards?.mainboard || [];
      if (main.length < size * 0.8) {
        process.stderr.write(`  skip ${seed.name} (mainboard ${main.length})\n`);
        continue;
      }
      dists.push(distribution(cube));
      used.push(seed);
      process.stderr.write(`  ✓ ${seed.name} (${main.length} cards, ${seed.likes} likes)\n`);
    } catch (e) {
      process.stderr.write(`  ✗ ${seed.name}: ${e.message}\n`);
    }
    await sleep(700);
  }
  if (dists.length < 5) {
    process.stderr.write(`  ⚠ only ${dists.length} cubes for band ${size} — targets may be noisy\n`);
  }
  const band = { size, n: dists.length, ...aggregateBand(dists) };
  // Guard against the silent-garbage failure mode (e.g. a card-shape change
  // upstream zeroing every distribution). Every real cube has creatures and
  // lands — a ~0 median here means classification broke, not that cubes lack them.
  if (band.type.creature.median < 0.1 || band.type.land.median < 0.05) {
    throw new Error(
      `band ${size}: implausible targets (creature ${band.type.creature.median}, land ${band.type.land.median}) — card parsing likely broke`
    );
  }
  bands[String(size)] = band;
  provBands[String(size)] = { n: used.length, cubes: used };
}

const output = {
  $schema: 'derived — do not hand-edit; regenerate via frontend/scripts/mine-cube-targets.mjs',
  provenance: {
    generatedAt: new Date().toISOString(),
    source: 'CubeCobra /search/getmoresearchitems (order=pop, public cubes); cube cards via /cube/api/cubeJSON/:id',
    method: `top ${TARGET_PER_BAND} popularity-ranked public cubes per size band with >= ${MIN_LIKES} likes`,
    taggerGeneratedAt: tagger.generatedAt,
    bands: provBands,
  },
  bands,
};
const outPath = join(ROOT, 'src/lib/cube/cube-targets.json');
writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
process.stderr.write(`\nWrote ${outPath}\n`);
