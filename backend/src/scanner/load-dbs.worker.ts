// Worker thread for the scanner matcher preload: reads and decodes both binary
// DBs off the event loop and hands the typed arrays back as transferables.
// Spawned by `loadDbsOffThread` in matcher.ts, which derives this file's path
// from its own extension, so it must stay a sibling of matcher.ts.

import { parentPort, workerData } from 'node:worker_threads';
import * as fs from 'node:fs/promises';
import { decodeHashDb, type HashDb } from './hash-db';
import { decodeEmbeddingDbRaw, type EmbeddingDbRaw } from './embedding-db';

export interface LoadedDbs {
  hashDb: HashDb;
  embeddingDb: EmbeddingDbRaw;
}

async function readAb(filePath: string): Promise<ArrayBuffer> {
  const buf = await fs.readFile(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function main(): Promise<void> {
  const { hashPath, embeddingPath } = workerData as { hashPath: string; embeddingPath: string };
  try {
    const [h, e] = await Promise.all([readAb(hashPath), readAb(embeddingPath)]);
    const hashDb = decodeHashDb(h);
    const embeddingDb = decodeEmbeddingDbRaw(e);
    parentPort!.postMessage({ ok: true, dbs: { hashDb, embeddingDb } }, [
      hashDb.hashLo.buffer as ArrayBuffer,
      hashDb.hashHi.buffer as ArrayBuffer,
      hashDb.uuids.buffer as ArrayBuffer,
      embeddingDb.refs.buffer as ArrayBuffer,
      embeddingDb.uuids.buffer as ArrayBuffer,
    ]);
  } catch (err) {
    parentPort!.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

void main();
