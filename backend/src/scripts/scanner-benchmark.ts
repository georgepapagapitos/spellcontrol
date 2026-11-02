/**
 * Scanner accuracy benchmark CLI. The method is documented in
 * src/scanner/benchmark/README.md and on /guides/scanner-accuracy.html.
 *
 *   tsx src/scripts/scanner-benchmark.ts corpus [--seed N] [--count N] [--drawn N]
 *       Draw a seeded list of cards from the committed pHash index, resolve
 *       names and art on Scryfall, write src/scanner/benchmark/corpus.json.
 *   tsx src/scripts/scanner-benchmark.ts fetch [--fixtures]
 *       Download each corpus card's art_crop into .cache/scanner-bench/.
 *       --fixtures also copies the CI subset into src/scanner/benchmark/fixtures/.
 *   tsx src/scripts/scanner-benchmark.ts run [--cards N] [--stages hash,embedding,pipeline] [--write]
 *       Score the stages. --write stores the numbers in results.json (the page
 *       /guides/scanner-accuracy.html is pinned to that file).
 *
 * Needs the Git LFS embedding index for the embedding and pipeline stages.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../logger';
import { loadHashDbFromFile } from '../scanner/hash-db';
import {
  CORPUS_PATH,
  FIXTURE_DIR,
  RESULTS_PATH,
  drawIds,
  imagePath,
  loadCorpus,
  type Corpus,
  type CorpusCard,
} from '../scanner/benchmark/corpus';
import { CONDITIONS } from '../scanner/benchmark/degrade';
import { fileSourceLoader, hashStage, runBenchmark, type Stage } from '../scanner/benchmark/run';
import {
  DEFAULT_DATA_DIR,
  createHeavyStages,
  embeddingIndexIsReal,
} from '../scanner/benchmark/heavy';

const CACHE_DIR = path.resolve(__dirname, '..', '..', '.cache', 'scanner-bench');
const UA = 'spellcontrol-scanner-benchmark/1.0 (https://spellcontrol.com)';
const GAP_MS = 125; // Scryfall asks for at most ~10 requests a second.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function polite(url: string, init: RequestInit = {}): Promise<Response> {
  const wait = GAP_MS - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  last = Date.now();
  return fetch(url, {
    signal: AbortSignal.timeout(30_000),
    ...init,
    headers: { 'User-Agent': UA, Accept: 'application/json;q=0.9,*/*;q=0.8', ...init.headers },
  });
}

function flag(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

interface ScryCard {
  id: string;
  name: string;
  image_uris?: { art_crop?: string };
  card_faces?: { image_uris?: { art_crop?: string } }[];
}
const artUrl = (c: ScryCard) => c.image_uris?.art_crop ?? c.card_faces?.[0]?.image_uris?.art_crop;

async function collection(ids: string[]): Promise<Map<string, ScryCard>> {
  const out = new Map<string, ScryCard>();
  for (let i = 0; i < ids.length; i += 75) {
    const res = await polite('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: ids.slice(i, i + 75).map((id) => ({ id })) }),
    });
    if (!res.ok) throw new Error(`scryfall collection ${res.status}`);
    for (const c of ((await res.json()) as { data: ScryCard[] }).data) out.set(c.id, c);
  }
  return out;
}

async function cmdCorpus(): Promise<void> {
  const seed = Number(flag('seed', '20261102'));
  const count = Number(flag('count', '200'));
  const drawn = Number(flag('drawn', String(count + 30)));
  const db = await loadHashDbFromFile(path.join(DEFAULT_DATA_DIR, 'card-hashes.bin'));
  const found = await collection(drawIds(db, seed, drawn));
  const cards: CorpusCard[] = [];
  for (const id of drawIds(db, seed, drawn)) {
    const c = found.get(id);
    if (c && artUrl(c) && cards.length < count) cards.push({ id, name: c.name });
  }
  const prior = fs.existsSync(CORPUS_PATH) ? loadCorpus() : null;
  const corpus: Corpus = {
    seed,
    drawn,
    indexRecords: db.recordCount,
    cards,
    gateSize: prior?.gateSize ?? 20,
  };
  fs.writeFileSync(CORPUS_PATH, JSON.stringify(corpus, null, 2) + '\n');
  logger.info(`wrote ${cards.length} cards (${drawn} drawn) to ${CORPUS_PATH}`);
}

async function cmdFetch(): Promise<void> {
  const corpus = loadCorpus();
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const need = corpus.cards.filter((c) => !fs.existsSync(path.join(CACHE_DIR, `${c.id}.jpg`)));
  const found = await collection(need.map((c) => c.id));
  let n = 0;
  for (const card of need) {
    const url = found.get(card.id) && artUrl(found.get(card.id)!);
    if (!url) throw new Error(`no art_crop for ${card.name} (${card.id})`);
    const res = await polite(url, { headers: { Accept: 'image/*' } });
    if (!res.ok) throw new Error(`image ${card.id}: ${res.status}`);
    fs.writeFileSync(path.join(CACHE_DIR, `${card.id}.jpg`), Buffer.from(await res.arrayBuffer()));
    if (++n % 25 === 0) logger.info(`fetched ${n} of ${need.length}`);
  }
  if (has('fixtures')) {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    for (const c of corpus.cards.slice(0, corpus.gateSize)) {
      fs.copyFileSync(path.join(CACHE_DIR, `${c.id}.jpg`), path.join(FIXTURE_DIR, `${c.id}.jpg`));
    }
  }
  logger.info(`cache holds ${corpus.cards.length} images in ${CACHE_DIR}`);
}

async function cmdRun(): Promise<void> {
  const corpus = loadCorpus();
  const cards = corpus.cards.slice(0, Number(flag('cards', String(corpus.cards.length))));
  const want = (flag('stages', 'hash,embedding,pipeline') ?? '').split(',');
  const db = await loadHashDbFromFile(path.join(DEFAULT_DATA_DIR, 'card-hashes.bin'));
  const stages: Stage[] = [];
  let heavy: Awaited<ReturnType<typeof createHeavyStages>> | null = null;
  if (want.includes('hash')) stages.push(hashStage(db));
  if (want.includes('embedding') || want.includes('pipeline')) {
    if (!(await embeddingIndexIsReal(DEFAULT_DATA_DIR))) {
      throw new Error('card-embeddings.bin is a Git LFS pointer; run `git lfs pull` first');
    }
    heavy = await createHeavyStages();
    if (want.includes('embedding')) stages.push(heavy.embedding);
    if (want.includes('pipeline')) stages.push(heavy.pipeline);
  }
  const started = Date.now();
  const report = await runBenchmark({
    cards,
    stages,
    load: fileSourceLoader((id) => imagePath(id, CACHE_DIR)),
    onProgress: (d, t) =>
      d % 10 === 0 && logger.info(`${d}/${t} cards, ${(Date.now() - started) / 1000}s`),
  });
  await heavy?.close();
  const out = {
    meta: {
      seed: corpus.seed,
      cards: cards.length,
      conditions: CONDITIONS.map((c) => c.id),
      indexRecords: db.recordCount,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      date: new Date().toISOString().slice(0, 10),
    },
    ...report,
  };
  logger.info(JSON.stringify(out, null, 2));
  if (has('write')) {
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(out, null, 2) + '\n');
    logger.info(`wrote ${RESULTS_PATH}`);
  }
}

const commands: Record<string, () => Promise<void>> = {
  corpus: cmdCorpus,
  fetch: cmdFetch,
  run: cmdRun,
};
const cmd = commands[process.argv[2] ?? ''];
if (!cmd) {
  logger.error('usage: scanner-benchmark.ts corpus | fetch [--fixtures] | run [--write]');
  process.exit(2);
}
cmd().then(
  () => process.exit(0),
  (err) => {
    logger.error(err);
    process.exit(1);
  }
);
