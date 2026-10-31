#!/usr/bin/env node
// Builds public/combo-votes.json: which Commander Spellbook two-card combos EDHREC's community
// has voted as early (executable before about turn 6, Brackets 4 and 5) or late (Bracket 3).
// The bracket estimator reads it so a combo's speed is the community's call where there is one,
// and Spellbook's tag plus the deck's own speed otherwise (E1053). The backend's check_bracket
// tool reads the same file (backend/src/ai/combo-votes.ts).
//
//   node scripts/refresh-combo-votes.mjs            # skips when the snapshot is under 30 days old
//   node scripts/refresh-combo-votes.mjs --force    # re-fetch unconditionally
//   node scripts/refresh-combo-votes.mjs --no-fetch # never touch the network (prebuild)
//
// Sources: json.edhrec.com/pages/combos/{early,late}-game-2-card-combos.json, then the `more`
// path on each page until it runs out (15 and 8 pages of 100 at the 2026-10-31 pull), 150 ms
// apart with a User-Agent. The file is committed and shipped; refresh-snapshots re-runs it.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LISTS, MIN_VOTES, pickVotes } from './combo-votes-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DEST = resolve(here, '..', 'public', 'combo-votes.json');
const MAX_AGE_DAYS = 30;
// A refresh that loses more than this share of an existing list is a truncated fetch, not news.
const MAX_SHRINK_RATIO = 0.5;
const MAX_PAGES = 60; // a runaway `more` chain stops here
const UA = 'SpellControl-ComboVotesRefresh/1.0 (github.com/spellcontrol)';
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
  console.log(`[combo-votes] ${DEST} is ${age.toFixed(1)}d old, skipping fetch`);
  process.exit(0);
}

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.ok) return res.json();
    await sleep(res.status === 429 ? 60_000 : 2000 * (i + 1));
  }
  throw new Error(`${url} kept failing`);
}

async function fetchList(slug) {
  const entries = [];
  let path = `pages/combos/${slug}.json`;
  for (let page = 0; path && page < MAX_PAGES; page++) {
    const data = await getJson(`https://json.edhrec.com/${path}`);
    // Page 1 nests the lists under container.json_dict; later pages are flat.
    const body = data.container?.json_dict ?? data;
    entries.push(...(body.cardlists ?? []));
    path = body.more ? (body.more.startsWith('pages/') ? body.more : `pages/${body.more}`) : null;
    await sleep(150);
  }
  return entries;
}

try {
  const raw = {};
  for (const [kind, slug] of Object.entries(LISTS)) {
    raw[kind] = await fetchList(slug);
    console.log(`[combo-votes] ${kind}: ${raw[kind].length} entries`);
  }
  const picked = pickVotes(raw);
  for (const kind of ['early', 'late']) {
    const prev = existing?.[kind]?.length ?? 0;
    if (picked[kind].length < 100) {
      throw new Error(`only ${picked[kind].length} ${kind} votes; refusing to write them`);
    }
    if (prev > 0 && picked[kind].length < prev * MAX_SHRINK_RATIO) {
      throw new Error(`${kind} votes shrank ${prev} -> ${picked[kind].length}; refusing to write`);
    }
  }
  const out = {
    generatedAt: new Date().toISOString(),
    source: 'json.edhrec.com/pages/combos/{early,late}-game-2-card-combos*.json (comboVote)',
    minVotes: MIN_VOTES,
    early: picked.early,
    late: picked.late,
  };
  await mkdir(dirname(DEST), { recursive: true });
  await writeFile(DEST, JSON.stringify(out) + '\n');
  console.log(`[combo-votes] wrote ${out.early.length} early, ${out.late.length} late -> ${DEST}`);
} catch (e) {
  // A stale snapshot beats none: keep the shipped file and say so.
  console.warn(`[combo-votes] refresh failed (${e.message}); keeping the existing snapshot`);
  if (!existing) process.exit(1);
}
