// The benchmark runner: render synthetic queries, ask each stage which card
// it is, and tally the answers.
//
// A "stage" is one way of answering. The benchmark scores three:
//   hash       the 64-bit perceptual hash alone (what the offline fallback uses)
//   embedding  MobileCLIP cosine search over the whole index, no hash shortlist
//   pipeline   the production matcher, called exactly as the API route calls it

import * as fs from 'node:fs';
import sharp from 'sharp';
import { computePHash, PHASH_INPUT_SIZE } from '../phash';
import { findNearest, type HashDb } from '../hash-db';
import { CONDITIONS, renderQuery, type Condition } from './degrade';
import type { CorpusCard } from './corpus';
import { newTally, score, timingStats, type Tally, type TimingStats } from './metrics';

export interface Answer {
  /** Card ids, best first. */
  ranked: string[];
  /** Pipeline only: how the matcher classified the scan. */
  kind?: 'confident' | 'borderline' | 'miss';
}

export interface Stage {
  name: string;
  predict(image: Buffer): Promise<Answer>;
}

export interface Report {
  /** stage -> condition -> tally */
  stages: Record<string, Record<string, Tally>>;
  /** stage -> wall milliseconds per query, all conditions pooled */
  timing: Record<string, TimingStats>;
}

export async function hashOfImage(image: Buffer): Promise<bigint> {
  const raw = await sharp(image)
    .resize(PHASH_INPUT_SIZE, PHASH_INPUT_SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();
  return computePHash(new Uint8Array(raw.buffer, raw.byteOffset, raw.length));
}

export function hashStage(db: HashDb): Stage {
  return {
    name: 'hash',
    async predict(image) {
      const hits = findNearest(db, await hashOfImage(image), 3);
      return { ranked: hits.map((h) => h.scryfallId) };
    },
  };
}

export type SourceLoader = (card: CorpusCard) => Buffer;

export function fileSourceLoader(pathFor: (id: string) => string | null): SourceLoader {
  return (card) => {
    const p = pathFor(card.id);
    if (!p) throw new Error(`no source image for ${card.name} (${card.id}); run the fetch step`);
    return fs.readFileSync(p);
  };
}

export async function runBenchmark(opts: {
  cards: readonly CorpusCard[];
  stages: readonly Stage[];
  load: SourceLoader;
  conditions?: readonly Condition[];
  onProgress?: (done: number, total: number) => void;
}): Promise<Report> {
  const conditions = opts.conditions ?? CONDITIONS;
  const report: Report = { stages: {}, timing: {} };
  const times: Record<string, number[]> = {};
  for (const s of opts.stages) {
    report.stages[s.name] = {};
    times[s.name] = [];
    for (const c of conditions) report.stages[s.name][c.id] = newTally(s.name === 'pipeline');
  }
  let done = 0;
  for (const card of opts.cards) {
    const source = opts.load(card);
    for (const cond of conditions) {
      const query = await renderQuery(source, cond, card.id);
      for (const stage of opts.stages) {
        const t0 = performance.now();
        const answer = await stage.predict(query);
        times[stage.name].push(performance.now() - t0);
        const tally = report.stages[stage.name][cond.id];
        score(tally, card.id, answer.ranked);
        if (answer.kind) {
          tally[answer.kind]!++;
          if (answer.kind === 'confident' && answer.ranked[0] !== card.id) tally.confidentWrong!++;
        }
      }
    }
    opts.onProgress?.(++done, opts.cards.length);
  }
  for (const s of opts.stages) report.timing[s.name] = timingStats(times[s.name]);
  return report;
}
