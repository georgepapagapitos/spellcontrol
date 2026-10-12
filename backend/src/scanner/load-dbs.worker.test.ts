// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { loadDbsOffThread } from './matcher';
import { loadHashDbFromFile } from './hash-db';
import { loadEmbeddingDbFromFile } from './embedding-db';

const N = 60_000; // ~ the production record count
const DIM = 512;
let dir: string;
let hashPath: string;
let embPath: string;

function uuidBytes(i: number): Buffer {
  const b = Buffer.alloc(16);
  b.writeUInt32BE(i, 12);
  b.writeUInt32BE((i * 2654435761) >>> 0, 0);
  return b;
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-dbs-'));
  hashPath = path.join(dir, 'card-hashes.bin');
  embPath = path.join(dir, 'card-embeddings.bin');

  const h = Buffer.alloc(16 + N * 24);
  h.writeUInt32LE(0x48314353, 0);
  h.writeUInt8(1, 4);
  h.writeUInt32LE(N, 8);
  for (let i = 0; i < N; i++) {
    const o = 16 + i * 24;
    h.writeUInt32LE((i * 40503) >>> 0, o);
    h.writeUInt32LE((i * 9973) >>> 0, o + 4);
    uuidBytes(i).copy(h, o + 8);
  }
  fs.writeFileSync(hashPath, h);

  const rec = DIM + 16;
  const e = Buffer.alloc(16 + N * rec);
  e.writeUInt32LE(0x45314353, 0);
  e.writeUInt8(1, 4);
  e.writeUInt16LE(DIM, 6);
  e.writeUInt32LE(N, 8);
  for (let i = 0; i < N; i++) {
    const o = 16 + i * rec;
    for (let d = 0; d < DIM; d++) e.writeInt8(((i + d * 7) % 255) - 127, o + d);
    uuidBytes(i).copy(e, o + DIM);
  }
  fs.writeFileSync(embPath, e);
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('scanner matcher preload (off the event loop)', () => {
  it('is a sibling of matcher.ts, which is how the loader resolves it', () => {
    expect(fs.existsSync(path.join(__dirname, 'load-dbs.worker.ts'))).toBe(true);
  });

  it('yields the same databases as the in-thread loaders', async () => {
    const { hashDb, embeddingDb } = await loadDbsOffThread(hashPath, embPath);
    const refHash = await loadHashDbFromFile(hashPath);
    const refEmb = await loadEmbeddingDbFromFile(embPath);
    expect(hashDb.recordCount).toBe(N);
    expect(Buffer.from(hashDb.hashLo.buffer).equals(Buffer.from(refHash.hashLo.buffer))).toBe(true);
    expect(Buffer.from(hashDb.hashHi.buffer).equals(Buffer.from(refHash.hashHi.buffer))).toBe(true);
    expect(Buffer.from(hashDb.uuids).equals(Buffer.from(refHash.uuids))).toBe(true);
    expect(embeddingDb.dim).toBe(refEmb.dim);
    expect(embeddingDb.recordCount).toBe(N);
    expect(Buffer.from(embeddingDb.refs.buffer).equals(Buffer.from(refEmb.refs.buffer))).toBe(true);
    expect(Buffer.from(embeddingDb.uuids).equals(Buffer.from(refEmb.uuids))).toBe(true);
    expect(embeddingDb.uuidIndex).toEqual(refEmb.uuidIndex);
  }, 60_000);

  it('does not hold the event loop while it loads', async () => {
    // Baseline: the in-thread decode blocks the loop for its whole duration.
    const base = monitorEventLoopDelay({ resolution: 1 });
    base.enable();
    await loadEmbeddingDbFromFile(embPath);
    await new Promise((r) => setTimeout(r, 5));
    base.disable();
    const inThreadMax = base.max / 1e6;

    const h = monitorEventLoopDelay({ resolution: 1 });
    h.enable();
    await loadDbsOffThread(hashPath, embPath);
    await new Promise((r) => setTimeout(r, 5));
    h.disable();
    const offThreadMax = h.max / 1e6;
    // Worker startup + slice yields keep every stall small; the generous cap
    // is for noisy CI, the in-thread decode alone exceeds it on slow runners.
    expect(offThreadMax).toBeLessThan(Math.max(150, inThreadMax));
  }, 60_000);
});
