// The benchmark corpus: which cards are queried.
//
// `corpus.json` is the published list. It was drawn from the committed pHash
// index with a seeded generator, so anyone with the index can re-draw it and
// anyone without can fetch the same cards by id.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { HashDb } from '../hash-db';
import { mulberry32 } from './rng';

export interface CorpusCard {
  id: string;
  name: string;
}

export interface Corpus {
  /** PRNG seed the positions were drawn with (mulberry32). */
  seed: number;
  /** How many positions were drawn per card kept: ids that no longer resolve are skipped. */
  drawn: number;
  /** Record count of the pHash index the draw was made against. */
  indexRecords: number;
  /** Cards queried, in draw order. The CI subset is a prefix of this list. */
  cards: CorpusCard[];
  /** Length of the prefix the CI regression gate runs (fixtures/ holds their images). */
  gateSize: number;
}

export const BENCHMARK_DIR = __dirname;
export const FIXTURE_DIR = path.join(BENCHMARK_DIR, 'fixtures');
export const CORPUS_PATH = path.join(BENCHMARK_DIR, 'corpus.json');
export const RESULTS_PATH = path.join(BENCHMARK_DIR, 'results.json');

export function loadCorpus(file: string = CORPUS_PATH): Corpus {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Corpus;
}

export function uuidAt(db: HashDb, i: number): string {
  const h = Buffer.from(db.uuids.subarray(i * 16, i * 16 + 16)).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Draw `count` distinct card ids from the index, in a seeded order. */
export function drawIds(db: HashDb, seed: number, count: number): string[] {
  if (count > db.recordCount) throw new Error(`cannot draw ${count} of ${db.recordCount}`);
  const rnd = mulberry32(seed);
  const picked = new Set<number>();
  while (picked.size < count) picked.add(Math.floor(rnd() * db.recordCount));
  return [...picked].map((i) => uuidAt(db, i));
}

/** Where the benchmark looks for a card's source image: the committed fixtures, then the fetch cache. */
export function imagePath(id: string, cacheDir: string): string | null {
  for (const dir of [FIXTURE_DIR, cacheDir]) {
    const p = path.join(dir, `${id}.jpg`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
