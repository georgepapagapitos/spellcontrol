// Loader + cosine matcher for the Scryfall MobileCLIP2-S0 embedding DB.
//
// The binary file is produced by backend/src/scanner/embedding-ingest.ts;
// the format ("SC1E") is documented there. We decode into a flat Int8Array
// (`refs`, length = recordCount × dim) plus parallel UUID bytes so the
// matcher can scan via straight indexed loads with no per-record object
// allocation.
//
// Two query entry points:
//   - `findNearestByCosine(db, query, k)` — full O(N×D) scan. 52k × 512 ≈
//     27M MACs; ~50-100ms on a mid-range Android WebView. Use this for
//     standalone benchmarking.
//   - `rerankByCosine(db, candidateIndices, query, k)` — score only the
//     supplied subset (typically pHash's top-K). This is the production
//     path: pHash narrows 52k → ~50, the embedding re-rank scores those
//     ~50 in <1ms.
//
// Both expect `query` to be L2-normalized fp32 already. Reference vectors
// are int8 with scale 1/127; since we only need ordering, we omit the
// /127 factor — the produced scores are proportional to cosine similarity
// (multiply by 1/127 to recover the absolute value).

const DB_URL = '/scanner-v2/card-embeddings.bin';
const MAGIC_LE = 0x45314353; // "SC1E" stored little-endian
const SCHEMA_VERSION = 1;
const HEADER_BYTES = 16;
const UUID_BYTES = 16;

export interface EmbeddingDb {
  refs: Int8Array; // length = recordCount × dim, row-major
  uuids: Uint8Array; // length = recordCount × 16
  /** Hyphenated-UUID → record index. Built once at decode time so the
   *  two-stage matcher can map pHash's uuid hits to embedding rows in O(1). */
  uuidIndex: Map<string, number>;
  dim: number;
  recordCount: number;
  bytes: number;
}

export interface EmbedMatch {
  scryfallId: string;
  /** Score proportional to cosine similarity. Divide by `dim^(1/2) * 127`
   *  for the absolute value; for ordering / threshold-checking the raw
   *  value is fine — multiply your threshold by the same constant. */
  similarity: number;
}

let pending: Promise<EmbeddingDb> | null = null;

export function loadEmbeddingDb(): Promise<EmbeddingDb> {
  if (pending) return pending;
  pending = (async () => {
    const res = await fetch(DB_URL);
    if (!res.ok) throw new Error(`embedding-db fetch failed: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    return decodeEmbeddingDb(buf);
  })();
  pending.catch(() => {
    pending = null;
  });
  return pending;
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

  // Allocate the destination arrays up front. `refs` holds all int8 lanes
  // packed contiguously; `uuids` holds the 16-byte ids in record order.
  const refs = new Int8Array(recordCount * dim);
  const uuids = new Uint8Array(recordCount * UUID_BYTES);
  const uuidIndex = new Map<string, number>();
  const src = new Uint8Array(buf);

  let cursor = HEADER_BYTES;
  for (let i = 0; i < recordCount; i++) {
    refs.set(
      new Int8Array(buf, cursor, dim),
      i * dim
    );
    uuids.set(src.subarray(cursor + dim, cursor + dim + UUID_BYTES), i * UUID_BYTES);
    uuidIndex.set(uuidFromBytes(uuids, i * UUID_BYTES), i);
    cursor += recordBytes;
  }

  return { refs, uuids, uuidIndex, dim, recordCount, bytes: buf.byteLength };
}

/**
 * Convenience wrapper around {@link rerankByCosine} that takes Scryfall
 * UUIDs (e.g. the output of pHash's `findNearest`) instead of raw indices.
 * Skips UUIDs missing from the embedding DB — they were filtered out
 * during embedding ingest (no art_crop, etc.) and shouldn't crash the
 * matcher.
 */
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

/**
 * Score a single reference record against the unit-length query. Returns
 * the int8/fp32 dot product (proportional to cosine sim — see file header).
 */
function dotProduct(refs: Int8Array, refOffset: number, dim: number, query: Float32Array): number {
  let acc = 0;
  for (let k = 0; k < dim; k++) {
    acc += refs[refOffset + k] * query[k];
  }
  return acc;
}

/**
 * Full O(N×D) scan. Use for benchmarking and as a fallback when no
 * pre-filter is available. For production scanning, drive
 * {@link rerankByCosine} with pHash's top-K instead.
 */
export function findNearestByCosine(
  db: EmbeddingDb,
  query: Float32Array,
  k: number
): EmbedMatch[] {
  if (k <= 0) return [];
  if (query.length !== db.dim) {
    throw new Error(`query dim ${query.length} != db dim ${db.dim}`);
  }

  const { refs, recordCount, dim } = db;
  const topScore = new Float32Array(k);
  const topIdx = new Int32Array(k);
  for (let i = 0; i < k; i++) {
    topScore[i] = -Infinity;
    topIdx[i] = -1;
  }
  let worstAtTop = -Infinity;

  for (let i = 0; i < recordCount; i++) {
    const s = dotProduct(refs, i * dim, dim, query);
    if (s > worstAtTop) {
      // Insertion-sorted descending top-K (best at index 0).
      let j = k - 1;
      while (j > 0 && topScore[j - 1] < s) {
        topScore[j] = topScore[j - 1];
        topIdx[j] = topIdx[j - 1];
        j--;
      }
      topScore[j] = s;
      topIdx[j] = i;
      worstAtTop = topScore[k - 1];
    }
  }

  return collectMatches(db, topIdx, topScore, k);
}

/**
 * Score the supplied candidate indices only. This is the two-stage match's
 * inner loop: pHash narrows from 52k → ~50, this scores those ~50.
 */
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

  return collectMatches(db, topIdx, topScore, kBounded);
}

function collectMatches(
  db: EmbeddingDb,
  idx: Int32Array,
  score: Float32Array,
  k: number
): EmbedMatch[] {
  const out: EmbedMatch[] = [];
  for (let i = 0; i < k; i++) {
    if (idx[i] < 0) break;
    out.push({
      scryfallId: uuidFromBytes(db.uuids, idx[i] * UUID_BYTES),
      similarity: score[i],
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

export function resetEmbeddingDbLoaderForTests(): void {
  pending = null;
}
