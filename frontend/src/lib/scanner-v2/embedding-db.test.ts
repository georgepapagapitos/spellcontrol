import { describe, it, expect } from 'vitest';
import {
  decodeEmbeddingDb,
  findNearestByCosine,
  rerankByCosine,
  rerankByCosineUuids,
} from './embedding-db';

const DIM = 8; // small for hand-built fixtures; the real DB uses 512

/** Build an SC1E binary matching the backend's `packEmbeddingBinary` layout. */
function buildBinary(records: Array<{ embedding: number[]; uuid: string }>, dim = DIM): ArrayBuffer {
  const recordBytes = dim + 16;
  const buf = new ArrayBuffer(16 + records.length * recordBytes);
  const view = new DataView(buf);
  view.setUint32(0, 0x45314353, true); // "SC1E"
  view.setUint8(4, 1);
  view.setUint16(6, dim, true);
  view.setUint32(8, records.length, true);
  const bytes = new Uint8Array(buf);
  let cursor = 16;
  for (const r of records) {
    if (r.embedding.length !== dim) throw new Error(`embedding length must be ${dim}`);
    for (let i = 0; i < dim; i++) {
      const v = r.embedding[i];
      bytes[cursor + i] = v < 0 ? v + 256 : v; // store int8 as two's-complement byte
    }
    const hex = r.uuid.replace(/-/g, '');
    if (hex.length !== 32) throw new Error(`uuid must be 32 hex chars`);
    for (let i = 0; i < 16; i++) {
      bytes[cursor + dim + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    cursor += recordBytes;
  }
  return buf;
}

describe('decodeEmbeddingDb', () => {
  it('decodes a well-formed SC1E binary', () => {
    const buf = buildBinary([
      { embedding: [1, 2, 3, 4, 5, 6, 7, 8], uuid: '00112233-4455-6677-8899-aabbccddeeff' },
      { embedding: [-1, -2, -3, -4, -5, -6, -7, -8], uuid: 'ffeeddcc-bbaa-9988-7766-554433221100' },
    ]);
    const db = decodeEmbeddingDb(buf);
    expect(db.dim).toBe(8);
    expect(db.recordCount).toBe(2);
    expect(db.bytes).toBe(buf.byteLength);
    expect(Array.from(db.refs.slice(0, 8))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Array.from(db.refs.slice(8, 16))).toEqual([-1, -2, -3, -4, -5, -6, -7, -8]);
  });

  it('rejects a binary with the wrong magic', () => {
    const buf = buildBinary([
      { embedding: [0, 0, 0, 0, 0, 0, 0, 0], uuid: '00000000-0000-0000-0000-000000000000' },
    ]);
    new DataView(buf).setUint32(0, 0xdeadbeef, true);
    expect(() => decodeEmbeddingDb(buf)).toThrow(/bad magic/);
  });

  it('rejects a size-truncated binary', () => {
    const buf = buildBinary([
      { embedding: [0, 0, 0, 0, 0, 0, 0, 0], uuid: '00000000-0000-0000-0000-000000000000' },
    ]);
    const truncated = buf.slice(0, buf.byteLength - 4);
    expect(() => decodeEmbeddingDb(truncated)).toThrow(/size mismatch/);
  });
});

describe('findNearestByCosine', () => {
  it('ranks the most-similar record first', () => {
    // Three reference rows. Row 1 aligns with the query; row 0 is orthogonal-ish; row 2 is anti.
    const db = decodeEmbeddingDb(
      buildBinary([
        { embedding: [0, 0, 0, 0, 0, 0, 0, 100], uuid: '00000000-0000-0000-0000-000000000000' },
        { embedding: [100, 0, 0, 0, 0, 0, 0, 0], uuid: '11111111-1111-1111-1111-111111111111' },
        { embedding: [-100, 0, 0, 0, 0, 0, 0, 0], uuid: '22222222-2222-2222-2222-222222222222' },
      ])
    );
    const query = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]); // unit along axis 0
    const top = findNearestByCosine(db, query, 3);
    expect(top[0].scryfallId).toBe('11111111-1111-1111-1111-111111111111');
    expect(top[1].scryfallId).toBe('00000000-0000-0000-0000-000000000000');
    expect(top[2].scryfallId).toBe('22222222-2222-2222-2222-222222222222');
    expect(top[0].similarity).toBeGreaterThan(top[1].similarity);
    expect(top[1].similarity).toBeGreaterThan(top[2].similarity);
  });

  it('rejects a query of the wrong dim', () => {
    const db = decodeEmbeddingDb(
      buildBinary([
        { embedding: [0, 0, 0, 0, 0, 0, 0, 0], uuid: '00000000-0000-0000-0000-000000000000' },
      ])
    );
    expect(() => findNearestByCosine(db, new Float32Array(4), 1)).toThrow(/query dim/);
  });
});

describe('rerankByCosine', () => {
  it('only scores the supplied candidate indices', () => {
    const db = decodeEmbeddingDb(
      buildBinary([
        { embedding: [100, 0, 0, 0, 0, 0, 0, 0], uuid: '00000000-0000-0000-0000-000000000000' },
        { embedding: [0, 100, 0, 0, 0, 0, 0, 0], uuid: '11111111-1111-1111-1111-111111111111' },
        { embedding: [0, 0, 100, 0, 0, 0, 0, 0], uuid: '22222222-2222-2222-2222-222222222222' },
      ])
    );
    // Query strongly along axis 0 — but exclude record 0 from the candidate
    // set. The best survivor should be the all-orthogonal-but-second-best.
    const query = new Float32Array([1, 0.5, 0.25, 0, 0, 0, 0, 0]);
    const top = rerankByCosine(db, [1, 2], query, 2);
    expect(top[0].scryfallId).toBe('11111111-1111-1111-1111-111111111111');
    expect(top[1].scryfallId).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('rerankByCosineUuids maps Scryfall ids → indices and skips missing ones', () => {
    const db = decodeEmbeddingDb(
      buildBinary([
        { embedding: [100, 0, 0, 0, 0, 0, 0, 0], uuid: '00000000-0000-0000-0000-000000000000' },
        { embedding: [0, 100, 0, 0, 0, 0, 0, 0], uuid: '11111111-1111-1111-1111-111111111111' },
      ])
    );
    const top = rerankByCosineUuids(
      db,
      // include a uuid that doesn't exist in the DB; should be silently dropped
      [
        '11111111-1111-1111-1111-111111111111',
        'deadbeef-dead-beef-dead-beefdeadbeef',
        '00000000-0000-0000-0000-000000000000',
      ],
      new Float32Array([0, 1, 0, 0, 0, 0, 0, 0]), // unit along axis 1 → row 1 wins
      2
    );
    expect(top.length).toBe(2);
    expect(top[0].scryfallId).toBe('11111111-1111-1111-1111-111111111111');
    expect(top[1].scryfallId).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('ignores out-of-range candidate indices safely', () => {
    const db = decodeEmbeddingDb(
      buildBinary([
        { embedding: [100, 0, 0, 0, 0, 0, 0, 0], uuid: '00000000-0000-0000-0000-000000000000' },
      ])
    );
    const top = rerankByCosine(db, [0, 5, -1, 999], new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]), 5);
    expect(top.length).toBe(1);
    expect(top[0].scryfallId).toBe('00000000-0000-0000-0000-000000000000');
  });
});
