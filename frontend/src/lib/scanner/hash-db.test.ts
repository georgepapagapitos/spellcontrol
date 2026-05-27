import { describe, it, expect } from 'vitest';
import { decodeHashDb, findNearest, popcount32, type HashDb } from './hash-db';

// Build a binary identical to backend/src/scanner/hash-ingest.ts's packBinary
// output so we test the decoder against the on-disk contract, not our own
// in-memory shape.
function pack(records: Array<{ hash: bigint; uuid: string }>): ArrayBuffer {
  const buf = new ArrayBuffer(16 + records.length * 24);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  view.setUint32(0, 0x48314353, true);
  view.setUint8(4, 1);
  view.setUint32(8, records.length, true);
  let cursor = 16;
  for (const r of records) {
    view.setBigUint64(cursor, r.hash, true);
    const hex = r.uuid.replace(/-/g, '');
    for (let i = 0; i < 16; i++) {
      bytes[cursor + 8 + i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    cursor += 24;
  }
  return buf;
}

describe('decodeHashDb', () => {
  it('round-trips a small hand-packed DB', () => {
    const buf = pack([
      { hash: 0x1122334455667788n, uuid: '11111111-2222-3333-4444-555555555555' },
      { hash: 0xaabbccddeeff0011n, uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    ]);
    const db = decodeHashDb(buf);
    expect(db.recordCount).toBe(2);
    // Little-endian split: low 32 bits in hashLo, high 32 bits in hashHi.
    expect(db.hashLo[0] >>> 0).toBe(0x55667788);
    expect(db.hashHi[0] >>> 0).toBe(0x11223344);
    expect(db.hashLo[1] >>> 0).toBe(0xeeff0011);
    expect(db.hashHi[1] >>> 0).toBe(0xaabbccdd);
  });

  it('rejects wrong magic', () => {
    const buf = new ArrayBuffer(16);
    expect(() => decodeHashDb(buf)).toThrow(/bad magic/);
  });

  it('rejects size mismatch', () => {
    const buf = pack([{ hash: 1n, uuid: '11111111-2222-3333-4444-555555555555' }]);
    const truncated = buf.slice(0, buf.byteLength - 4);
    expect(() => decodeHashDb(truncated)).toThrow(/size mismatch/);
  });
});

describe('popcount32', () => {
  it('returns 0 for 0', () => {
    expect(popcount32(0)).toBe(0);
  });
  it('returns 32 for all-ones', () => {
    expect(popcount32(0xffffffff)).toBe(32);
  });
  it('counts correctly on mixed bits', () => {
    expect(popcount32(0b1011_0110)).toBe(5);
  });
});

describe('findNearest', () => {
  const records: Array<{ hash: bigint; uuid: string }> = [
    { hash: 0x0000000000000000n, uuid: '00000000-0000-0000-0000-000000000000' },
    { hash: 0x00000000000000ffn, uuid: '11111111-1111-1111-1111-111111111111' },
    { hash: 0x0f0f0f0f0f0f0f0fn, uuid: '22222222-2222-2222-2222-222222222222' },
    { hash: 0xffffffffffffffffn, uuid: '33333333-3333-3333-3333-333333333333' },
  ];
  const db: HashDb = (() => {
    return decodeHashDb(pack(records));
  })();

  it('returns the exact match first when one exists', () => {
    const out = findNearest(db, 0x0000000000000000n, 1);
    expect(out).toHaveLength(1);
    expect(out[0].distance).toBe(0);
    expect(out[0].scryfallId).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('orders by ascending Hamming distance', () => {
    const out = findNearest(db, 0x00000000000000ffn, 3);
    // 0xff vs each record: identity 0; 0x00..0 has 8 different bits;
    // 0x0f0f… differs in 32 nibbles. Query distance from 0xffff… = 56.
    expect(out.map((m) => m.distance)).toEqual([0, 8, 32]);
    expect(out[0].scryfallId).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('truncates to k matches', () => {
    const out = findNearest(db, 0x0000000000000000n, 2);
    expect(out).toHaveLength(2);
  });

  it('returns [] for k=0', () => {
    expect(findNearest(db, 0n, 0)).toEqual([]);
  });

  it('formats UUIDs in standard 8-4-4-4-12 form', () => {
    const out = findNearest(db, 0xffffffffffffffffn, 1);
    expect(out[0].scryfallId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});
