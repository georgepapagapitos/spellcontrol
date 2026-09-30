#!/usr/bin/env node
// Builds the two snapshots behind the Daily card puzzle (/daily, E558):
//
//   public/daily-cards.json     every paper card's scoring attributes, name-keyed:
//                               colours, mana value, type line, and the rarity and
//                               year of its FIRST printing. Scores a guess and feeds
//                               the name suggestions, with no network at play time.
//   public/daily-schedule.json  one frozen puzzle per UTC day. An entry is written
//                               once and never rewritten, so a refresh can't change
//                               a day that is already live (or one someone played).
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
// The schedule must always reach this far ahead; a refresh tops it up to
// HORIZON_DAYS. With the weekly refresh workflow that leaves months of slack.
export const MIN_AHEAD_DAYS = 60;
export const HORIZON_DAYS = 120;
// Answers come from cards people actually play: EDHREC rank at or under this.
export const POOL_MAX_RANK = 1500;
// A card isn't the answer again within this many days.
export const REPEAT_GAP_DAYS = 365;
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

/** WUBRG order, as a compact string ("" for colourless). */
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
 * is colourless at mana value 0 and belongs to a cycle of near-twins (the gain
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

export function puzzleEntry(c, date, number) {
  return {
    date,
    number,
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

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** mulberry32: a small seeded PRNG, so a given schedule state picks the same way. */
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(date) {
  let h = 2166136261;
  for (const ch of date) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/**
 * Top the schedule up so it covers `today` through `today + HORIZON_DAYS`.
 * Existing entries are never touched, including past ones. Each new day's answer
 * is drawn (seeded by its date) from pool cards not used in the REPEAT_GAP_DAYS
 * before it. Puzzle numbers count days from the schedule's epoch, starting at 1.
 */
export function extendSchedule(previous, pool, today) {
  const epoch = previous?.epoch ?? today;
  const puzzles = [...(previous?.puzzles ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  const byDate = new Map(puzzles.map((p) => [p.date, p]));
  if (pool.length === 0) return { epoch, puzzles, added: 0 };
  let added = 0;
  const start = today < epoch ? epoch : today;
  for (let i = 0; i <= HORIZON_DAYS; i++) {
    const date = addDays(start, i);
    if (byDate.has(date)) continue;
    const since = addDays(date, -REPEAT_GAP_DAYS);
    const recent = new Set();
    for (const p of byDate.values()) if (p.date >= since && p.date < date) recent.add(p.name);
    const fresh = pool.filter((c) => !recent.has(c.name));
    const from = fresh.length > 0 ? fresh : pool;
    const pick = from[Math.floor(rng(seedOf(date))() * from.length)];
    byDate.set(date, puzzleEntry(pick, date, daysBetween(epoch, date) + 1));
    added++;
  }
  const out = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  return { epoch, puzzles: out, added };
}

/** Days of schedule left from `today` (0 when today itself is missing). */
export function daysAhead(schedule, today) {
  const last = schedule?.puzzles?.at(-1)?.date;
  if (!last || last < today) return 0;
  return daysBetween(today, last);
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
  const cardsDest = resolve(here, '..', 'public', 'daily-cards.json');
  const scheduleDest = resolve(here, '..', 'public', 'daily-schedule.json');
  const today = new Date().toISOString().slice(0, 10);

  const prevCards = await readJson(cardsDest);
  const prevSchedule = await readJson(scheduleDest);
  const fresh =
    ageDays(prevCards) < MAX_AGE_DAYS && daysAhead(prevSchedule, today) >= MIN_AHEAD_DAYS;
  if (noFetch && prevCards && prevSchedule) {
    console.log('[daily] --no-fetch, keeping the committed snapshots');
    return;
  }
  if (!force && fresh) {
    console.log(
      '[daily] snapshots are fresh and the schedule runs far enough ahead, skipping refresh'
    );
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
    const { epoch, puzzles, added } = extendSchedule(prevSchedule, pool, today);
    const schedule = { version: 1, generatedAt, epoch, puzzles };
    await mkdir(dirname(cardsDest), { recursive: true });
    const cardsBody = `${JSON.stringify(index)}\n`;
    await writeFile(cardsDest, cardsBody);
    await writeFile(scheduleDest, `${JSON.stringify(schedule, null, 1)}\n`);
    console.log(
      `[daily] Wrote ${cardsDest} (${(cardsBody.length / 1048576).toFixed(2)} MB) and ` +
        `${scheduleDest} (+${added} days, ${puzzles.length} total, through ${puzzles.at(-1)?.date})`
    );
  } catch (err) {
    // A stale snapshot beats none, as long as today still has a puzzle.
    if (prevCards && daysAhead(prevSchedule, today) > 0) {
      console.warn(`[daily] Refresh failed (${err.message}), keeping the existing snapshots`);
      return;
    }
    console.error(`[daily] Refresh failed and nothing usable is committed: ${err.message}`);
    process.exit(1);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await main();
