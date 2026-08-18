// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Worker } from 'node:worker_threads';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { writeBulkMeta } from './scryfall-bulk';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-worker-'));
  dbPath = path.join(dir, 'scryfall-cache.db');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('scryfall-bulk worker', () => {
  it('is a sibling of server.ts, which is how the scheduler resolves it', () => {
    // `scheduleScryfallBulkIngest` builds the entry path as
    // `path.join(__dirname, 'scryfall-bulk.worker' + path.extname(__filename))`,
    // relying on tsc mirroring the src layout into dist. Moving this file into a
    // subdirectory would make the scheduler spawn a path that does not exist —
    // and because the failure surfaces only as a logged worker error, the ingest
    // would silently stop running. Cheap guard for an expensive silence.
    expect(fs.existsSync(path.join(__dirname, 'scryfall-bulk.worker.ts'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, 'server.ts'))).toBe(true);
  });

  it('runs the ingest off the main thread and exits 0', async () => {
    // Arm the recency guard so the run short-circuits before any network call:
    // this exercises worker startup, its own better-sqlite3 connection, and a
    // clean exit — the parts that actually break — without touching Scryfall.
    writeBulkMeta(dbPath, { updatedAt: Date.now() });

    const entry = path.join(__dirname, 'scryfall-bulk.worker.ts');
    const mainThreadTicks: number[] = [];
    const ticker = setInterval(() => mainThreadTicks.push(Date.now()), 10);

    const code = await new Promise<number>((resolve, reject) => {
      const worker = new Worker(entry, {
        workerData: { dbPath },
        // tsx resolves the extensionless relative imports the same way the
        // compiled CJS does in production; Node's bare type-stripper treats
        // a .ts entry as ESM and cannot resolve './logger'.
        execArgv: ['--import', 'tsx', '--no-warnings'],
      });
      worker.on('error', reject);
      worker.on('exit', resolve);
    }).finally(() => clearInterval(ticker));

    expect(code).toBe(0);
    // The main thread kept running while the worker did. This is the whole
    // point of the change: the ingest's synchronous SQLite writes must not be
    // able to stop this thread from answering /health.
    expect(mainThreadTicks.length).toBeGreaterThan(0);
  }, 30_000);
});
