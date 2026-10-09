#!/usr/bin/env node
// Builds public/sld-drops.json — the Secret Lair drop map: which drop each
// SLD collector number was printed in. Scryfall lumps every Secret Lair
// printing into the single flat `SLD` set with no drop metadata, so the map
// comes from MTGJSON instead, merged from two sources:
//
//  - https://mtgjson.com/api/v5/SLD.json.gz — sealedProduct release dates +
//    per-drop decklists (deck refs resolve to uuid-keyed boards; the set's
//    own card list maps uuid → collector number).
//  - mtgjson/mtg-sealed-content data/products/SLD.yaml — the upstream source
//    feeding MTGJSON; its `variable` blocks carry chase/bonus card numbers
//    that don't always survive into the compiled SLD.json.
//
// Run manually via `npm run refresh-sld-drops`, or auto-invoked by predev when
// the local copy is missing or older than MAX_AGE_DAYS; `prebuild` passes
// --no-fetch so a build never touches the network. Pass --force to re-fetch
// unconditionally, or --no-fetch to keep the committed snapshot at any age. Mirrors refresh-tagger.mjs,
// including its soft-fail (fetch trouble keeps the existing snapshot) and its
// shrink guard (a result that loses >2% of the committed number/drop pairs exits
// non-zero; --allow-shrink overrides).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
// `load` is the safe loader (no arbitrary-type tags). js-yaml v5 dropped the
// default export, so this must be the named import.
import { load as loadYaml } from 'js-yaml';
import { pruneOutlierDrops } from './sld-drop-dates.mjs';
import { assertNoShrink, carryForward } from './sld-drop-merge.mjs';

const JSON_URL = process.env.SLD_JSON_URL ?? 'https://mtgjson.com/api/v5/SLD.json.gz';
const YAML_URL =
  process.env.SLD_CONTENTS_URL ??
  'https://raw.githubusercontent.com/mtgjson/mtg-sealed-content/main/data/products/SLD.yaml';
const MAX_AGE_DAYS = 30;
const force = process.argv.includes('--force');
// --no-fetch: never reach the network, just keep whatever snapshot is committed.
// `prebuild` passes it so a production build can't depend on a third-party API
// being up, fast, or under its rate limit. --force still wins, so the scheduled
// refresh workflow and the manual `npm run refresh-*` scripts are unaffected.
// --allow-shrink: write even when the result loses more than the shrink guard allows.
const allowShrink = process.argv.includes('--allow-shrink');
const noFetch = !force && process.argv.includes('--no-fetch');

const here = dirname(fileURLToPath(import.meta.url));
const dest = resolve(here, '..', 'public', 'sld-drops.json');

async function readPrevious() {
  try {
    return JSON.parse(await readFile(dest, 'utf8'));
  } catch {
    return null;
  }
}

async function ageDays(path) {
  // Age from the snapshot's own generatedAt, NOT file mtime — the file is
  // git-tracked, so checkout / Docker COPY resets mtime (same trap the
  // tagger snapshot hit).
  try {
    const generatedAt = new Date(JSON.parse(await readFile(path, 'utf8')).generatedAt).getTime();
    if (Number.isFinite(generatedAt)) return (Date.now() - generatedAt) / 86_400_000;
  } catch {
    // unreadable/unparseable → treat as missing and refetch
  }
  return Infinity;
}

const age = await ageDays(dest);
// An unusable/absent snapshot falls through even under --no-fetch: there is
// nothing to keep, so the fetch below runs and fails loudly if it must.
if (noFetch && Number.isFinite(age)) {
  console.log(`[sld] --no-fetch, keeping the committed snapshot (${age.toFixed(1)}d old)`);
  process.exit(0);
}
if (!force && age < MAX_AGE_DAYS) {
  console.log(`[sld] ${dest} is ${age.toFixed(1)}d old (< ${MAX_AGE_DAYS}d), skipping fetch`);
  process.exit(0);
}

/** Fetch a URL; on any failure keep the existing snapshot (exit 0) if we have one. */
async function fetchOrKeep(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    bail(`Fetch failed for ${url}: ${err.message}`);
  }
  if (!res.ok) bail(`HTTP ${res.status} for ${url}`);
  return res;
}

function bail(message) {
  if (Number.isFinite(age)) {
    console.warn(`[sld] ${message}, keeping existing snapshot (${age.toFixed(1)}d old)`);
    process.exit(0);
  }
  console.error(`[sld] ${message} and no local copy exists`);
  process.exit(1);
}

console.log(`[sld] Fetching ${JSON_URL}`);
const jsonRes = await fetchOrKeep(JSON_URL);
const sldJson = JSON.parse(gunzipSync(Buffer.from(await jsonRes.arrayBuffer())).toString('utf8'));

console.log(`[sld] Fetching ${YAML_URL}`);
const yamlRes = await fetchOrKeep(YAML_URL);
const contents = loadYaml(await yamlRes.text());

const data = sldJson.data ?? {};
const decksByName = new Map((data.decks ?? []).map((d) => [d.name, d]));
const numberByUuid = new Map((data.cards ?? []).map((c) => [c.uuid, String(c.number)]));

/** One drop per product family: strip the SKU prefix and finish-edition suffixes. */
function dropName(productName) {
  return productName
    .replace(/^Secret Lair (Drop( Series)?|Commander Deck):? /, '')
    .replace(
      /\s+(Foil|Non-?Foil|Rainbow Foil|Galaxy Foil|Textured Foil|Etched(?: Foil)?|Halo Foil|Confetti Foil)( Edition)?$/i,
      ''
    )
    .replace(/\s+Edition$/, '')
    .trim();
}

const numbersByDrop = new Map(); // drop name → Set<collector number>
const dateByDrop = new Map(); // drop name → earliest release date

function addNumber(drop, number) {
  let set = numbersByDrop.get(drop);
  if (!set) {
    set = new Set();
    numbersByDrop.set(drop, set);
  }
  set.add(String(number));
}

/** Recursively collect every {set: 'sld', number} card ref in a contents blob,
 *  skipping `sealed` (bundle → product refs, not cards). */
function addCardRefs(drop, node) {
  if (Array.isArray(node)) {
    for (const item of node) addCardRefs(drop, item);
  } else if (node && typeof node === 'object') {
    if (node.number !== undefined && String(node.set ?? '').toLowerCase() === 'sld') {
      addNumber(drop, node.number);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'sealed') addCardRefs(drop, value);
    }
  }
}

// Release dates from the compiled products (earliest SKU wins).
for (const product of data.sealedProduct ?? []) {
  if (product.subtype !== 'secret_lair' && product.subtype !== 'commander') continue;
  const drop = dropName(product.name);
  const date = product.releaseDate;
  if (date && (!dateByDrop.has(drop) || date < dateByDrop.get(drop))) dateByDrop.set(drop, date);
}

// Card numbers from the upstream YAML contents (card + variable blocks), with
// deck refs resolved through the compiled set's uuid-keyed decklists.
for (const [productName, productContents] of Object.entries(contents?.products ?? {})) {
  if (productName.startsWith('Secret Lair Bundle')) continue;
  const drop = dropName(productName);
  // Upstream moved the card/deck/variable blocks under each product's `contents`
  // key (data/contents/ became data/products/); the old flat shape still parses.
  const blocks = productContents?.contents ?? productContents ?? {};
  addCardRefs(drop, blocks);
  // Upstream now names bonus/chase cards by `pack` code (a shared sheet in the compiled
  // set's `booster` table) instead of listing numbers. Resolving packs credits one pool
  // card to up to 47 drops, so they are skipped here and the committed snapshot's
  // membership is carried forward below (sld-drop-merge.mjs).
  for (const ref of blocks.deck ?? []) {
    const deck = decksByName.get(ref?.name);
    if (!deck) continue;
    for (const board of ['mainBoard', 'sideBoard', 'commander']) {
      for (const entry of deck[board] ?? []) {
        const number = numberByUuid.get(entry?.uuid);
        if (number) addNumber(drop, number);
      }
    }
  }
}

/** Every SLD printing's [collector number, released_at] from Scryfall (~15 pages). */
async function fetchPrintings() {
  // Scryfall answers a bare Node fetch with HTTP 400: it requires a User-Agent
  // and an Accept header on every API request.
  const init = {
    headers: { 'User-Agent': 'SpellControl-SldDrops/1.0', Accept: 'application/json' },
  };
  const printings = [];
  let next =
    'https://api.scryfall.com/cards/search?q=set%3Asld+unique%3Aprints&order=set&include_extras=true';
  while (next) {
    const res = await fetchOrKeep(next, init);
    const page = await res.json();
    for (const card of page.data ?? []) printings.push([card.collector_number, card.released_at]);
    next = page.has_more ? page.next_page : null;
    await new Promise((r) => setTimeout(r, 120));
  }
  return printings;
}

console.log('[sld] Fetching Scryfall SLD printings for date cross-check');
const printings = await fetchPrintings();
if (printings.length < 1500) bail(`Suspiciously few Scryfall SLD printings (${printings.length})`);

const built = [...numbersByDrop.entries()]
  .filter(([, numbers]) => numbers.size > 0)
  .map(([name, numbers]) => ({
    name,
    releasedAt: dateByDrop.get(name) ?? '',
    numbers: [...numbers].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b)),
  }))
  .sort((a, b) => b.releasedAt.localeCompare(a.releasedAt) || a.name.localeCompare(b.name));

// Keep the committed snapshot's membership for anything upstream no longer lists
// as explicit numbers, so a refresh adds drops and corrects dates but never loses
// a mapping just because upstream changed how it writes it down.
const previousSnapshot = await readPrevious();
const merged = carryForward(built, previousSnapshot?.drops);
console.log(
  `[sld] Carried forward ${merged.carried.length} number/drop pairs the snapshot had and upstream no longer lists explicitly` +
    (merged.carried.length
      ? ` (e.g. ${merged.carried
          .slice(0, 5)
          .map((c) => `${c.drop} #${c.number}`)
          .join(', ')})`
      : '')
);

// A drop whose date is far from the printing's own is MTGJSON misfiling a
// bonus card (Ral, Storm Conduit #523 under 2021 drops): treat that drop as
// unknown for the number. See sld-drop-dates.mjs for the cutoff.
const { drops, removed } = pruneOutlierDrops(merged.drops, printings);
console.log(`[sld] Dropped ${removed.length} number/drop pairs far from the printing's own date`);

// Refuse a rewrite that guts the map (a structural upstream change) instead of
// shipping it as a quiet snapshot PR. Exits non-zero so the workflow run fails.
try {
  const { before, lost } = assertNoShrink(drops, previousSnapshot?.drops);
  console.log(`[sld] Shrink guard: ${lost.length} of ${before} committed pairs not in the result`);
} catch (err) {
  if (!allowShrink) {
    console.error(`::error::[sld] ${err.message}`);
    process.exit(1);
  }
  console.warn(`[sld] ${err.message} Writing anyway (--allow-shrink).`);
}

const mapped = new Set(drops.flatMap((d) => d.numbers)).size;
if (drops.length < 300 || mapped < 1500) {
  // A structural change upstream shouldn't silently ship a gutted map.
  bail(`Suspiciously small result (${drops.length} drops, ${mapped} numbers)`);
}

const body = JSON.stringify({ generatedAt: new Date().toISOString(), drops });
await mkdir(dirname(dest), { recursive: true });
await writeFile(dest, body);
console.log(
  `[sld] Wrote ${dest} (${(body.length / 1024).toFixed(1)} KB, ${drops.length} drops, ${mapped} numbers)`
);
