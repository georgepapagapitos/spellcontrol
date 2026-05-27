import { describe, it, expect } from 'vitest';
import { uuidToBytes } from './hash-ingest';
import { packEmbeddingBinary, EMBED_DIM } from './embedding-ingest';
import { decodeEmbeddingDb, rerankByCosine, rerankByCosineUuids } from './embedding-db';

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

function int8Embedding(seed: number): Int8Array {
  const arr = new Int8Array(EMBED_DIM);
  // Deterministic but distinct rows: index → (seed * (i+1)) clamped to int8.
  for (let i = 0; i < EMBED_DIM; i++) {
    const v = ((seed * (i + 1)) % 254) - 127;
    arr[i] = Math.max(-127, Math.min(127, v));
  }
  return arr;
}

describe('decodeEmbeddingDb', () => {
  it('round-trips a small set of records', () => {
    const records = [
      { embedding: int8Embedding(1), uuid: uuidToBytes('11111111-1111-1111-1111-111111111111') },
      { embedding: int8Embedding(7), uuid: uuidToBytes('22222222-2222-2222-2222-222222222222') },
    ];
    const buf = packEmbeddingBinary(records);
    const db = decodeEmbeddingDb(toArrayBuffer(buf));
    expect(db.recordCount).toBe(2);
    expect(db.dim).toBe(EMBED_DIM);
    expect(db.uuidIndex.get('11111111-1111-1111-1111-111111111111')).toBe(0);
    expect(db.uuidIndex.get('22222222-2222-2222-2222-222222222222')).toBe(1);
  });

  it('rejects a bad magic number', () => {
    const buf = Buffer.alloc(16);
    buf.writeUInt32LE(0xdeadbeef, 0);
    expect(() => decodeEmbeddingDb(toArrayBuffer(buf))).toThrow(/bad magic/);
  });
});

describe('rerankByCosine', () => {
  it('orders candidates by descending dot product', () => {
    const records = [
      { embedding: int8Embedding(1), uuid: uuidToBytes('11111111-1111-1111-1111-111111111111') },
      { embedding: int8Embedding(7), uuid: uuidToBytes('22222222-2222-2222-2222-222222222222') },
    ];
    const buf = packEmbeddingBinary(records);
    const db = decodeEmbeddingDb(toArrayBuffer(buf));
    // Build a query that's identical to record 0's embedding in fp32.
    const ref0 = int8Embedding(1);
    const query = new Float32Array(EMBED_DIM);
    for (let i = 0; i < EMBED_DIM; i++) query[i] = ref0[i] / 127;
    const top = rerankByCosine(db, [0, 1], query, 2);
    expect(top[0].scryfallId).toBe('11111111-1111-1111-1111-111111111111');
    expect(top[0].similarity).toBeGreaterThan(top[1].similarity);
  });

  it('rerankByCosineUuids skips missing UUIDs', () => {
    const records = [
      { embedding: int8Embedding(1), uuid: uuidToBytes('11111111-1111-1111-1111-111111111111') },
    ];
    const buf = packEmbeddingBinary(records);
    const db = decodeEmbeddingDb(toArrayBuffer(buf));
    const query = new Float32Array(EMBED_DIM);
    query[0] = 1;
    const hits = rerankByCosineUuids(
      db,
      ['00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111'],
      query,
      5
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].scryfallId).toBe('11111111-1111-1111-1111-111111111111');
  });
});
