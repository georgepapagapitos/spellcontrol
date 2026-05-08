#!/usr/bin/env node
// Pulls the tagger-tags.json snapshot into public/ so the deck builder can
// classify roles (ramp/removal/wipes/draw) without depending on a remote URL
// at runtime. Run manually via `npm run refresh-tags`, or auto-invoked by
// predev/prebuild if the local copy is missing or older than MAX_AGE_DAYS.
//
// Pass --force to re-fetch unconditionally.

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL =
  process.env.TAGGER_SOURCE_URL ??
  'https://mtg-deck-builder-tagger.s3.amazonaws.com/tagger-tags.json';
const MAX_AGE_DAYS = 30;
const force = process.argv.includes('--force');

const here = dirname(fileURLToPath(import.meta.url));
const dest = resolve(here, '..', 'public', 'tagger-tags.json');

async function ageDays(path) {
  try {
    const s = await stat(path);
    return (Date.now() - s.mtimeMs) / 86_400_000;
  } catch {
    return Infinity;
  }
}

const age = await ageDays(dest);
if (!force && age < MAX_AGE_DAYS) {
  console.log(`[tagger] ${dest} is ${age.toFixed(1)}d old (< ${MAX_AGE_DAYS}d), skipping fetch`);
  process.exit(0);
}

console.log(`[tagger] Fetching ${SOURCE_URL}`);
let res;
try {
  res = await fetch(SOURCE_URL);
} catch (err) {
  if (Number.isFinite(age)) {
    console.warn(
      `[tagger] Fetch failed (${err.message}), keeping existing snapshot (${age.toFixed(1)}d old)`
    );
    process.exit(0);
  }
  console.error(`[tagger] Fetch failed and no local copy exists: ${err.message}`);
  process.exit(1);
}
if (!res.ok) {
  if (Number.isFinite(age)) {
    console.warn(`[tagger] HTTP ${res.status}, keeping existing snapshot (${age.toFixed(1)}d old)`);
    process.exit(0);
  }
  console.error(`[tagger] HTTP ${res.status} and no local copy exists`);
  process.exit(1);
}

const body = await res.text();
await mkdir(dirname(dest), { recursive: true });
await writeFile(dest, body);
console.log(`[tagger] Wrote ${dest} (${(body.length / 1024).toFixed(1)} KB)`);
