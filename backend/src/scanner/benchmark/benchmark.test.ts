// Guards for the scanner accuracy benchmark.
//
// 1. The pieces are deterministic (seeded corpus, seeded degradations), so a
//    published number can be reproduced.
// 2. The CI regression gate: a fixed 20-card subset, scored by the pHash stage
//    (no Git LFS needed), must keep its accuracy per condition.
// 3. The opt-in gate (SCANNER_BENCH_PIPELINE=1, run by the Scanner Benchmark
//    workflow) holds the same subset to the production matcher.
// 4. The public page prints exactly the numbers in results.json.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadHashDbFromFile } from '../hash-db';
import {
  CORPUS_PATH,
  FIXTURE_DIR,
  RESULTS_PATH,
  drawIds,
  imagePath,
  loadCorpus,
  uuidAt,
} from './corpus';
import {
  CONDITIONS,
  addNoise,
  decodeRaw,
  glare,
  occlude,
  perspective,
  renderQuery,
  solveHomography,
  type RawImage,
} from './degrade';
import { fraction, newTally, percentile, score, timingStats } from './metrics';
import { gaussian, mulberry32, seedFromString } from './rng';
import { fileSourceLoader, hashOfImage, hashStage, runBenchmark } from './run';
import { DEFAULT_DATA_DIR, embeddingIndexIsReal } from './heavy';

const corpus = loadCorpus();
const gateCards = corpus.cards.slice(0, corpus.gateSize);

function flat(w: number, h: number, v: number): RawImage {
  return { data: new Uint8Array(w * h * 3).fill(v), width: w, height: h };
}

function gradient(w: number, h: number): RawImage {
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      data[i] = (x * 255) / (w - 1);
      data[i + 1] = (y * 255) / (h - 1);
      data[i + 2] = 90;
    }
  }
  return { data, width: w, height: h };
}

describe('seeded randomness', () => {
  it('replays the same stream from the same seed', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(8)()).not.toBe(mulberry32(7)());
  });

  it('seeds per string and keeps gaussian samples centered', () => {
    expect(seedFromString('a:glare')).not.toBe(seedFromString('a:blur'));
    const rnd = mulberry32(1);
    let sum = 0;
    for (let i = 0; i < 4000; i++) sum += gaussian(rnd);
    expect(Math.abs(sum / 4000)).toBeLessThan(0.1);
  });
});

describe('corpus manifest', () => {
  it('lists distinct cards and a gate prefix that has its images committed', () => {
    expect(corpus.cards.length).toBeGreaterThanOrEqual(200);
    expect(new Set(corpus.cards.map((c) => c.id)).size).toBe(corpus.cards.length);
    expect(corpus.gateSize).toBeLessThanOrEqual(corpus.cards.length);
    const committed = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.jpg'));
    expect(committed.sort()).toEqual(gateCards.map((c) => `${c.id}.jpg`).sort());
    expect(path.dirname(CORPUS_PATH)).toBe(path.dirname(FIXTURE_DIR));
  });

  it('draws only cards the committed hash index holds, in the published order', async () => {
    const db = await loadHashDbFromFile(path.join(DEFAULT_DATA_DIR, 'card-hashes.bin'));
    const known = new Set(Array.from({ length: db.recordCount }, (_, i) => uuidAt(db, i)));
    expect(corpus.cards.filter((c) => !known.has(c.id))).toEqual([]);
    const a = drawIds(db, 1, 25);
    expect(a).toEqual(drawIds(db, 1, 25));
    expect(new Set(a).size).toBe(25);
    expect(drawIds(db, 2, 25)).not.toEqual(a);
    expect(() => drawIds(db, 1, db.recordCount + 1)).toThrow(/cannot draw/);
  });
});

describe('degradations', () => {
  it('solves the identity and a translation homography', () => {
    const sq = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ] as const;
    const I = solveHomography(sq, sq);
    expect(I.map((x) => Math.round(x * 1e6) / 1e6)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const moved = sq.map(([x, y]) => [x + 3, y - 2] as const);
    const T = solveHomography(sq, moved);
    expect(T[2]).toBeCloseTo(3, 6);
    expect(T[5]).toBeCloseTo(-2, 6);
  });

  it('perspective: zero amount keeps the image, a real amount moves it', () => {
    const img = gradient(40, 30);
    expect(Array.from(perspective(img, mulberry32(1), 0).data)).toEqual(Array.from(img.data));
    const warped = perspective(img, mulberry32(1), 0.08);
    expect(warped.width).toBe(40);
    expect(Array.from(warped.data)).not.toEqual(Array.from(img.data));
  });

  it('glare only brightens, and only near its center', () => {
    const img = flat(60, 40, 100);
    const out = glare(img, mulberry32(3), { strength: 0.9, radius: 0.3 });
    let brighter = 0;
    for (let i = 0; i < out.data.length; i++) {
      expect(out.data[i]).toBeGreaterThanOrEqual(100);
      if (out.data[i] > 100) brighter++;
    }
    expect(brighter).toBeGreaterThan(0);
    expect(brighter).toBeLessThan(out.data.length / 2);
  });

  it('occlusion hides the requested share of the area', () => {
    const img = flat(50, 50, 200);
    const out = occlude(img, mulberry32(5), 0.2);
    let covered = 0;
    for (let i = 0; i < out.data.length; i += 3) if (out.data[i] !== 200) covered++;
    expect(covered / (50 * 50)).toBeCloseTo(0.2, 2);
  });

  it('noise stays in range and is zero-mean', () => {
    const out = addNoise(flat(80, 80, 128), mulberry32(9), 14);
    let sum = 0;
    for (const v of out.data) sum += v;
    expect(Math.abs(sum / out.data.length - 128)).toBeLessThan(1);
    expect(addNoise(flat(2, 2, 255), mulberry32(9), 30).data.every((v) => v <= 255)).toBe(true);
  });

  it('renders each query the same way twice, differently per condition', async () => {
    const id = gateCards[0].id;
    const src = fs.readFileSync(imagePath(id, '')!);
    const first = await renderQuery(
      src,
      CONDITIONS.find((c) => c.id === 'combined')!,
      id
    );
    const again = await renderQuery(
      src,
      CONDITIONS.find((c) => c.id === 'combined')!,
      id
    );
    expect(first.equals(again)).toBe(true);
    const other = await renderQuery(
      src,
      CONDITIONS.find((c) => c.id === 'glare')!,
      id
    );
    expect(other.equals(first)).toBe(false);
    const clean = await renderQuery(src, CONDITIONS[0], id);
    expect(clean.equals(src)).toBe(true);
    const size = await decodeRaw(first);
    const orig = await decodeRaw(src);
    expect([size.width, size.height]).toEqual([orig.width, orig.height]);
  });

  it('documents every condition', () => {
    expect(CONDITIONS[0].id).toBe('clean');
    for (const c of CONDITIONS) expect(c.doc.length).toBeGreaterThan(30);
    expect(new Set(CONDITIONS.map((c) => c.id)).size).toBe(CONDITIONS.length);
  });
});

describe('scoring', () => {
  it('counts top-1 and top-3 and the pipeline classes', () => {
    const t = newTally(true);
    score(t, 'a', ['a', 'b']);
    score(t, 'a', ['b', 'c', 'a']);
    score(t, 'a', ['b', 'c', 'd', 'a']);
    expect([t.n, t.top1, t.top3]).toEqual([3, 1, 2]);
    expect(t.confidentWrong).toBe(0);
    expect(newTally(false).confident).toBeUndefined();
  });

  it('summarizes timings and formats fractions', () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([5, 1, 3], 0.5)).toBe(3);
    expect(timingStats([10, 20, 30, 40])).toEqual({ n: 4, p50: 30, p95: 40, max: 40 });
    expect(timingStats([]).max).toBe(0);
    expect(fraction(172, 200)).toBe('172 of 200 (86.0%)');
    expect(fraction(0, 0)).toBe('0 of 0 (0.0%)');
  });
});

const load = fileSourceLoader((id) => imagePath(id, ''));

describe('CI regression gate: pHash on the fixed subset', () => {
  // Measured 2026-11-02 on the 20 committed cards: clean 20, perspective 17,
  // blur 20, glare 10, noise 20, occlusion 19, combined 7. The floors leave
  // two cards of room for encoder differences between machines. A change that
  // breaks hashing (size, grayscale, DCT, index layout) drops "clean" first.
  const FLOORS: Record<string, number> = {
    clean: 20,
    perspective: 15,
    blur: 18,
    glare: 8,
    noise: 18,
    occlusion: 17,
    combined: 5,
  };

  it('keeps top-1 accuracy per condition', async () => {
    const db = await loadHashDbFromFile(path.join(DEFAULT_DATA_DIR, 'card-hashes.bin'));
    const report = await runBenchmark({ cards: gateCards, stages: [hashStage(db)], load });
    const cells = report.stages.hash;
    for (const c of CONDITIONS) {
      expect(cells[c.id].n).toBe(gateCards.length);
      expect(cells[c.id].top1, `${c.id} top-1`).toBeGreaterThanOrEqual(FLOORS[c.id]);
      expect(cells[c.id].top3).toBeGreaterThanOrEqual(cells[c.id].top1);
    }
    expect(report.timing.hash.n).toBe(gateCards.length * CONDITIONS.length);
  }, 90_000);

  it('hashes a committed image to the hash the index holds', async () => {
    const db = await loadHashDbFromFile(path.join(DEFAULT_DATA_DIR, 'card-hashes.bin'));
    const card = gateCards[0];
    const hash = await hashOfImage(load(card));
    const hits = await hashStage(db).predict(load(card));
    expect(hits.ranked[0]).toBe(card.id);
    expect(typeof hash).toBe('bigint');
  });
});

describe.skipIf(!process.env.SCANNER_BENCH_PIPELINE)(
  'opt-in gate: production matcher on the fixed subset',
  () => {
    // Measured 2026-11-02: pipeline top-1 20/20 on clean, perspective, blur,
    // glare and noise; 19 on occlusion; 13 on combined.
    const FLOORS: Record<string, number> = {
      clean: 20,
      perspective: 18,
      blur: 18,
      glare: 18,
      noise: 18,
      occlusion: 17,
      combined: 10,
    };

    it('keeps top-1 accuracy per condition, and does not grow false confidence', async () => {
      expect(await embeddingIndexIsReal(DEFAULT_DATA_DIR)).toBe(true);
      const { createHeavyStages } = await import('./heavy');
      const heavy = await createHeavyStages();
      try {
        const report = await runBenchmark({ cards: gateCards, stages: [heavy.pipeline], load });
        let confidentWrong = 0;
        for (const c of CONDITIONS) {
          const cell = report.stages.pipeline[c.id];
          expect(cell.top1, `${c.id} top-1`).toBeGreaterThanOrEqual(FLOORS[c.id]);
          confidentWrong += cell.confidentWrong ?? 0;
        }
        expect(confidentWrong).toBeLessThanOrEqual(2);
      } finally {
        await heavy.close();
      }
    }, 300_000);
  }
);

describe('published results', () => {
  it('results.json describes the committed corpus', () => {
    const results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
    expect(results.meta.seed).toBe(corpus.seed);
    expect(results.meta.cards).toBe(corpus.cards.length);
    expect(results.meta.conditions).toEqual(CONDITIONS.map((c) => c.id));
    for (const stage of ['hash', 'embedding', 'pipeline']) {
      for (const c of CONDITIONS) expect(results.stages[stage][c.id].n).toBe(corpus.cards.length);
    }
  });
});

describe('public page /guides/scanner-accuracy.html', () => {
  const guides = path.resolve(__dirname, '..', '..', '..', '..', 'frontend', 'public', 'guides');
  const html = fs.readFileSync(path.join(guides, 'scanner-accuracy.html'), 'utf8');
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));

  it('has its own title, description and canonical URL', () => {
    expect(html).toMatch(/<title>[^<]{10,}<\/title>/);
    expect(html).toMatch(/<meta\s+name="description"\s+content="[^"]{60,}"/);
    expect(html).toContain(
      '<link rel="canonical" href="https://spellcontrol.com/guides/scanner-accuracy.html" />'
    );
  });

  it('says plainly that the queries are synthetic and real-camera numbers are pending', () => {
    expect(text).toContain('The queries are synthetic, and real-camera numbers are pending.');
    expect(text).toMatch(/None is a photograph/);
  });

  it('prints every top-1 and top-3 figure in results.json', () => {
    for (const stage of ['hash', 'embedding', 'pipeline']) {
      for (const c of CONDITIONS) {
        const cell = results.stages[stage][c.id];
        expect(text, `${stage} ${c.id} top-1`).toContain(fraction(cell.top1, cell.n));
        expect(text, `${stage} ${c.id} top-3`).toContain(fraction(cell.top3, cell.n));
      }
    }
  });

  it('prints the pipeline classes, the corpus size, the seed and the timings', () => {
    const rows = [
      ...html.matchAll(
        /<th scope="row">([^<]+)<\/th>\s*<td>(\d+)<\/td>\s*<td>(\d+)<\/td>\s*<td>(\d+)<\/td>\s*<td>(\d+)<\/td>/g
      ),
    ];
    expect(rows).toHaveLength(CONDITIONS.length);
    CONDITIONS.forEach((c, i) => {
      const p = results.stages.pipeline[c.id];
      expect(rows[i].slice(2).map(Number)).toEqual([
        p.confident,
        p.confidentWrong,
        p.borderline,
        p.miss,
      ]);
    });
    expect(text).toContain(`${results.meta.cards} cards, drawn`);
    expect(text).toContain(`seed ${results.meta.seed}`);
    expect(text).toContain(`${results.meta.indexRecords.toLocaleString('en-US')} cards`);
    for (const k of ['hash', 'embedding', 'pipeline']) {
      expect(text).toContain(`${results.timing[k].p50} ms`);
    }
    const wrong = CONDITIONS.reduce((a, c) => a + results.stages.pipeline[c.id].confidentWrong, 0);
    expect(text).toContain(`sure and wrong ${wrong} times`);
  });

  it('is listed on the guides index and in the sitemap', async () => {
    const index = fs.readFileSync(path.join(guides, 'index.html'), 'utf8');
    expect(index).toContain('href="/guides/scanner-accuracy.html"');
    const sitemap = fs.readFileSync(path.resolve(__dirname, '..', '..', 'sitemap.ts'), 'utf8');
    expect(sitemap).toContain("'/guides/scanner-accuracy.html'");
  });
});
