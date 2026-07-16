#!/usr/bin/env node
// Builds public/sld-drops.json — the Secret Lair drop map: which drop each
// SLD collector number was printed in. Scryfall lumps every Secret Lair
// printing into the single flat `SLD` set with no drop metadata, so the map
// comes from MTGJSON instead, merged from two sources:
//
//  - https://mtgjson.com/api/v5/SLD.json.gz — sealedProduct release dates +
//    per-drop decklists (deck refs resolve to uuid-keyed boards; the set's
//    own card list maps uuid → collector number).
//  - mtgjson/mtg-sealed-content data/contents/SLD.yaml — the upstream source
//    feeding MTGJSON; its `variable` blocks carry chase/bonus card numbers
//    that don't always survive into the compiled SLD.json.
//
// Run manually via `npm run refresh-sld-drops`, or auto-invoked by
// predev/prebuild when the local copy is missing or older than MAX_AGE_DAYS.
// Pass --force to re-fetch unconditionally. Mirrors refresh-tagger.mjs,
// including its soft-fail: fetch trouble keeps the existing snapshot.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
// js-yaml v4: `load` is the safe loader (no arbitrary-type tags).
import yaml from 'js-yaml';

const JSON_URL = process.env.SLD_JSON_URL ?? 'https://mtgjson.com/api/v5/SLD.json.gz';
const YAML_URL =
  process.env.SLD_CONTENTS_URL ??
  'https://raw.githubusercontent.com/mtgjson/mtg-sealed-content/main/data/contents/SLD.yaml';
const MAX_AGE_DAYS = 30;
const force = process.argv.includes('--force');

const here = dirname(fileURLToPath(import.meta.url));
const dest = resolve(here, '..', 'public', 'sld-drops.json');

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
if (!force && age < MAX_AGE_DAYS) {
  console.log(`[sld] ${dest} is ${age.toFixed(1)}d old (< ${MAX_AGE_DAYS}d), skipping fetch`);
  process.exit(0);
}

/** Fetch a URL; on any failure keep the existing snapshot (exit 0) if we have one. */
async function fetchOrKeep(url) {
  let res;
  try {
    res = await fetch(url);
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
const contents = yaml.load(await yamlRes.text());

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
  addCardRefs(drop, productContents ?? {});
  for (const ref of productContents?.deck ?? []) {
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

const drops = [...numbersByDrop.entries()]
  .filter(([, numbers]) => numbers.size > 0)
  .map(([name, numbers]) => ({
    name,
    releasedAt: dateByDrop.get(name) ?? '',
    numbers: [...numbers].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b)),
  }))
  .sort((a, b) => b.releasedAt.localeCompare(a.releasedAt) || a.name.localeCompare(b.name));

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
