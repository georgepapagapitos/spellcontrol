import { describe, it, expect } from 'vitest';
import { packBinary, uuidToBytes } from './hash-ingest';
import { decodeHashDb, findNearest, popcount32 } from './hash-db';

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

describe('decodeHashDb', () => {
  it('round-trips a small set of records', () => {
    const records = [
      { hash: 0x0123456789abcdefn, uuid: uuidToBytes('11111111-1111-1111-1111-111111111111') },
      { hash: 0xfedcba9876543210n, uuid: uuidToBytes('22222222-2222-2222-2222-222222222222') },
    ];
    const buf = packBinary(records);
    const db = decodeHashDb(toArrayBuffer(buf));
    expect(db.recordCount).toBe(2);
    expect(db.hashLo[0]).toBe(0x89abcdef);
    expect(db.hashHi[0]).toBe(0x01234567);
  });

  it('rejects a bad magic number', () => {
    const buf = Buffer.alloc(16);
    buf.writeUInt32LE(0xdeadbeef, 0);
    expect(() => decodeHashDb(toArrayBuffer(buf))).toThrow(/bad magic/);
  });

  it('rejects a size mismatch', () => {
    const records = [{ hash: 0n, uuid: uuidToBytes('00000000-0000-0000-0000-000000000000') }];
    const buf = packBinary(records);
    const truncated = Buffer.from(buf.subarray(0, buf.length - 1));
    expect(() => decodeHashDb(toArrayBuffer(truncated))).toThrow(/size mismatch/);
  });
});

describe('findNearest', () => {
  it('returns the closest record by Hamming distance', () => {
    const records = [
      { hash: 0x0n, uuid: uuidToBytes('11111111-1111-1111-1111-111111111111') },
      { hash: 0xffffffffffffffffn, uuid: uuidToBytes('22222222-2222-2222-2222-222222222222') },
      { hash: 0xffn, uuid: uuidToBytes('33333333-3333-3333-3333-333333333333') },
    ];
    const buf = packBinary(records);
    const db = decodeHashDb(toArrayBuffer(buf));
    const top = findNearest(db, 0x1n, 1)[0];
    expect(top.scryfallId).toBe('11111111-1111-1111-1111-111111111111');
    expect(top.distance).toBe(1);
  });

  it('returns k nearest in ascending distance', () => {
    const records = [
      { hash: 0x0n, uuid: uuidToBytes('11111111-1111-1111-1111-111111111111') },
      { hash: 0x3n, uuid: uuidToBytes('22222222-2222-2222-2222-222222222222') },
      { hash: 0xffn, uuid: uuidToBytes('33333333-3333-3333-3333-333333333333') },
    ];
    const buf = packBinary(records);
    const db = decodeHashDb(toArrayBuffer(buf));
    const hits = findNearest(db, 0x1n, 3);
    expect(hits.map((h) => h.distance)).toEqual([1, 1, 7]);
  });
});

describe('popcount32', () => {
  it('counts 1-bits', () => {
    expect(popcount32(0)).toBe(0);
    expect(popcount32(0xffffffff)).toBe(32);
    expect(popcount32(0x80000001)).toBe(2);
  });
});
