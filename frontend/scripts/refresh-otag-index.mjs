#!/usr/bin/env node
// Builds otag-index.json in public/ — the full Scryfall oracle-tag corpus,
// keyed by card name, for binder tag rules and the card-tags sheet.
//
// This is the RICH counterpart to tagger-tags.json. That file stays: it holds 23
// hand-curated functional buckets the deck builder's role classification depends
// on, tuned alongside the E107 oracle-text classifiers. This one is the whole
// community vocabulary (~4.5k tags) for display and filtering. Two artifacts on
// purpose — deck generation must not shift when the tag corpus does.
//
// Auto-invoked by predev; `prebuild` passes --no-fetch so a build keeps the
// committed index and never touches the network. --force re-fetches at any age.
//
// Sources (both official Scryfall bulk data):
//   oracle_tags  — the tag corpus; taggings are keyed by oracle_id
//   oracle_cards — oracle_id → name, so we can emit a NAME-keyed index
//
// Why name-keyed: EnrichedCard.oracleId is optional (cards saved before the
// field existed never got one, and sync backfills lazily), so an oracle_id key
// would silently drop tags for older collections. Names also compress better
// than UUIDs — the name-keyed index is smaller despite carrying more data.
//
// Hierarchy is PRE-EXPANDED here: `otag:` matches a tag's descendants, so a card
// tagged `hate-graveyard-cast` must also match `hate-graveyard`. Expanding at
// build time means the client is a plain Map lookup with no walk logic. Skipping
// it under-matches badly (hate-graveyard alone: 300 direct vs 435 expanded).
//
// Flags:
//   --force   rebuild unconditionally, bypassing the age check and shrink guard

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BULK_URL = 'https://api.scryfall.com/bulk-data';
const UA = 'SpellControl-OtagRefresh/1.0';
const MAX_AGE_DAYS = 30;
// The corpus is large; a bad join or a truncated stream would gut it silently.
const MAX_SHRINK_RATIO = 0.2;

const force = process.argv.includes('--force');
// --no-fetch: never reach the network, just keep whatever snapshot is committed.
// `prebuild` passes it so a production build can't depend on a third-party API
// being up, fast, or under its rate limit. --force still wins, so the scheduled
// refresh workflow and the manual `npm run refresh-*` scripts are unaffected.
const noFetch = !force && process.argv.includes('--no-fetch');
const here = dirname(fileURLToPath(import.meta.url));
const dest = resolve(here, '..', 'public', 'otag-index.json');

async function readSnapshot(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function ageDays(snapshot) {
  // From the payload's own generatedAt, not file mtime — the file is git-tracked,
  // so checkout/Docker COPY resets mtime and every clean build reads "fresh".
  const at = new Date(snapshot?.generatedAt).getTime();
  return Number.isFinite(at) ? (Date.now() - at) / 86_400_000 : Infinity;
}

/** Resolve a bulk-data feed's download URI by type. */
async function bulkUri(type) {
  const res = await fetch(BULK_URL, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`bulk-data HTTP ${res.status}`);
  const entry = (await res.json()).data.find((b) => b.type === type);
  if (!entry) throw new Error(`no bulk-data feed of type "${type}"`);
  const uri = entry.jsonl_download_uri ?? entry.download_uri;
  if (!uri) throw new Error(`bulk-data "${type}" has no download uri`);
  return uri;
}

/** Stream a gzipped JSONL feed, yielding one parsed object per line. */
async function* streamJsonl(uri) {
  const res = await fetch(uri, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${uri} HTTP ${res.status}`);
  const lines = createInterface({
    input: Readable.fromWeb(res.body).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of lines) if (line) yield JSON.parse(line);
}

async function build() {
  console.log('[otag] Fetching oracle_tags…');
  const tags = [];
  for await (const t of streamJsonl(await bulkUri('oracle_tags'))) tags.push(t);
  console.log(`[otag]   ${tags.length} tags`);

  console.log('[otag] Fetching oracle_cards (for the oracle_id → name join)…');
  const nameByOracleId = new Map();
  for await (const c of streamJsonl(await bulkUri('oracle_cards'))) {
    if (c.oracle_id && c.name) nameByOracleId.set(c.oracle_id, c.name);
  }
  console.log(`[otag]   ${nameByOracleId.size} oracle ids`);

  // Ancestor closure per tag, memoized. Cycles can't hang us: `seen` short-circuits.
  const indexById = new Map(tags.map((t, i) => [t.id, i]));
  const ancestorCache = new Map();
  function ancestors(i, seen = new Set()) {
    const hit = ancestorCache.get(i);
    if (hit) return hit;
    const out = new Set();
    for (const pid of tags[i].parent_ids ?? []) {
      const j = indexById.get(pid);
      if (j === undefined || seen.has(j)) continue;
      seen.add(j);
      out.add(j);
      for (const a of ancestors(j, seen)) out.add(a);
    }
    ancestorCache.set(i, out);
    return out;
  }

  const cards = new Map();
  let unmatched = 0;
  for (let i = 0; i < tags.length; i++) {
    for (const tagging of tags[i].taggings ?? []) {
      const name = nameByOracleId.get(tagging.oracle_id);
      if (!name) {
        unmatched++;
        continue;
      }
      let set = cards.get(name);
      if (!set) cards.set(name, (set = new Set()));
      set.add(i);
      for (const a of ancestors(i)) set.add(a);
    }
  }
  if (unmatched) console.log(`[otag]   ${unmatched} tagging(s) had no matching card, skipped`);
  if (cards.size === 0) throw new Error('join produced zero tagged cards');

  return {
    generatedAt: new Date().toISOString(),
    // Parallel array; `cards` values are indices into it.
    tags: tags.map((t) => ({ s: t.slug, l: t.label, d: t.description ?? '' })),
    cards: Object.fromEntries(
      [...cards].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([n, s]) => [n, [...s].sort((x, y) => x - y)])
    ),
  };
}

/** Refuse a rebuild that guts the corpus — see MAX_SHRINK_RATIO. */
function assertNoCollapse(next, previous) {
  if (!previous?.cards) return;
  const before = Object.keys(previous.cards).length;
  const after = Object.keys(next.cards).length;
  if (before > 0 && after < before * (1 - MAX_SHRINK_RATIO)) {
    throw new Error(
      `tagged-card count collapsed ${before} → ${after} (>${MAX_SHRINK_RATIO * 100}%). ` +
        'Suspect a failed join or a truncated stream. Re-run with --force to write anyway.'
    );
  }
}

const previous = await readSnapshot(dest);
const age = ageDays(previous);
// An unusable/absent snapshot falls through even under --no-fetch: there is
// nothing to keep, so the fetch below runs and fails loudly if it must.
if (noFetch && Number.isFinite(age)) {
  console.log(`[otag] --no-fetch, keeping the committed snapshot (${age.toFixed(1)}d old)`);
  process.exit(0);
}
if (!force && age < MAX_AGE_DAYS) {
  console.log(`[otag] ${dest} is ${age.toFixed(1)}d old (< ${MAX_AGE_DAYS}d), skipping refresh`);
  process.exit(0);
}

let payload;
try {
  payload = await build();
  if (!force) assertNoCollapse(payload, previous);
} catch (err) {
  // A stale corpus beats none: the committed copy ships, and nothing reads the
  // network at runtime.
  if (previous) {
    console.warn(`[otag] Refresh failed (${err.message}), keeping existing index`);
    process.exit(0);
  }
  console.error(`[otag] Refresh failed and no local copy exists: ${err.message}`);
  process.exit(1);
}

const body = `${JSON.stringify(payload)}\n`;
await mkdir(dirname(dest), { recursive: true });
await writeFile(dest, body);
console.log(
  `[otag] Wrote ${dest} — ${payload.tags.length} tags, ` +
    `${Object.keys(payload.cards).length} cards, ${(body.length / 1048576).toFixed(2)} MB`
);
