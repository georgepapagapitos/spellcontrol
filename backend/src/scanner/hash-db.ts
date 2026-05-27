// Loader + nearest-neighbor matcher for the Scryfall pHash DB.
//
// Backend twin of `frontend/src/lib/scanner/hash-db.ts`. The binary file
// (SC1H format) is produced by `hash-ingest.ts` and consumed identically on
// both sides — the algorithm must stay in lock-step. Tests exercise both
// implementations against the same golden vector.

import * as fs from 'node:fs/promises';

const MAGIC_LE = 0x48314353; // "SC1H" stored little-endian
const SCHEMA_VERSION = 1;
const HEADER_BYTES = 16;
const RECORD_BYTES = 24;

export interface HashDb {
  hashLo: Uint32Array;
  hashHi: Uint32Array;
  uuids: Uint8Array;
  recordCount: number;
  bytes: number;
}

export interface HashMatch {
  scryfallId: string;
  /** Hamming distance from the query hash (0 = identical, 64 = opposite). */
  distance: number;
}

export async function loadHashDbFromFile(filePath: string): Promise<HashDb> {
  const buf = await fs.readFile(filePath);
  return decodeHashDb(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

export function decodeHashDb(buf: ArrayBuffer): HashDb {
  if (buf.byteLength < HEADER_BYTES) {
    throw new Error(`hash-db too small: ${buf.byteLength} bytes`);
  }
  const view = new DataView(buf);
  const magic = view.getUint32(0, true);
  if (magic !== MAGIC_LE) {
    throw new Error(`hash-db bad magic 0x${magic.toString(16)}`);
  }
  const version = view.getUint8(4);
  if (version !== SCHEMA_VERSION) {
    throw new Error(`hash-db unsupported version ${version}`);
  }
  const recordCount = view.getUint32(8, true);
  const expected = HEADER_BYTES + recordCount * RECORD_BYTES;
  if (buf.byteLength !== expected) {
    throw new Error(
      `hash-db size mismatch: expected ${expected} for ${recordCount} records, got ${buf.byteLength}`
    );
  }

  const hashLo = new Uint32Array(recordCount);
  const hashHi = new Uint32Array(recordCount);
  const uuids = new Uint8Array(recordCount * 16);
  const src = new Uint8Array(buf);

  let cursor = HEADER_BYTES;
  for (let i = 0; i < recordCount; i++) {
    hashLo[i] = view.getUint32(cursor, true);
    hashHi[i] = view.getUint32(cursor + 4, true);
    uuids.set(src.subarray(cursor + 8, cursor + 24), i * 16);
    cursor += RECORD_BYTES;
  }

  return { hashLo, hashHi, uuids, recordCount, bytes: buf.byteLength };
}

export function findNearest(db: HashDb, query: bigint, k: number): HashMatch[] {
  if (k <= 0) return [];
  const qLo = Number(query & 0xffffffffn) >>> 0;
  const qHi = Number((query >> 32n) & 0xffffffffn) >>> 0;

  const topDist = new Int32Array(k);
  const topIdx = new Int32Array(k);
  for (let i = 0; i < k; i++) {
    topDist[i] = 65;
    topIdx[i] = -1;
  }
  let worstAtTop = 65;

  const { hashLo, hashHi, recordCount } = db;
  for (let i = 0; i < recordCount; i++) {
    const d = popcount32(hashLo[i] ^ qLo) + popcount32(hashHi[i] ^ qHi);
    if (d < worstAtTop) {
      let j = k - 1;
      while (j > 0 && topDist[j - 1] > d) {
        topDist[j] = topDist[j - 1];
        topIdx[j] = topIdx[j - 1];
        j--;
      }
      topDist[j] = d;
      topIdx[j] = i;
      worstAtTop = topDist[k - 1];
    }
  }

  const out: HashMatch[] = [];
  for (let i = 0; i < k; i++) {
    if (topIdx[i] < 0) break;
    out.push({ scryfallId: uuidFromBytes(db.uuids, topIdx[i] * 16), distance: topDist[i] });
  }
  return out;
}

export function popcount32(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (Math.imul(x, 0x01010101) >>> 24) & 0xff;
}

function uuidFromBytes(buf: Uint8Array, offset: number): string {
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push(buf[offset + i].toString(16).padStart(2, '0'));
  }
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}
