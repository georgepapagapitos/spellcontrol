// Shared plumbing for the card-facts scripts (refresh-card-facts.mjs,
// card-facts-llm.mjs, card-facts-eval.mjs): the Scryfall bulk download and
// cache, the commander-legal universe filter, and loading the TypeScript
// extractor from src/ with Vite's module runner so the scripts and the app run
// the exact same code.

import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// node_modules/.cache is the conventional, already-gitignored home for build
// caches; the ~25 MB bulk file never lands in the repo.
export const CACHE_DIR = join(FRONTEND, 'node_modules', '.cache', 'card-facts');
const BULK_INDEX = 'https://api.scryfall.com/bulk-data';
// Scryfall requires a User-Agent and an Accept header on API requests.
const HEADERS = { 'User-Agent': 'SpellControl-CardFacts/1.0', Accept: 'application/json' };

/** Resolve the current oracle_cards feed: its download URI and updated_at. */
export async function latestBulk() {
  const res = await fetch(BULK_INDEX, { headers: HEADERS });
  if (!res.ok) throw new Error(`bulk-data HTTP ${res.status}`);
  const entry = (await res.json()).data.find((b) => b.type === 'oracle_cards');
  if (!entry) throw new Error('no oracle_cards bulk feed');
  const uri = entry.jsonl_download_uri ?? entry.download_uri;
  return { uri, updatedAt: new Date(entry.updated_at).toISOString(), file: uri.split('/').pop() };
}

/**
 * The oracle_cards file on disk: `explicit` when given (reproducible rebuilds
 * from a pinned file), else the cached copy of the current feed, downloading
 * it once (one request) when the cache doesn't have it.
 */
export async function ensureBulk({ explicit, offline } = {}) {
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`bulk file not found: ${explicit}`);
    return {
      path: explicit,
      updatedAt: bulkDateFromName(explicit),
      file: explicit.split(/[\\/]/).pop(),
    };
  }
  await mkdir(CACHE_DIR, { recursive: true });
  if (offline) {
    const cached = await newestCached();
    if (!cached) throw new Error('offline and no cached oracle_cards file');
    return cached;
  }
  const bulk = await latestBulk();
  const path = join(CACHE_DIR, bulk.file);
  if (!existsSync(path)) {
    console.log(`[card-facts] Downloading ${bulk.file}`);
    const res = await fetch(bulk.uri, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
    if (!res.ok) throw new Error(`${bulk.uri} HTTP ${res.status}`);
    const tmp = `${path}.part`;
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    await rename(tmp, path);
  }
  return { path, updatedAt: bulk.updatedAt, file: bulk.file };
}

async function newestCached() {
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(CACHE_DIR))
    .filter((f) => /^oracle-cards-\d+\.jsonl\.gz$/.test(f))
    .sort();
  const file = files.at(-1);
  return file ? { path: join(CACHE_DIR, file), updatedAt: bulkDateFromName(file), file } : null;
}

/** "oracle-cards-20260929090156.jsonl.gz" → "2026-09-29T09:01:56.000Z". */
export function bulkDateFromName(name) {
  const m = name.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m) throw new Error(`can't read a date from ${name}`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString();
}

/** Stream a gzipped JSONL bulk file, one card object at a time. */
export async function* streamBulk(path) {
  const lines = createInterface({
    input: createReadStream(path).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of lines) if (line) yield JSON.parse(line);
}

/**
 * The universe: commander-legal cards. Scryfall marks digital-only cards (Alchemy,
 * Arena-only) not_legal in Commander, so this is the paper-legal set. (The
 * oracle_cards record's `games` describes ONE chosen printing, not the card:
 * Wheel of Fortune's is an MTGO-only printing, so a `games` filter would drop it.)
 */
export const inUniverse = (card) => card.legalities?.commander === 'legal';

/** The Scryfall fields the extractor reads (schema.ts FactsInputCard). */
export function toInput(c) {
  const rec = {
    oracle_id: c.oracle_id,
    name: c.name,
    layout: c.layout,
    type_line: c.type_line,
    mana_cost: c.mana_cost,
    oracle_text: c.oracle_text,
    keywords: c.keywords,
    loyalty: c.loyalty,
    power: c.power,
    toughness: c.toughness,
    cmc: c.cmc,
  };
  if (c.card_faces)
    rec.card_faces = c.card_faces.map((f) => {
      const face = {
        name: f.name,
        type_line: f.type_line,
        mana_cost: f.mana_cost,
        oracle_text: f.oracle_text,
        loyalty: f.loyalty,
        power: f.power,
        toughness: f.toughness,
      };
      for (const k of Object.keys(face)) if (face[k] === undefined) delete face[k];
      return face;
    });
  for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
  return rec;
}

/** name → tagger tags, from the committed tagger-tags.json. */
export async function loadTagger() {
  const data = JSON.parse(await readFile(join(FRONTEND, 'public', 'tagger-tags.json'), 'utf8'));
  const byName = new Map();
  for (const [tag, names] of Object.entries(data.tags)) {
    for (const name of names) {
      let list = byName.get(name);
      if (!list) byName.set(name, (list = []));
      list.push(tag);
    }
  }
  return { generatedAt: data.generatedAt, byName };
}

/**
 * Import TypeScript modules from src/ through Vite's module runner. The shared
 * packages are aliased to their sources: their ESM dist is bundler-only
 * (no "type": "module"), which Node's loader rejects.
 */
export async function importSrc(...relPaths) {
  const { runnerImport } = await import('vite');
  const config = {
    configFile: false,
    root: FRONTEND,
    logLevel: 'error',
    resolve: {
      alias: {
        '@spellcontrol/deck-metrics': join(
          FRONTEND,
          '..',
          'packages',
          'deck-metrics',
          'src',
          'index.ts'
        ),
        '@': join(FRONTEND, 'src'),
      },
    },
  };
  const out = [];
  for (const rel of relPaths)
    out.push((await runnerImport(join(FRONTEND, 'src', rel), config)).module);
  return out;
}

/** Write a file atomically (tmp + rename) so an interrupted run never leaves half a file. */
export async function writeAtomic(path, body) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, body);
  await rename(tmp, path);
}
