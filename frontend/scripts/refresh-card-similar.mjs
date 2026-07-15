#!/usr/bin/env node
// Builds public/card-similar.json — the data-driven substitute index: for each
// staple, EDHREC's per-card `similar` list (its own deck-co-occurrence answer to
// "what replaces this card", from millions of real decks). The substitute finder
// consults this as the PRIMARY ranking signal, falling back to its heuristic for
// cards not indexed (see substituteFinder.ts).
//
// Strategy: breadth-first walk of EDHREC's similarity graph, seeded from the
// top-100 most-played cards (popular-first), capped — so the index holds the
// staple core that actually shows up as "missing staples" in gap analysis.
//
//   node scripts/refresh-card-similar.mjs            # respects MAX_AGE_DAYS cache
//   node scripts/refresh-card-similar.mjs --force    # re-fetch unconditionally
//
// Network, run periodically; the emitted JSON is committed and ships offline
// (mirrors tagger-tags.json). NOT wired into predev/prebuild — it scrapes
// hundreds of EDHREC pages, too heavy for every build.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DEST = resolve(here, '..', 'public', 'card-similar.json');
const MAX_AGE_DAYS = 30;
const CAP = 2500; // index size ceiling (popular-first; bounds scrape + file size)
const force = process.argv.includes('--force');

async function ageDays(path) {
  // Age from the index's own generatedAt, NOT file mtime: the file is
  // git-tracked, so checkout resets mtime and the check reads "fresh" on any
  // clean clone (same bug class as tagger-tags.json #1181 / refresh-rules).
  try {
    const generatedAt = new Date(JSON.parse(await readFile(path, 'utf8')).generatedAt).getTime();
    if (Number.isFinite(generatedAt)) return (Date.now() - generatedAt) / 86_400_000;
  } catch {
    // unreadable/unparseable → treat as missing and refetch
  }
  return Infinity;
}

const age = await ageDays(DEST);
if (!force && age < MAX_AGE_DAYS) {
  console.log(`[card-similar] ${DEST} is ${age.toFixed(1)}d old (< ${MAX_AGE_DAYS}d), skipping`);
  process.exit(0);
}

const canon = (name) => name.replace(/[’]/g, "'");
const slug = (name) =>
  canon(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchSimilar(name) {
  try {
    const res = await fetch(`https://json.edhrec.com/pages/cards/${slug(name)}.json`);
    if (!res.ok) return null;
    const j = await res.json();
    return Array.isArray(j.similar) ? j.similar.map(canon) : [];
  } catch {
    return null;
  }
}

async function fetchTopSeed() {
  try {
    const res = await fetch('https://json.edhrec.com/pages/top/year.json');
    if (!res.ok) return [];
    const j = await res.json();
    const buckets = j.container?.json_dict?.cardlists ?? [];
    const names = [];
    for (const b of buckets) for (const c of b.cardviews ?? b.cards ?? []) names.push(canon(c.name));
    return names;
  } catch {
    return [];
  }
}

const seed = await fetchTopSeed();
if (seed.length === 0) {
  if (Number.isFinite(age)) {
    console.warn(`[card-similar] seed fetch failed; keeping existing snapshot (${age.toFixed(1)}d)`);
    process.exit(0);
  }
  console.error('[card-similar] seed fetch failed and no local copy exists');
  process.exit(1);
}
console.log(`[card-similar] seeded ${seed.length} top cards; BFS-walking similar graph (cap ${CAP})…`);

// BFS over the similarity graph: every visited card becomes an index key with
// its similar list; its neighbours join the frontier. Popular-first ordering
// means the CAP keeps the most-played staples.
const index = {};
const queued = new Set(seed);
const frontier = [...seed];
let i = 0;
while (frontier.length > 0 && Object.keys(index).length < CAP) {
  const name = frontier.shift();
  const sim = await fetchSimilar(name);
  if (sim && sim.length) {
    index[name] = sim;
    for (const s of sim) {
      if (!queued.has(s)) {
        queued.add(s);
        frontier.push(s);
      }
    }
  }
  if (++i % 100 === 0) {
    console.log(`[card-similar]   ${Object.keys(index).length} indexed / ${frontier.length} queued`);
  }
  await sleep(70); // be polite to EDHREC
}

const out = {
  generatedAt: new Date().toISOString(),
  source: 'json.edhrec.com/pages/cards/{slug}.json (similar[]), BFS from top/year',
  count: Object.keys(index).length,
  similar: index, // cardName -> [similar card names, EDHREC-ranked best-first]
};
await mkdir(dirname(DEST), { recursive: true });
await writeFile(DEST, JSON.stringify(out) + '\n');
console.log(`[card-similar] wrote ${out.count} entries → ${DEST}`);
