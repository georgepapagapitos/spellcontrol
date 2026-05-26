// Loader + nearest-neighbor matcher for the Scryfall pHash DB.
//
// The binary file is produced by backend/src/scanner/hash-ingest.ts; format
// is documented there. We decode into parallel typed arrays so the matcher
// can scan with tight Uint32 popcount instead of BigInt arithmetic — about
// 5-10× faster on the WebView's JIT.
//
//   hashLo:  Uint32Array — lower 32 bits of each pHash
//   hashHi:  Uint32Array — upper 32 bits of each pHash
//   uuids:   Uint8Array  — 16 bytes per record (Scryfall ID raw form)
//
// Lookup is O(N) over ~90k records. Empirically ~10–20ms on a mid-range
// Android in the WebView; well within a single-shot scan budget. BK-tree
// or LSH indexing is a future optimization if/when matching frequency goes
// past a few Hz.

const DB_URL = '/scanner-v2/card-hashes.bin';
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

export interface Match {
  /** Scryfall card id, hyphenated UUID form. */
  scryfallId: string;
  /** Hamming distance from the query hash (0 = identical, 64 = opposite). */
  distance: number;
}

let pending: Promise<HashDb> | null = null;

export function loadHashDb(): Promise<HashDb> {
  if (pending) return pending;
  pending = (async () => {
    const res = await fetch(DB_URL);
    if (!res.ok) {
      throw new Error(`hash-db fetch failed: HTTP ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    return decodeHashDb(buf);
  })();
  pending.catch(() => {
    pending = null;
  });
  return pending;
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

/**
 * Find the K nearest neighbors of `query` by Hamming distance. K is small
 * (typically 1-5 for the UI) so we keep an insertion-sorted top-K array
 * rather than building a heap.
 */
export function findNearest(db: HashDb, query: bigint, k: number): Match[] {
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
      // Insert into the sorted (asc-by-distance) top-K.
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

  const out: Match[] = [];
  for (let i = 0; i < k; i++) {
    if (topIdx[i] < 0) break;
    out.push({
      scryfallId: uuidFromBytes(db.uuids, topIdx[i] * 16),
      distance: topDist[i],
    });
  }
  return out;
}

/** SWAR popcount on a 32-bit unsigned int. Hot path in {@link findNearest}. */
export function popcount32(x: number): number {
  // x is treated as a Uint32 by the bitwise ops.
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
  // Standard 8-4-4-4-12 grouping.
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

export function resetHashDbLoaderForTests(): void {
  pending = null;
}
