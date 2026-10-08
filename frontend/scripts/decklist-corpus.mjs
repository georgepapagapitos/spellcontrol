#!/usr/bin/env node
// Builds the decklist corpus for E516 (learned objective weights) and E517
// slice C (co-occurrence) from the sources the user permitted on 2026-10-08:
//
//   edhrec        EDHREC average decks (json.edhrec.com/pages/average-decks),
//                 the same public JSON the app already reads. robots.txt
//                 disallows only /deckpreview/ and a few article paths.
//   edhtop16      EDHTop16's public GraphQL API (edhtop16.com/api/graphql):
//                 no key, robots.txt `Disallow:` (nothing), advertises an API
//                 "for developers and data enthusiasts". Top-cut lists only.
//   spellcontrol  first-party published decks and the official precon shelf,
//                 read through the same anonymous /api/discover/decks the
//                 Discover page uses. Owner fields are dropped on read.
//
// NOT used: Archidekt, Moxfield (their terms forbid automated access), and
// TopDeck.gg's own API (needs an account-bound key; EDHTop16 is sponsored by
// it and already carries the same top-cut lists).
//
//   node scripts/decklist-corpus.mjs edhrec --top 100 --brackets 0,3
//   node scripts/decklist-corpus.mjs edhtop16 --tournaments 40 --top-cut 16
//   node scripts/decklist-corpus.mjs spellcontrol
//   node scripts/decklist-corpus.mjs pages --commanders 150   (EDHREC pages for the rest)
//   node scripts/decklist-corpus.mjs cooccurrence
//
// `edhrec` and `pages` call EDHREC live and MUST run under the shared lock:
//   bash .claude/skills/deckgen-eval-gate/scripts/live-lock.sh e516 node scripts/decklist-corpus.mjs edhrec ...
// It refuses to start without the lock directory. Every EDHREC response also
// lands in the shared HTTP cache, so the objective scripts replay it offline.
//
// Raw data stays OUT of the repo: --corpus <dir> (default
// C:/Users/georg/dev/.decklist-corpus). Politeness: one request a second to
// EDHREC, 1.5 s to EDHTop16 and SpellControl, resumable, cached.

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DEFAULT_HTTP_CACHE,
  DEV_ROOT,
  LOCK,
  installNetwork,
  loadHarness,
} from './deck-objective-lib.mjs';
import {
  cooccurrence,
  dedupeDecks,
  edhrecAverageDeck,
  edhtop16Decks,
  straight,
  tally,
} from './decklist-corpus-lib.mjs';

const argv = process.argv.slice(2);
const command = argv[0];
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const CORPUS = resolve(opt('--corpus', join(DEV_ROOT, '.decklist-corpus')));
mkdirSync(join(CORPUS, 'raw'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'SpellControl-DecklistCorpus/1.0 (offline research; contact via spellcontrol.com)';

const readJsonl = (file) =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
const writeJsonl = (file, rows) =>
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));

// ── EDHREC average decks ───────────────────────────────────────────────────
async function runEdhrec() {
  if (!existsSync(LOCK)) {
    console.error('edhrec calls EDHREC live: run it under live-lock.sh (see the header).');
    process.exit(2);
  }
  const top = Number(opt('--top', '100'));
  const brackets = opt('--brackets', '0,3').split(',').map(Number);
  const net = installNetwork({
    httpCache: DEFAULT_HTTP_CACHE,
    live: true,
    owner: 'decklist-corpus',
    lockedByCaller: true,
    delayMs: 1000,
  });
  const H = await loadHarness();
  const out = join(CORPUS, 'edhrec-average.jsonl');
  const have = readJsonl(out);
  const done = new Set(have.map((d) => `${d.commander}|${d.bracket}`));

  const year = await (await fetch('https://json.edhrec.com/pages/commanders/year.json')).json();
  const views = year.container.json_dict.cardlists.flatMap((l) => l.cardviews);
  const commanders = views
    .filter((v) => v.name && !v.name.includes(' // '))
    .slice(0, top)
    .map((v) => v.name);
  console.log(`[edhrec] ${commanders.length} commanders x brackets ${brackets.join(',')}`);

  const SUFFIX = {
    0: '',
    1: '/exhibition',
    2: '/core',
    3: '/upgraded',
    4: '/optimized',
    5: '/cedh',
  };
  for (const name of commanders) {
    const slug = H.formatCommanderNameForUrl(name);
    for (const b of brackets) {
      if (done.has(`${name}|${b}`)) continue;
      try {
        const res = await fetch(
          `https://json.edhrec.com/pages/average-decks/${slug}${SUFFIX[b]}.json`,
          { headers: { Accept: 'application/json', 'User-Agent': UA } }
        );
        if (!res.ok) continue;
        const deck = edhrecAverageDeck(await res.json(), { bracket: b });
        if (!deck) continue;
        // The commander page the deck is scored against; lands in the HTTP cache.
        await H.fetchCommanderData(name, undefined, b === 0 ? undefined : b);
        appendFileSync(out, JSON.stringify(deck) + '\n');
      } catch (e) {
        console.warn(`[edhrec] ${name} b${b}: ${e.message}`);
      }
    }
  }
  console.log(`[edhrec] done; ${readJsonl(out).length} decks; ${JSON.stringify(net.stats)}`);
}

// ── Commander pages for the tournament and SpellControl decks ─────────────
async function runPages() {
  if (!existsSync(LOCK)) {
    console.error('pages calls EDHREC live: run it under live-lock.sh (see the header).');
    process.exit(2);
  }
  const limit = Number(opt('--commanders', '150'));
  installNetwork({
    httpCache: DEFAULT_HTTP_CACHE,
    live: true,
    owner: 'decklist-corpus',
    lockedByCaller: true,
    delayMs: 1000,
  });
  const H = await loadHarness();
  const decks = ['edhtop16', 'spellcontrol'].flatMap((f) => readJsonl(join(CORPUS, `${f}.jsonl`)));
  const count = new Map();
  for (const d of decks) count.set(d.commander, (count.get(d.commander) ?? 0) + 1);
  const names = [...count]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([n]) => n);
  let ok = 0;
  for (const name of names) {
    for (const bracket of [undefined, 5]) {
      try {
        await H.fetchCommanderData(name, undefined, bracket);
        ok++;
      } catch (e) {
        // A commander with no cEDH page (404) falls back to its base page when scored.
        if (bracket === undefined) console.warn(`[pages] ${name}: ${e.message}`);
      }
    }
  }
  console.log(`[pages] ${names.length} commanders, ${ok} pages read`);
}

// ── EDHTop16 ───────────────────────────────────────────────────────────────
const TOURNAMENTS_QUERY = `query($after: String, $first: Int!, $minSize: Int, $top: Int) {
  tournaments(first: $first, after: $after, sortBy: DATE, filters: { minSize: $minSize }) {
    pageInfo { hasNextPage endCursor }
    edges { node { TID size tournamentDate entries(maxStanding: $top) {
      standing commander { name } maindeck { name } } } }
  }
}`;

async function runEdhtop16() {
  const want = Number(opt('--tournaments', '40'));
  const top = Number(opt('--top-cut', '16'));
  const minSize = Number(opt('--min-size', '40'));
  const out = join(CORPUS, 'edhtop16.jsonl');
  let after = null;
  let seen = 0;
  const decks = [];
  while (seen < want) {
    const cacheFile = join(
      CORPUS,
      'raw',
      `edhtop16-${minSize}-${top}-${after ?? 'first'}.json`.replace(/[^\w.-]/g, '_')
    );
    let page;
    if (existsSync(cacheFile)) page = JSON.parse(readFileSync(cacheFile, 'utf8'));
    else {
      await sleep(1500);
      const res = await fetch('https://edhtop16.com/api/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({
          query: TOURNAMENTS_QUERY,
          variables: { after, first: 5, minSize, top },
        }),
      });
      if (!res.ok) throw new Error(`edhtop16 HTTP ${res.status}`);
      page = await res.json();
      if (page.errors) throw new Error(JSON.stringify(page.errors).slice(0, 300));
      writeFileSync(cacheFile, JSON.stringify(page));
    }
    const conn = page.data.tournaments;
    for (const { node } of conn.edges) {
      decks.push(...edhtop16Decks(node));
      seen++;
    }
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  const unique = dedupeDecks(decks);
  writeJsonl(out, unique);
  console.log(
    `[edhtop16] ${seen} tournaments, ${unique.length} decks (${decks.length} before dedupe)`
  );
}

// ── SpellControl public decks ──────────────────────────────────────────────
async function runSpellcontrol() {
  const base = opt('--base', 'https://spellcontrol.com');
  const rows = [];
  for (const [source, query] of [
    ['spellcontrol-public', ''],
    ['spellcontrol-precons', '&source=precons'],
  ]) {
    for (let page = 1; page <= 20; page++) {
      await sleep(1500);
      const res = await fetch(`${base}/api/discover/decks?pageSize=48&page=${page}${query}`, {
        headers: { 'User-Agent': UA },
      });
      if (!res.ok) throw new Error(`discover HTTP ${res.status}`);
      const body = await res.json();
      for (const d of body.decks)
        rows.push({
          source,
          commander: d.commanderName,
          format: d.format,
          colorIdentity: d.colorIdentity,
          bracket: d.bracket ?? d.estimatedBracket ?? 0,
          oracleIds: d.cardOracleIds,
        });
      if (!body.hasMore) break;
    }
  }
  // oracle ids -> names, one pass over the bulk file; owner fields were never kept.
  const wanted = new Set(rows.flatMap((r) => r.oracleIds));
  const { streamBulk, ensureBulk } = await import('./card-facts-lib.mjs');
  const bulk = await ensureBulk({ explicit: opt('--bulk'), offline: true });
  const names = new Map();
  for await (const c of streamBulk(bulk.path))
    if (wanted.has(c.oracle_id)) names.set(c.oracle_id, c.name);
  const decks = [];
  for (const r of rows) {
    if (r.format !== 'commander' || !r.commander) continue;
    const cards = tally(r.oracleIds.map((id) => names.get(id)).filter(Boolean));
    if (cards.length < 65) continue;
    decks.push({
      source: r.source,
      commander: straight(r.commander),
      partner: null,
      bracket: r.bracket,
      weight: 1,
      colorIdentity: r.colorIdentity,
      cards: cards.filter((c) => c.name !== straight(r.commander)),
    });
  }
  const unique = dedupeDecks(decks);
  writeJsonl(join(CORPUS, 'spellcontrol.jsonl'), unique);
  const by = {};
  for (const d of unique) by[d.source] = (by[d.source] ?? 0) + 1;
  console.log(
    `[spellcontrol] ${rows.length} listed, ${unique.length} usable ${JSON.stringify(by)}`
  );
}

// ── Co-occurrence artifact (E517 slice C) ──────────────────────────────────
function runCooccurrence() {
  const all = ['edhrec-average', 'edhtop16', 'spellcontrol'].flatMap((f) =>
    readJsonl(join(CORPUS, `${f}.jsonl`))
  );
  const minDecks = Number(opt('--min-decks', '3'));
  const minPair = Number(opt('--min-pair', '2'));
  const co = cooccurrence(all, { minDecks, minPair });
  const file = join(CORPUS, 'cooccurrence.json');
  writeFileSync(file, JSON.stringify(co));
  const commanders = new Set(all.map((d) => d.commander));
  console.log(
    `[cooccurrence] ${co.deckCount} decks, ${commanders.size} commanders, ${co.cards.length} cards, ` +
      `${co.pairs.length} pairs (min ${minDecks} decks per card, ${minPair} per pair) -> ${file} ` +
      `${(JSON.stringify(co).length / 1e6).toFixed(1)} MB`
  );
}

const commands = {
  edhrec: runEdhrec,
  pages: runPages,
  edhtop16: runEdhtop16,
  spellcontrol: runSpellcontrol,
  cooccurrence: runCooccurrence,
};
if (!commands[command]) {
  console.error(`usage: decklist-corpus.mjs ${Object.keys(commands).join('|')} [options]`);
  process.exit(2);
}
await commands[command]();
