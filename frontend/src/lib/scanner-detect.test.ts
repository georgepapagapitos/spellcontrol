import { describe, it, expect } from 'vitest';
import { detectCardBox, detectorBoxToViewport } from './scanner-detect';

/**
 * Build a grayscale frame with a brighter card-shaped rectangle on a
 * darker background. The rectangle has the 5:7 aspect of an MTG card
 * unless otherwise specified.
 */
function frameWithCard(
  width: number,
  height: number,
  card: { x: number; y: number; w: number; h: number; fg?: number; bg?: number }
): Uint8Array {
  const fg = card.fg ?? 220;
  const bg = card.bg ?? 30;
  const buf = new Uint8Array(width * height).fill(bg);
  for (let y = card.y; y < card.y + card.h; y++) {
    for (let x = card.x; x < card.x + card.w; x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      buf[y * width + x] = fg;
    }
  }
  return buf;
}

describe('detectCardBox', () => {
  it('finds a centred 5:7 rectangle', () => {
    const W = 64;
    const H = 90;
    const cardW = 30;
    const cardH = Math.round(cardW / (5 / 7));
    const cardX = Math.floor((W - cardW) / 2);
    const cardY = Math.floor((H - cardH) / 2);
    const frame = frameWithCard(W, H, { x: cardX, y: cardY, w: cardW, h: cardH });
    const box = detectCardBox(frame, W, H);
    expect(box).not.toBeNull();
    // Edge-detection picks the column AT the bright pixels, so the
    // returned bbox aligns with the painted rectangle within ±1 px.
    expect(Math.abs(box!.x - cardX)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.y - cardY)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.w - cardW)).toBeLessThanOrEqual(2);
    expect(Math.abs(box!.h - cardH)).toBeLessThanOrEqual(2);
  });

  it('finds an off-centre card too', () => {
    const W = 64;
    const H = 90;
    const frame = frameWithCard(W, H, { x: 6, y: 10, w: 28, h: Math.round(28 / (5 / 7)) });
    const box = detectCardBox(frame, W, H);
    expect(box).not.toBeNull();
    expect(box!.x).toBeLessThan(15);
    expect(box!.y).toBeLessThan(20);
  });

  it('returns null on a flat / featureless frame', () => {
    const W = 64;
    const H = 90;
    const flat = new Uint8Array(W * H).fill(128);
    expect(detectCardBox(flat, W, H)).toBeNull();
  });

  it('rejects rectangles with the wrong aspect ratio (e.g. a phone)', () => {
    const W = 64;
    const H = 90;
    // Tall narrow rectangle — aspect ≈ 0.36, well outside the 5:7 band.
    const tallNarrow = frameWithCard(W, H, { x: 24, y: 10, w: 18, h: 70 });
    expect(detectCardBox(tallNarrow, W, H)).toBeNull();
  });

  it('rejects rectangles too small to be the card being scanned', () => {
    const W = 64;
    const H = 90;
    // 5:7 aspect but only ~10% of frame width.
    const tiny = frameWithCard(W, H, { x: 28, y: 40, w: 7, h: 10 });
    expect(detectCardBox(tiny, W, H)).toBeNull();
  });

  it('returns null on a malformed frame', () => {
    expect(detectCardBox(new Uint8Array(0), 0, 0)).toBeNull();
    expect(detectCardBox(new Uint8Array(10), 5, 5)).toBeNull(); // wrong length
  });
});

describe('detectorBoxToViewport', () => {
  it('linearly rescales a detector-frame box into viewport coords', () => {
    const box = { x: 10, y: 20, w: 30, h: 42 };
    const mapped = detectorBoxToViewport(box, 64, 90, {
      left: 100,
      top: 50,
      width: 320,
      height: 450,
    });
    expect(mapped.left).toBeCloseTo(100 + 10 * (320 / 64));
    expect(mapped.top).toBeCloseTo(50 + 20 * (450 / 90));
    expect(mapped.width).toBeCloseTo(30 * (320 / 64));
    expect(mapped.height).toBeCloseTo(42 * (450 / 90));
  });
});
