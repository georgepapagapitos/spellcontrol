#!/usr/bin/env node
// Builds the snapshots behind the Daily card puzzle (/daily, E558):
//
//   backend/data/daily/cards.json  every paper card's scoring attributes, name-keyed:
//                                  colors, mana value, type line, and the rarity and
//                                  year of its FIRST printing. The server scores
//                                  guesses against it.
//   backend/data/daily/pool.json   the answer candidates (well-played, non-land, with
//                                  rules text), each with its clue text. The SERVER
//                                  picks each day's answer from this at runtime and
//                                  stores the pick in Postgres.
//   public/daily-names.json        every card name, for the guess box's suggestions.
//
// No answer is ever written to the repo: it is public, and a committed schedule
// would be readable in git history forever. That is also why nothing here is
// seeded by date.
//
// Source: Scryfall's `default_cards` bulk feed (one row per printing). The
// `oracle_cards` feed shows one chosen printing per card, which is not the first,
// so "first printed" needs every printing.
//
// Auto-invoked by predev; `prebuild` passes --no-fetch so a build keeps the
// committed snapshots and never touches the network. --force rebuilds at any age.
//
// Flags:
//   --force   rebuild unconditionally, bypassing the age check and shrink guard

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BULK_URL = 'https://api.scryfall.com/bulk-data';
const UA = 'SpellControl-DailyRefresh/1.0';
export const MAX_AGE_DAYS = 14;
// Answers come from cards people actually play: EDHREC rank at or under this.
export const POOL_MAX_RANK = 1500;
const MAX_SHRINK_RATIO = 0.2;

export const RARITIES = ['common', 'uncommon', 'rare', 'mythic', 'special'];

// Layouts and set types that aren't cards you'd name in a game of Magic.
const SKIP_LAYOUTS = new Set([
  'token',
  'double_faced_token',
  'emblem',
  'art_series',
  'vanguard',
  'scheme',
  'planar',
  'augment',
  'host',
]);
const SKIP_SET_TYPES = new Set(['token', 'memorabilia', 'funny', 'minigame', 'alchemy']);

/** A printing counts if it's an English paper card from a real set. */
export function isPlayablePrinting(c) {
  if (!c?.oracle_id || !c.name) return false;
  if (c.lang && c.lang !== 'en') return false;
  if (c.digital) return false;
  if (Array.isArray(c.games) && !c.games.includes('paper')) return false;
  if (c.oversized) return false;
  if (SKIP_LAYOUTS.has(c.layout)) return false;
  if (SKIP_SET_TYPES.has(c.set_type)) return false;
  return true;
}

function faces(c) {
  return Array.isArray(c.card_faces) ? c.card_faces : [];
}

/** WUBRG order, as a compact string ("" for colorless). */
export function colorsOf(c) {
  const set = new Set(c.colors ?? faces(c).flatMap((f) => f.colors ?? []));
  return ['W', 'U', 'B', 'R', 'G'].filter((k) => set.has(k)).join('');
}

function oracleTextOf(c) {
  if (typeof c.oracle_text === 'string') return c.oracle_text;
  return faces(c)
    .map((f) => f.oracle_text ?? '')
    .filter(Boolean)
    .join('\n\n');
}

function flavorOf(c) {
  return c.flavor_text ?? faces(c).find((f) => f.flavor_text)?.flavor_text ?? '';
}

function artOf(c) {
  return c.image_uris?.art_crop ?? faces(c)[0]?.image_uris?.art_crop ?? '';
}

/**
 * Sort key for "first printing": the earliest release, with promos losing ties
 * and losing to any non-promo at all. A prerelease promo shares the set's date
 * and often carries a different rarity, so it must never stand in for the set.
 */
function printingKey(c) {
  const promo = c.set_type === 'promo' || c.promo === true ? 1 : 0;
  return `${promo}|${c.released_at ?? '9999-12-31'}`;
}

/**
 * Fold one printing into the per-card map. Card-level fields come from any
 * printing (they're the same across printings); the first-printing fields come
 * from whichever printing sorts first by `printingKey`.
 */
export function foldPrinting(map, c) {
  if (!isPlayablePrinting(c)) return;
  const key = printingKey(c);
  const prev = map.get(c.oracle_id);
  const rank = Number.isFinite(c.edhrec_rank) ? c.edhrec_rank : null;
  if (!prev) {
    map.set(c.oracle_id, {
      name: c.name,
      colors: colorsOf(c),
      mv: Math.round(c.cmc ?? 0),
      typeLine: c.type_line ?? faces(c)[0]?.type_line ?? '',
      oracleText: oracleTextOf(c),
      edhrecRank: rank,
      firstKey: key,
      rarity: c.rarity,
      released: c.released_at ?? '',
      setName: c.set_name ?? '',
      flavor: flavorOf(c),
      art: artOf(c),
    });
    return;
  }
  if (rank !== null && (prev.edhrecRank === null || rank < prev.edhrecRank)) prev.edhrecRank = rank;
  if (key < prev.firstKey) {
    prev.firstKey = key;
    prev.rarity = c.rarity;
    prev.released = c.released_at ?? prev.released;
    prev.setName = c.set_name ?? prev.setName;
    prev.flavor = flavorOf(c) || prev.flavor;
    prev.art = artOf(c) || prev.art;
  }
}

export function rarityIndex(rarity) {
  const i = RARITIES.indexOf(rarity);
  return i === -1 ? RARITIES.indexOf('special') : i;
}

function yearOf(released) {
  const y = Number(String(released).slice(0, 4));
  return Number.isFinite(y) && y > 0 ? y : 0;
}

/**
 * The all-cards index: `cards` rows are [name, colors, mv, typeLine, rarity, year]
 * with rarity an index into `rarities`. One row per name; when two oracle ids
 * share a name, the more-played one wins.
 */
export function buildIndex(map, generatedAt) {
  const byName = new Map();
  for (const card of map.values()) {
    const prev = byName.get(card.name);
    if (!prev || (card.edhrecRank ?? Infinity) < (prev.edhrecRank ?? Infinity)) {
      byName.set(card.name, card);
    }
  }
  const cards = [...byName.values()]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((c) => [c.name, c.colors, c.mv, c.typeLine, rarityIndex(c.rarity), yearOf(c.released)]);
  return { version: 1, generatedAt, rarities: RARITIES, cards };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Hide the card's own name in its rules text. Covers the full name, each face of
 * a two-faced card, and a legend's short name ("Atraxa" for "Atraxa, Praetors'
 * Voice"). A fixed phrase, not a black bar: a bar the length of the name is a clue.
 */
export function redactName(text, name) {
  const names = new Set();
  for (const face of name.split(' // ')) {
    names.add(face);
    const short = face.split(',')[0];
    if (short !== face && short.length >= 3) names.add(short);
  }
  let out = text;
  for (const n of [...names].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(n)}\\b`, 'g'), 'this card');
  }
  return out;
}

/**
 * Candidates for an answer: well-played cards with rules text. No lands: a land
 * is colorless at mana value 0 and belongs to a cycle of near-twins (the gain
 * lands, the guildgates), so its clues can't single it out. Lands stay guessable.
 */
export function buildPool(map) {
  const pool = [];
  for (const c of map.values()) {
    if (c.edhrecRank === null || c.edhrecRank > POOL_MAX_RANK) continue;
    if (!c.oracleText) continue;
    if (/\bLand\b/.test(c.typeLine)) continue;
    pool.push(c);
  }
  return pool.sort((a, b) => a.edhrecRank - b.edhrecRank);
}

/** A pool card as the backend stores it: the attributes plus the clue text. */
export function poolEntry(c) {
  return {
    name: c.name,
    colors: c.colors,
    mv: c.mv,
    typeLine: c.typeLine,
    rarity: RARITIES[rarityIndex(c.rarity)],
    year: yearOf(c.released),
    setName: c.setName,
    rulesText: redactName(c.oracleText, c.name),
    flavor: c.flavor ? redactName(c.flavor, c.name) : '',
    art: c.art,
  };
}

/** backend/data/daily/pool.json: the server picks each day's answer from this at runtime. */
export function buildPoolFile(pool, generatedAt) {
  return { version: 1, generatedAt, cards: pool.map(poolEntry) };
}

/** public/daily-names.json: every card name for the guess box, with no attributes. */
export function buildNames(index, generatedAt) {
  const names = [...new Set(index.cards.map((row) => row[0]))].sort();
  return { version: 1, generatedAt, names };
}

// ── network + files (not unit-tested) ────────────────────────────────────────

async function bulkUri(type) {
  const res = await fetch(BULK_URL, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`bulk-data HTTP ${res.status}`);
  const entry = (await res.json()).data.find((b) => b.type === type);
  if (!entry) throw new Error(`no bulk-data feed of type "${type}"`);
  const uri = entry.jsonl_download_uri ?? entry.download_uri;
  if (!uri) throw new Error(`bulk-data "${type}" has no download uri`);
  return uri;
}

async function* streamJsonl(uri) {
  const res = await fetch(uri, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${uri} HTTP ${res.status}`);
  const lines = createInterface({
    input: Readable.fromWeb(res.body).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of lines) if (line) yield JSON.parse(line);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function ageDays(snapshot) {
  const at = new Date(snapshot?.generatedAt).getTime();
  return Number.isFinite(at) ? (Date.now() - at) / 86_400_000 : Infinity;
}

async function main() {
  const force = process.argv.includes('--force');
  const noFetch = !force && process.argv.includes('--no-fetch');
  const here = dirname(fileURLToPath(import.meta.url));
  const namesDest = resolve(here, '..', 'public', 'daily-names.json');
  const backendDir = resolve(here, '..', '..', 'backend', 'data', 'daily');
  const cardsDest = resolve(backendDir, 'cards.json');
  const poolDest = resolve(backendDir, 'pool.json');

  const prevCards = await readJson(cardsDest);
  const prevPool = await readJson(poolDest);
  const prevNames = await readJson(namesDest);
  const have = !!(prevCards && prevPool && prevNames);
  if (noFetch && have) {
    console.log('[daily] --no-fetch, keeping the committed snapshots');
    return;
  }
  if (!force && have && ageDays(prevCards) < MAX_AGE_DAYS) {
    console.log('[daily] snapshots are fresh, skipping refresh');
    return;
  }

  try {
    console.log('[daily] Streaming default_cards…');
    const map = new Map();
    let rows = 0;
    for await (const c of streamJsonl(await bulkUri('default_cards'))) {
      foldPrinting(map, c);
      rows++;
    }
    const generatedAt = new Date().toISOString();
    const index = buildIndex(map, generatedAt);
    const pool = buildPool(map);
    console.log(
      `[daily]   ${rows} printings → ${index.cards.length} cards, ${pool.length} in the answer pool`
    );
    if (
      !force &&
      prevCards?.cards?.length &&
      index.cards.length < prevCards.cards.length * (1 - MAX_SHRINK_RATIO)
    ) {
      throw new Error(
        `card count collapsed ${prevCards.cards.length} → ${index.cards.length}. Re-run with --force to write anyway.`
      );
    }
    if (pool.length < 500) throw new Error(`answer pool is only ${pool.length} cards`);
    await mkdir(backendDir, { recursive: true });
    const cardsBody = `${JSON.stringify(index)}\n`;
    await writeFile(cardsDest, cardsBody);
    await writeFile(poolDest, `${JSON.stringify(buildPoolFile(pool, generatedAt))}\n`);
    await mkdir(dirname(namesDest), { recursive: true });
    await writeFile(namesDest, `${JSON.stringify(buildNames(index, generatedAt))}\n`);
    console.log(
      `[daily] Wrote ${cardsDest} (${(cardsBody.length / 1048576).toFixed(2)} MB), ${poolDest} and ${namesDest}`
    );
  } catch (err) {
    // A stale snapshot beats none: the committed copies keep working.
    if (have) {
      console.warn(`[daily] Refresh failed (${err.message}), keeping the existing snapshots`);
      return;
    }
    console.error(`[daily] Refresh failed and nothing usable is committed: ${err.message}`);
    process.exit(1);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await main();
