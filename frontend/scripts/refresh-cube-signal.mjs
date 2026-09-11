#!/usr/bin/env node
// Builds cube-signal.json in public/ — a per-card CUBE power signal for the cube
// generator, so "good card" no longer means "played in Commander".
//
// WHY: EDHREC rank is Commander popularity. Ranked by it, a draft cube's
// colorless section fills with Command Tower, Arcane Signet and Commander's
// Sphere — cards that produce no mana outside Commander — and ramp lands at
// 12.6% of nonland against a corpus 8% (board E288). CubeCobra tracks how many
// of its ~400k cubes hold each card (`popularity`, a percentage) and a draft
// Elo from its pick data. Command Tower sits in 0 of the 80 popular draft cubes
// the target miner samples and ~4% of all cubes; Lightning Bolt in 26%. That is
// the signal a cube builder actually uses.
//
// SOURCE: CubeCobra's Top Cards API, `/tool/api/topcards`, paged over the whole
// card database (~33k cards, 96 per page, ~345 requests at the miner's pacing).
// The same per-card fields ride on every `cubeJSON` the target miner already
// reads, but that corpus covers only half of a real collection; the page walk
// covers every card CubeCobra knows.
//
// Auto-invoked by predev; `prebuild` passes --no-fetch so a build keeps the
// committed snapshot and never touches the network. The weekly
// refresh-snapshots workflow re-runs it past MAX_AGE_DAYS.
//
// Output shape (kept tiny — it is fetched at cube-build time, not bundled):
//   { generatedAt, source, cards: { [name]: [popularityPct, elo] } }
//
// Flags:
//   --force     rebuild unconditionally, bypassing the age check and shrink guard
//   --no-fetch  keep the committed snapshot whatever its age; never touch the
//               network (ignored when --force is also passed)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOPCARDS_URL = 'https://cubecobra.com/tool/api/topcards';
const UA = 'spellcontrol-cube-miner (github.com/spellcontrol)';
const MAX_AGE_DAYS = 30;
const PAGE_DELAY_MS = 700; // same pacing as mine-cube-targets.mjs
const MAX_RETRIES = 3;
const MAX_PAGES = 1000; // ~33k cards / 96 per page ≈ 345; a hard stop against a runaway walk
// Cards under this share of cubes carry no usable signal (and the generator
// treats "absent" as "unknown"), so leaving them out keeps the file small.
const MIN_POPULARITY_PCT = 0.05;
// A snapshot losing this much of its card pool means a truncated walk or an
// upstream shape change, not real churn. Refuse unless --force.
const MAX_SHRINK_RATIO = 0.2;

const force = process.argv.includes('--force');
const noFetch = !force && process.argv.includes('--no-fetch');
const here = dirname(fileURLToPath(import.meta.url));
const dest = resolve(here, '..', 'public', 'cube-signal.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readSnapshot(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function ageDays(snapshot) {
  // Age from the snapshot's own stamp, not file mtime (git checkout resets mtime).
  const generatedAt = new Date(snapshot?.generatedAt).getTime();
  return Number.isFinite(generatedAt) ? (Date.now() - generatedAt) / 86_400_000 : Infinity;
}

async function fetchPage(page) {
  const url = `${TOPCARDS_URL}?f=&s=Elo&d=descending&p=${page}`;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await sleep(PAGE_DELAY_MS);
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.ok) return res.json();
    if (attempt < MAX_RETRIES && (res.status === 429 || res.status >= 500)) {
      const backoff = 2 ** (attempt + 1) * 1000;
      console.warn(
        `[cube-signal]   page ${page}: HTTP ${res.status}, retrying in ${backoff / 1000}s`
      );
      await sleep(backoff);
      continue;
    }
    throw new Error(`page ${page}: HTTP ${res.status}`);
  }
  throw new Error(`page ${page}: exhausted retries`);
}

/** Walk every page; dedupe by name keeping the most-cubed row (reprints share a name). */
async function walk() {
  const cards = new Map();
  let expected = null;
  let seen = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await fetchPage(page);
    const rows = data?.data ?? [];
    expected ??= Number(data?.numResults) || null;
    for (const row of rows) {
      seen++;
      const name = row?.name;
      const popularity = Number(row?.popularity);
      const elo = Number(row?.elo);
      if (!name || !Number.isFinite(popularity) || !Number.isFinite(elo)) continue;
      if (popularity < MIN_POPULARITY_PCT) continue;
      const prev = cards.get(name);
      if (!prev || popularity > prev[0]) cards.set(name, [+popularity.toFixed(2), Math.round(elo)]);
    }
    if (page % 25 === 0)
      console.log(`[cube-signal]   page ${page}: ${seen}${expected ? `/${expected}` : ''} rows`);
    if (rows.length === 0 || (expected && seen >= expected)) break;
  }
  if (expected && seen < expected * 0.95) {
    throw new Error(`walk ended early: ${seen} of ${expected} rows`);
  }
  return cards;
}

const previous = await readSnapshot(dest);
const age = ageDays(previous);
if (noFetch && Number.isFinite(age)) {
  console.log(`[cube-signal] --no-fetch, keeping the committed snapshot (${age.toFixed(1)}d old)`);
  process.exit(0);
}
if (!force && age < MAX_AGE_DAYS) {
  console.log(
    `[cube-signal] ${dest} is ${age.toFixed(1)}d old (< ${MAX_AGE_DAYS}d), skipping refresh`
  );
  process.exit(0);
}

let payload;
try {
  console.log('[cube-signal] Walking CubeCobra top cards');
  const cards = await walk();
  const before = Object.keys(previous?.cards ?? {}).length;
  if (!force && before > 0 && cards.size < before * (1 - MAX_SHRINK_RATIO)) {
    throw new Error(
      `card pool collapsed ${before} → ${cards.size}; suspect a truncated walk. Re-run with --force to write anyway.`
    );
  }
  payload = {
    generatedAt: new Date().toISOString(),
    source: `CubeCobra ${TOPCARDS_URL} (whole database, sorted by Elo); popularity = % of CubeCobra cubes holding the card, elo = CubeCobra draft Elo; cards under ${MIN_POPULARITY_PCT}% omitted`,
    cards: Object.fromEntries(
      [...cards.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    ),
  };
  console.log(`[cube-signal] ${cards.size} cards`);
} catch (err) {
  // A stale snapshot beats no snapshot: the committed copy is what ships.
  if (previous) {
    console.warn(`[cube-signal] Refresh failed (${err.message}), keeping existing snapshot`);
    process.exit(0);
  }
  console.error(`[cube-signal] Refresh failed and no local copy exists: ${err.message}`);
  process.exit(1);
}

await mkdir(dirname(dest), { recursive: true });
await writeFile(dest, JSON.stringify(payload));
console.log(`[cube-signal] Wrote ${dest}`);
