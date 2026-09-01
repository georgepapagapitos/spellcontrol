#!/usr/bin/env node
// Builds the tagger-tags.json snapshot in public/ so the deck builder can
// classify roles (ramp/removal/wipes/draw) and binder rules can match `tag IS x`
// without depending on a remote URL at runtime. Run manually via
// `npm run refresh-tags`, or auto-invoked by predev if the local copy is
// missing or older than MAX_AGE_DAYS. `prebuild` invokes it with --no-fetch:
// builds ship the committed snapshot and never reach the network.
//
// The snapshot is generated from Scryfall's own `otag:` search operator — the
// same community oracle-tag corpus that backs Scryfall's tag search. We used to
// download a prebuilt copy from a third-party S3 bucket; owning the producer
// removes that from our build pipeline. Set TAGGER_SOURCE_URL to fall back to
// downloading a prebuilt snapshot instead (escape hatch; unused by default).
//
// Flags:
//   --force      re-fetch/rebuild unconditionally, and bypass the shrink guard
//   --no-fetch   keep the committed snapshot whatever its age; never touch the
//                network (ignored when --force is also passed)
//
// NOTE: the tag vocabulary below is a contract with three consumers —
// deck-builder/services/tagger/client.ts (role + subtype lookup),
// lib/card-tags.ts (binder-rule reverse index) and lib/otag-descriptions.ts
// (per-tag copy, pinned by otag-descriptions.test.ts). Adding or renaming a tag
// is a deliberate change that touches all three; don't do it incidentally here.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Tag name (as consumed by the app) → Scryfall search query.
// Mostly the identity mapping onto the otag of the same name; where it isn't,
// the app-facing key is deliberately kept and only the query moved, because the
// key is the contract with the three consumers named above and the otag is not.
// Upstream renames a tag from time to time and the old slug then matches
// nothing, which aborts the whole run (see buildTags) — so a mapping here is
// the cheap half of the fix.
const TAG_QUERIES = {
  ramp: 'otag:ramp',
  'cost-reducer': 'otag:cost-reducer',
  'mana-dork': 'otag:mana-dork',
  'mana-rock': 'otag:mana-rock',
  removal: 'otag:removal',
  'spot-removal': 'otag:spot-removal',
  counterspell: 'otag:counterspell',
  bounce: 'otag:bounce',
  boardwipe: 'otag:boardwipe',
  'card-advantage': 'otag:card-advantage',
  draw: 'otag:draw',
  tutor: 'otag:tutor',
  cantrip: 'otag:cantrip',
  wheel: 'otag:wheel',
  lifegain: 'otag:lifegain',
  sacrifice: 'otag:sacrifice-outlet',
  'graveyard-hate': 'otag:graveyard-hate',
  protection: 'otag:protection',
  // Renamed upstream: `otag:mana-fix` matched 0 cards as of 2026-09-01 and
  // `otag:chromatic-lantern` ("allows your lands to tap for additional colors
  // of mana") carries 51 of its 52 former members.
  'mana-fix': 'otag:chromatic-lantern',
  'utility-land': 'otag:utility-land',
  tapland: 'otag:tapland',
  'mass-land-denial': 'otag:mass-land-denial',
  'extra-turn': 'otag:extra-turn',
};

const SOURCE_URL = process.env.TAGGER_SOURCE_URL; // unset → build from Scryfall
const MAX_AGE_DAYS = 30;
const SCRYFALL_DELAY_MS = 200; // 5 req/s, half Scryfall's documented 10/s ceiling
const RATE_LIMIT_BACKOFF_MS = 65_000; // Scryfall asks for a 60s cooldown on 429
const MAX_RETRIES = 3;
// A tag losing this much of its card pool means a bad query or a truncated
// pagination run, not upstream churn. Writing it would silently degrade role
// classification everywhere with no error, so refuse unless --force.
const MAX_SHRINK_RATIO = 0.2;

const force = process.argv.includes('--force');
// --no-fetch: never reach the network, just keep whatever snapshot is committed.
// `prebuild` passes it so a production build can't depend on a third-party API
// being up, fast, or under its rate limit. --force still wins, so the scheduled
// refresh workflow and the manual `npm run refresh-*` scripts are unaffected.
const noFetch = !force && process.argv.includes('--no-fetch');
const here = dirname(fileURLToPath(import.meta.url));
const dest = resolve(here, '..', 'public', 'tagger-tags.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readSnapshot(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null; // unreadable/unparseable → treat as missing
  }
}

function ageDays(snapshot) {
  // Age from the snapshot's own generatedAt, NOT file mtime: the file is
  // git-tracked, so checkout / Docker COPY resets mtime and the mtime check
  // reads "fresh" in every clean build — prod shipped a 72-day-old snapshot
  // that way while the source was current.
  const generatedAt = new Date(snapshot?.generatedAt).getTime();
  return Number.isFinite(generatedAt) ? (Date.now() - generatedAt) / 86_400_000 : Infinity;
}

async function scryfall(url) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await sleep(SCRYFALL_DELAY_MS);
    // Scryfall 400s requests without a User-Agent.
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SpellControl-TaggerRefresh/1.0', Accept: 'application/json' },
    });
    if (attempt < MAX_RETRIES && (res.status === 429 || (res.status >= 500 && res.status < 600))) {
      const backoff = res.status === 429 ? RATE_LIMIT_BACKOFF_MS : 2 ** (attempt + 1) * 1000;
      console.warn(`[tagger]   Scryfall ${res.status}, retrying in ${backoff / 1000}s`);
      await sleep(backoff);
      continue;
    }
    return res;
  }
  throw new Error('exhausted retries');
}

const searchUrl = (query) =>
  `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=cards&order=name`;

/** Total match count for a query, or 0 when Scryfall reports no matches (404). */
async function fetchTagCount(query) {
  const res = await scryfall(`${searchUrl(query)}&page=1`);
  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`Scryfall ${res.status}: ${await res.text()}`);
  return (await res.json()).total_cards ?? 0;
}

/** Every card name matching a query, following pagination to the last page. */
async function fetchTagNames(query) {
  const names = [];
  let url = searchUrl(query);
  while (url) {
    const res = await scryfall(url);
    if (res.status === 404) break; // Scryfall reports "no matches" as a 404
    if (!res.ok) throw new Error(`Scryfall ${res.status}: ${await res.text()}`);
    const page = await res.json();
    for (const card of page.data) names.push(card.name);
    url = page.has_more && page.next_page ? page.next_page : null;
  }
  return names;
}

/**
 * Build every tag's name list. Skips the paginated fetch for any tag whose total
 * count still matches the previous snapshot — one request instead of ~10 per
 * unchanged tag. Throws on a tag that fails outright rather than silently
 * substituting an empty list.
 */
async function buildTags(previous) {
  const tags = {};
  let fetched = 0;
  let skipped = 0;
  for (const [tag, query] of Object.entries(TAG_QUERIES)) {
    const cached = previous?.tags?.[tag];
    if (!force && cached?.length) {
      const count = await fetchTagCount(query);
      if (count === cached.length) {
        tags[tag] = cached;
        skipped++;
        continue;
      }
      console.log(`[tagger]   ${tag}: ${cached.length} → ${count}, re-fetching`);
    }
    const names = await fetchTagNames(query);
    if (names.length === 0) throw new Error(`tag "${tag}" (${query}) returned no cards`);
    tags[tag] = names;
    fetched++;
    console.log(`[tagger]   ${tag}: ${names.length} cards`);
  }
  console.log(`[tagger] ${fetched} tag(s) fetched, ${skipped} unchanged`);
  return tags;
}

/** Refuse a rebuild that guts an existing tag — see MAX_SHRINK_RATIO. */
function assertNoCollapse(tags, previous) {
  if (!previous?.tags) return;
  const shrunk = Object.entries(tags).flatMap(([tag, names]) => {
    const before = previous.tags[tag]?.length ?? 0;
    return before > 0 && names.length < before * (1 - MAX_SHRINK_RATIO)
      ? [`  ${tag}: ${before} → ${names.length}`]
      : [];
  });
  if (shrunk.length === 0) return;
  throw new Error(
    `tag pool collapsed beyond ${MAX_SHRINK_RATIO * 100}%:\n${shrunk.join('\n')}\n` +
      'Suspect a bad query or a truncated fetch. Re-run with --force to write anyway.'
  );
}

const previous = await readSnapshot(dest);
const age = ageDays(previous);
// An unusable/absent snapshot falls through even under --no-fetch: there is
// nothing to keep, so the fetch below runs and fails loudly if it must.
if (noFetch && Number.isFinite(age)) {
  console.log(`[tagger] --no-fetch, keeping the committed snapshot (${age.toFixed(1)}d old)`);
  process.exit(0);
}
if (!force && age < MAX_AGE_DAYS) {
  console.log(`[tagger] ${dest} is ${age.toFixed(1)}d old (< ${MAX_AGE_DAYS}d), skipping refresh`);
  process.exit(0);
}

let payload;
try {
  if (SOURCE_URL) {
    console.log(`[tagger] Fetching prebuilt snapshot from ${SOURCE_URL}`);
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
  } else {
    console.log(`[tagger] Building from Scryfall (${Object.keys(TAG_QUERIES).length} tags)`);
    const tags = await buildTags(previous);
    if (!force) assertNoCollapse(tags, previous);
    payload = { generatedAt: new Date().toISOString(), tags };
  }
} catch (err) {
  // A stale snapshot beats no snapshot: the committed copy is what ships, and
  // every consumer reads the bundled file rather than the network.
  if (previous) {
    console.warn(`[tagger] Refresh failed (${err.message}), keeping existing snapshot`);
    process.exit(0);
  }
  console.error(`[tagger] Refresh failed and no local copy exists: ${err.message}`);
  process.exit(1);
}

// Pretty-printed with a trailing newline to match Prettier — the file is
// git-tracked and format:check runs over it in CI.
const body = `${JSON.stringify(payload, null, 2)}\n`;
await mkdir(dirname(dest), { recursive: true });
await writeFile(dest, body);
const total = Object.values(payload.tags).reduce((n, names) => n + names.length, 0);
console.log(`[tagger] Wrote ${dest} — ${total} entries, ${(body.length / 1024).toFixed(1)} KB`);
