import { describe, expect, it } from 'vitest';
import { INFO_BAND, pickByInfoStrip, type GrayImage } from './info-strip';

const W = 488;
const H = 680;

/** Small deterministic PRNG so the fixtures never flake. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A dark card with a light info band: lines of "glyph" blocks keyed by `text`. */
function card(
  text: string,
  opts: { dx?: number; dy?: number; noise?: number; seed?: number } = {}
) {
  const { dx = 0, dy = 0, noise = 0, seed = 1 } = opts;
  const data = new Uint8Array(W * H).fill(20);
  const r = rng(seed);
  for (let i = 0; i < text.length; i++) {
    // Each character is a 5x8 block whose lit pixels are a function of the char.
    const code = text.charCodeAt(i);
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 5; px++) {
        if (((code * 31 + px * 7 + py * 13) ^ (code >> 1)) % 3 === 0) continue;
        const x = INFO_BAND.x + 14 + dx + i * 8 + px;
        const y = INFO_BAND.y + 14 + dy + py;
        data[y * W + x] = 220;
      }
    }
  }
  // An unchanging second line (set code and language), like the real band.
  for (let x = INFO_BAND.x + 14; x < INFO_BAND.x + 90; x += 2) {
    for (let py = 0; py < 6; py++) data[(INFO_BAND.y + 34 + dy + py) * W + x + dx] = 200;
  }
  if (noise > 0) {
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.max(0, Math.min(255, data[i] + (r() - 0.5) * 2 * noise));
    }
  }
  return { data, width: W, height: H } as GrayImage;
}

describe('pickByInfoStrip', () => {
  const refs = [card('0219'), card('0220'), card('0221')];

  it('picks the candidate whose info band the scan matches', () => {
    for (let i = 0; i < refs.length; i++) {
      const scan = card(['0219', '0220', '0221'][i], { noise: 12, seed: 9 + i });
      expect(pickByInfoStrip(scan, refs)).toBe(i);
    }
  });

  it('forgives a scan that sits a couple of pixels off the reference', () => {
    expect(pickByInfoStrip(card('0220', { dx: 2, dy: -2, noise: 8 }), refs)).toBe(1);
  });

  it('abstains when the candidates look the same', () => {
    expect(pickByInfoStrip(card('0219'), [card('0219'), card('0219')])).toBeNull();
  });

  it('needs at least two candidates', () => {
    expect(pickByInfoStrip(card('0219'), [card('0219')])).toBeNull();
    expect(pickByInfoStrip(card('0219'), [])).toBeNull();
  });
});
