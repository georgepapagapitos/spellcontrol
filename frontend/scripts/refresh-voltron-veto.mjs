#!/usr/bin/env node
// Builds public/voltron-veto.json: the creature commanders whose EDHREC page says almost nobody
// builds them as Voltron (R11 of commander-profile.golden.md: Voltron under 4% of the page's
// themed decks, on a page with 30 or more). The commander finder and the collection read it so
// "Plays like" and the Voltron filter give the same answer as the commander profile, without a
// request per commander and without depending on what the visitor has browsed.
//
//   node scripts/refresh-voltron-veto.mjs            # skips when the snapshot is under 30 days old
//   node scripts/refresh-voltron-veto.mjs --force    # re-fetch unconditionally
//   node scripts/refresh-voltron-veto.mjs --no-fetch # never touch the network (prebuild)
//
// Candidates come from Scryfall (is:commander creatures), screened by the text half of the rule,
// then one EDHREC page each, 120 ms apart, with a User-Agent. The file is committed and shipped;
// the refresh-snapshots workflow re-runs it on schedule. A missing name just means "text decides".

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  edhrecSlug,
  isVoltronCandidate,
  isVoltronVetoed,
  snapshotKey,
  VOLTRON_MIN_THEME_SHARE,
  VOLTRON_MIN_THEMED_DECKS,
} from './voltron-veto-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DEST = resolve(here, '..', 'public', 'voltron-veto.json');
const MAX_AGE_DAYS = 30;
// A refresh that loses more than this share of the existing names is a truncated fetch, not news.
const MAX_SHRINK_RATIO = 0.5;
const UA = 'SpellControl-VoltronVetoRefresh/1.0 (github.com/spellcontrol)';
const force = process.argv.includes('--force');
const noFetch = process.argv.includes('--no-fetch');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readExisting() {
  try {
    return JSON.parse(await readFile(DEST, 'utf8'));
  } catch {
    return null;
  }
}

const existing = await readExisting();
const stamp = existing ? new Date(existing.generatedAt).getTime() : NaN;
// Age from the file's own generatedAt: mtime resets on checkout (same bug class as tagger-tags).
const age = Number.isFinite(stamp) ? (Date.now() - stamp) / 86_400_000 : Infinity;
if (noFetch || (!force && age < MAX_AGE_DAYS)) {
  console.log(`[voltron-veto] ${DEST} is ${age.toFixed(1)}d old, skipping fetch`);
  process.exit(0);
}

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.ok) return res.json();
    // EDHREC answers 403 (S3) or 404 for a commander it has no page for: no page, not a failure.
    if (res.status === 404 || res.status === 403) return null;
    await sleep(res.status === 429 ? 60_000 : 2000 * (i + 1));
  }
  throw new Error(`${url} kept failing`);
}

async function scryfallCommanders() {
  const cards = [];
  let url =
    'https://api.scryfall.com/cards/search?' +
    new URLSearchParams({ q: 'is:commander t:creature game:paper', unique: 'cards' });
  while (url) {
    const page = await getJson(url);
    cards.push(...page.data);
    url = page.has_more ? page.next_page : null;
    await sleep(120); // Scryfall asks for 50-100 ms between requests
  }
  return cards;
}

try {
  const candidates = (await scryfallCommanders()).filter(isVoltronCandidate);
  console.log(`[voltron-veto] ${candidates.length} candidate commanders; fetching EDHREC pages…`);
  const names = new Set();
  let paged = 0;
  for (const card of candidates) {
    const page = await getJson(
      `https://json.edhrec.com/pages/commanders/${edhrecSlug(card.name)}.json`
    );
    const themes = page?.panels?.taglinks;
    if (themes) paged++;
    if (isVoltronVetoed(themes)) names.add(snapshotKey(card.name));
    await sleep(120);
  }
  if (paged < candidates.length * 0.5) {
    throw new Error(`only ${paged} of ${candidates.length} EDHREC pages answered`);
  }
  const prev = existing?.names?.length ?? 0;
  if (prev > 0 && names.size < prev * MAX_SHRINK_RATIO) {
    throw new Error(`veto set shrank ${prev} -> ${names.size}; refusing to write it`);
  }
  const out = {
    generatedAt: new Date().toISOString(),
    source: 'json.edhrec.com/pages/commanders/{slug}.json (panels.taglinks), Scryfall is:commander',
    minThemedDecks: VOLTRON_MIN_THEMED_DECKS,
    minShare: VOLTRON_MIN_THEME_SHARE,
    candidates: candidates.length,
    count: names.size,
    names: [...names].sort(),
  };
  await mkdir(dirname(DEST), { recursive: true });
  await writeFile(DEST, JSON.stringify(out) + '\n');
  console.log(`[voltron-veto] wrote ${out.count} names (${paged} pages) -> ${DEST}`);
} catch (e) {
  // A stale snapshot beats none: keep the shipped file and say so.
  console.warn(`[voltron-veto] refresh failed (${e.message}); keeping the existing snapshot`);
  if (!existing) process.exit(1);
}
