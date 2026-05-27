import { describe, it, expect } from 'vitest';
import {
  l2NormalizeInPlace,
  quantizeToInt8,
  packEmbeddingBinary,
  EMBED_DIM,
} from './embedding-ingest';
import { uuidToBytes } from './hash-ingest';

describe('l2NormalizeInPlace', () => {
  it('scales a non-zero vector to unit length', () => {
    const v = new Float32Array([3, 4]);
    const mag = l2NormalizeInPlace(v);
    expect(mag).toBeCloseTo(5, 5);
    expect(v[0]).toBeCloseTo(0.6, 5);
    expect(v[1]).toBeCloseTo(0.8, 5);
    const norm = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
    expect(norm).toBeCloseTo(1, 5);
  });

  it('leaves a zero vector untouched and reports magnitude 0', () => {
    const v = new Float32Array([0, 0, 0]);
    const mag = l2NormalizeInPlace(v);
    expect(mag).toBe(0);
    expect(Array.from(v)).toEqual([0, 0, 0]);
  });
});

describe('quantizeToInt8', () => {
  it('maps the symmetric range [-1, +1] linearly to ~[-127, +127]', () => {
    // JS `Math.round` rounds half-toward-+Infinity, so -0.5×127 = -63.5
    // resolves to -63 (not -64); +0.5×127 = +63.5 → +64. That asymmetric
    // bit is acceptable quantization noise on 512-dim vectors.
    const q = quantizeToInt8(new Float32Array([-1, -0.5, 0, 0.5, 1]));
    expect(Array.from(q)).toEqual([-127, -63, 0, 64, 127]);
  });

  it('clamps out-of-range inputs and never emits -128', () => {
    const q = quantizeToInt8(new Float32Array([-2, -1.5, 1.5, 2]));
    expect(Array.from(q)).toEqual([-127, -127, 127, 127]);
  });
});

describe('packEmbeddingBinary', () => {
  function makeEmbedding(fill: number): Int8Array {
    const v = new Int8Array(EMBED_DIM);
    v.fill(fill);
    return v;
  }

  it('writes the SC1E header and a deterministic record layout', () => {
    const records = [
      { embedding: makeEmbedding(1), uuid: uuidToBytes('00112233-4455-6677-8899-aabbccddeeff') },
      { embedding: makeEmbedding(-1), uuid: uuidToBytes('ffeeddcc-bbaa-9988-7766-554433221100') },
    ];
    const buf = packEmbeddingBinary(records);

    // Magic = "SC1E" little-endian.
    expect(buf.subarray(0, 4).toString('ascii')).toBe('SC1E');
    expect(buf.readUInt8(4)).toBe(1); // schema version
    expect(buf.readUInt16LE(6)).toBe(EMBED_DIM);
    expect(buf.readUInt32LE(8)).toBe(records.length);

    // Total size = 16-byte header + N × (512 + 16) bytes per record.
    expect(buf.length).toBe(16 + records.length * (EMBED_DIM + 16));

    // First record: 512 bytes of 0x01 then the UUID.
    const r0Start = 16;
    expect(buf[r0Start]).toBe(1);
    expect(buf[r0Start + EMBED_DIM - 1]).toBe(1);
    expect(buf.subarray(r0Start + EMBED_DIM, r0Start + EMBED_DIM + 16).toString('hex')).toBe(
      '00112233445566778899aabbccddeeff'
    );

    // Second record: 0xff (-1 as int8) repeated.
    const r1Start = r0Start + EMBED_DIM + 16;
    expect(buf[r1Start]).toBe(0xff);
    expect(buf.subarray(r1Start + EMBED_DIM, r1Start + EMBED_DIM + 16).toString('hex')).toBe(
      'ffeeddccbbaa99887766554433221100'
    );
  });

  it('throws if an embedding has the wrong dimension', () => {
    const records = [
      {
        embedding: new Int8Array(5),
        uuid: uuidToBytes('a'.repeat(8) + '-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
      },
    ];
    expect(() => packEmbeddingBinary(records)).toThrow(/512 dims/);
  });

  it('throws if a UUID has the wrong byte length', () => {
    const records = [{ embedding: new Int8Array(EMBED_DIM), uuid: Buffer.alloc(15) }];
    expect(() => packEmbeddingBinary(records)).toThrow(/16 bytes/);
  });
});
