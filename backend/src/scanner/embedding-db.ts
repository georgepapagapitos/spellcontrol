// Loader + cosine matcher for the Scryfall MobileCLIP2-S0 embedding DB.
//
// Backend twin of `frontend/src/lib/scanner/embedding-db.ts` (now removed —
// the frontend no longer holds embeddings; CLIP rerank happens server-side).
// Format ("SC1E") documented in `embedding-ingest.ts`.

import * as fs from 'node:fs/promises';

const MAGIC_LE = 0x45314353; // "SC1E" stored little-endian
const SCHEMA_VERSION = 1;
const HEADER_BYTES = 16;
const UUID_BYTES = 16;

export interface EmbeddingDb {
  refs: Int8Array;
  uuids: Uint8Array;
  uuidIndex: Map<string, number>;
  dim: number;
  recordCount: number;
  bytes: number;
}

export interface EmbedMatch {
  scryfallId: string;
  similarity: number;
}

export async function loadEmbeddingDbFromFile(filePath: string): Promise<EmbeddingDb> {
  const buf = await fs.readFile(filePath);
  return decodeEmbeddingDb(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

export function decodeEmbeddingDb(buf: ArrayBuffer): EmbeddingDb {
  if (buf.byteLength < HEADER_BYTES) {
    throw new Error(`embedding-db too small: ${buf.byteLength} bytes`);
  }
  const view = new DataView(buf);
  const magic = view.getUint32(0, true);
  if (magic !== MAGIC_LE) {
    throw new Error(`embedding-db bad magic 0x${magic.toString(16)}`);
  }
  const version = view.getUint8(4);
  if (version !== SCHEMA_VERSION) {
    throw new Error(`embedding-db unsupported version ${version}`);
  }
  const dim = view.getUint16(6, true);
  const recordCount = view.getUint32(8, true);
  const recordBytes = dim + UUID_BYTES;
  const expected = HEADER_BYTES + recordCount * recordBytes;
  if (buf.byteLength !== expected) {
    throw new Error(
      `embedding-db size mismatch: expected ${expected} for ${recordCount}×${dim}, got ${buf.byteLength}`
    );
  }

  const refs = new Int8Array(recordCount * dim);
  const uuids = new Uint8Array(recordCount * UUID_BYTES);
  const uuidIndex = new Map<string, number>();
  const src = new Uint8Array(buf);

  let cursor = HEADER_BYTES;
  for (let i = 0; i < recordCount; i++) {
    refs.set(new Int8Array(buf, cursor, dim), i * dim);
    uuids.set(src.subarray(cursor + dim, cursor + dim + UUID_BYTES), i * UUID_BYTES);
    uuidIndex.set(uuidFromBytes(uuids, i * UUID_BYTES), i);
    cursor += recordBytes;
  }

  return { refs, uuids, uuidIndex, dim, recordCount, bytes: buf.byteLength };
}

export function rerankByCosineUuids(
  db: EmbeddingDb,
  candidateUuids: ReadonlyArray<string>,
  query: Float32Array,
  k: number
): EmbedMatch[] {
  const indices: number[] = [];
  for (const uuid of candidateUuids) {
    const idx = db.uuidIndex.get(uuid);
    if (idx !== undefined) indices.push(idx);
  }
  return rerankByCosine(db, indices, query, k);
}

function dotProduct(refs: Int8Array, refOffset: number, dim: number, query: Float32Array): number {
  let acc = 0;
  for (let i = 0; i < dim; i++) {
    acc += refs[refOffset + i] * query[i];
  }
  return acc;
}

export function rerankByCosine(
  db: EmbeddingDb,
  candidateIndices: ArrayLike<number>,
  query: Float32Array,
  k: number
): EmbedMatch[] {
  if (k <= 0 || candidateIndices.length === 0) return [];
  if (query.length !== db.dim) {
    throw new Error(`query dim ${query.length} != db dim ${db.dim}`);
  }
  const { refs, dim, recordCount } = db;
  const kBounded = Math.min(k, candidateIndices.length);
  const topScore = new Float32Array(kBounded);
  const topIdx = new Int32Array(kBounded);
  for (let i = 0; i < kBounded; i++) {
    topScore[i] = -Infinity;
    topIdx[i] = -1;
  }
  let worstAtTop = -Infinity;

  for (let c = 0; c < candidateIndices.length; c++) {
    const i = candidateIndices[c] | 0;
    if (i < 0 || i >= recordCount) continue;
    const s = dotProduct(refs, i * dim, dim, query);
    if (s > worstAtTop) {
      let j = kBounded - 1;
      while (j > 0 && topScore[j - 1] < s) {
        topScore[j] = topScore[j - 1];
        topIdx[j] = topIdx[j - 1];
        j--;
      }
      topScore[j] = s;
      topIdx[j] = i;
      worstAtTop = topScore[kBounded - 1];
    }
  }

  const out: EmbedMatch[] = [];
  for (let i = 0; i < kBounded; i++) {
    if (topIdx[i] < 0) break;
    out.push({
      scryfallId: uuidFromBytes(db.uuids, topIdx[i] * UUID_BYTES),
      similarity: topScore[i],
    });
  }
  return out;
}

function uuidFromBytes(buf: Uint8Array, offset: number): string {
  const hex: string[] = [];
  for (let i = 0; i < UUID_BYTES; i++) {
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
