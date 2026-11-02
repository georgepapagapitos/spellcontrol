#!/usr/bin/env node
// Compares Scryfall's live `is:gamechanger` list with the hardcoded
// HARDCODED_GAME_CHANGERS in packages/deck-metrics (the backend's only source
// and the frontend's offline floor). Run weekly by
// .github/workflows/game-changers-drift.yml; needs the package built first
// (`.github/actions/build-shared`).
//
// Exit 0: lists match. Exit 1: they differ; the added and removed names are
// printed and written to game-changers-drift.md (the workflow opens one issue
// from that file). Exit 2: the fetch itself failed (no file written, so a
// Scryfall outage opens no issue). The list is never edited by this script:
// changing it moves users' bracket estimates, which is a decision.
import { writeFileSync, appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  HARDCODED_GAME_CHANGERS,
  GAME_CHANGERS_AS_OF,
  diffGameChangers,
} = require('../packages/deck-metrics/dist/cjs/index.js');

const HEADERS = { 'User-Agent': 'spellcontrol/1.0', Accept: 'application/json' };
const MAX_PAGES = 5;
const PAGE_DELAY_MS = 120; // Scryfall asks for 50-100 ms between requests

async function fetchLiveNames() {
  const names = [];
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent('is:gamechanger')}&unique=cards`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    if (page > 0) await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`Scryfall answered ${res.status} for ${url}`);
    const body = await res.json();
    for (const card of body.data) names.push(card.name);
    url = body.has_more ? body.next_page : null;
  }
  if (url) throw new Error(`still more pages after ${MAX_PAGES}; refusing a partial list`);
  return names;
}

let live;
try {
  live = await fetchLiveNames();
} catch (err) {
  console.error(`::error::Could not fetch the live Game Changers list: ${err.message}`);
  process.exit(2);
}
if (live.length < 20) {
  console.error(`::error::Live list has only ${live.length} cards; treating it as a bad fetch.`);
  process.exit(2);
}

const { added, removed } = diffGameChangers(live, HARDCODED_GAME_CHANGERS);
if (added.length === 0 && removed.length === 0) {
  console.log(
    `Game Changers match the live list (${live.length} cards, hardcoded as of ${GAME_CHANGERS_AS_OF}).`
  );
  process.exit(0);
}

const list = (xs) => (xs.length ? xs.map((n) => `- ${n}`).join('\n') : '- none');
const report = [
  `The hardcoded Game Changers list (as of ${GAME_CHANGERS_AS_OF}) no longer matches Scryfall's \`is:gamechanger\`.`,
  '',
  `**Added on Scryfall (${added.length}):**`,
  list(added),
  '',
  `**Removed on Scryfall (${removed.length}):**`,
  list(removed),
  '',
  'Update `HARDCODED_GAME_CHANGERS` and `GAME_CHANGERS_AS_OF` in `packages/deck-metrics/src/index.ts`, then re-run the bracket benchmark. Editing the list changes bracket estimates, so it is a product call.',
].join('\n');
console.log(report);
writeFileSync('game-changers-drift.md', report + '\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');
process.exit(1);
