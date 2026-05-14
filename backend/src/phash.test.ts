import { describe, it, expect } from 'vitest';
import {
  HASH_BYTES,
  dHashFromLuminance,
  hammingDistance,
  hashFromHex,
  hashToHex,
  rgbToLuma,
} from './phash';

describe('dHashFromLuminance', () => {
  it('produces an 8-byte hash', () => {
    const luma = new Uint8Array(72).fill(128);
    const hash = dHashFromLuminance(luma);
    expect(hash.length).toBe(HASH_BYTES);
  });

  it('rejects wrong-sized input', () => {
    expect(() => dHashFromLuminance(new Uint8Array(71))).toThrow();
    expect(() => dHashFromLuminance(new Uint8Array(73))).toThrow();
  });

  it('emits all-zero bits for a flat image (left == right everywhere)', () => {
    const luma = new Uint8Array(72).fill(200);
    const hash = dHashFromLuminance(luma);
    for (const byte of hash) expect(byte).toBe(0);
  });

  it('emits all-one bits for a strictly decreasing row (left > right everywhere)', () => {
    // 9 columns × 8 rows, each row 250,249,...,242 — strictly decreasing.
    const luma = new Uint8Array(72);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 9; col++) luma[row * 9 + col] = 250 - col;
    }
    const hash = dHashFromLuminance(luma);
    for (const byte of hash) expect(byte).toBe(0xff);
  });

  it('is deterministic for the same input', () => {
    const luma = new Uint8Array(72);
    for (let i = 0; i < 72; i++) luma[i] = (i * 17 + 3) & 0xff;
    const a = dHashFromLuminance(luma);
    const b = dHashFromLuminance(luma);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('hex round-trip', () => {
  it('round-trips a known hash', () => {
    const bytes = new Uint8Array([0x00, 0xff, 0xab, 0xcd, 0x12, 0x34, 0x56, 0x78]);
    expect(hashToHex(bytes)).toBe('00ffabcd12345678');
    expect(Array.from(hashFromHex('00ffabcd12345678')!)).toEqual(Array.from(bytes));
  });

  it('rejects malformed hex', () => {
    expect(hashFromHex('')).toBeNull();
    expect(hashFromHex('abc')).toBeNull();
    expect(hashFromHex('zz'.repeat(8))).toBeNull();
    expect(hashFromHex('a'.repeat(15))).toBeNull();
  });
});

describe('hammingDistance', () => {
  it('returns 0 for identical hashes', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(hammingDistance(a, b)).toBe(0);
  });

  it('counts bit differences', () => {
    const a = new Uint8Array([0b00000000]);
    const b = new Uint8Array([0b00001111]);
    expect(hammingDistance(a, b)).toBe(4);
  });

  it('returns the maximum for an all-bits-different pair', () => {
    const a = new Uint8Array(8).fill(0x00);
    const b = new Uint8Array(8).fill(0xff);
    expect(hammingDistance(a, b)).toBe(64);
  });

  it('throws on length mismatch', () => {
    expect(() => hammingDistance(new Uint8Array(8), new Uint8Array(7))).toThrow();
  });
});

describe('rgbToLuma', () => {
  it('returns 0 for black and ~255 for white', () => {
    expect(rgbToLuma(0, 0, 0)).toBe(0);
    expect(Math.round(rgbToLuma(255, 255, 255))).toBe(255);
  });
});
