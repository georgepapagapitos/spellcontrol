import { describe, it, expect } from 'vitest';
import { detectCardBox } from './scanner-detect';

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

  it('rejects a one-sided gradient (background ramp, not a card)', () => {
    // Synthesise a left-bright-to-right-dark ramp — no actual rectangle.
    // The old detector would lock onto this because *one* column has a
    // huge gradient relative to mean; the symmetry check rejects it.
    const W = 64;
    const H = 90;
    const frame = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        frame[y * W + x] = Math.max(0, 220 - x * 3); // linear horizontal ramp
      }
    }
    expect(detectCardBox(frame, W, H)).toBeNull();
  });

  it('finds the card even when a strong environmental edge sits above it', () => {
    // Real-world failure case: a card sitting on a desk with a darker
    // wall/shadow above. The full-width horizontal line where dark
    // meets light projects a *stronger* row-gradient spike than the
    // card's printed top border (because it spans the full frame
    // width, not just the card width). The old "first row above
    // threshold" greedy locked onto the shadow line as the card's
    // top edge — bbox came out too tall, failed aspect, returned null.
    // The candidate-search algorithm should skip that combination and
    // land on the card's actual top.
    const W = 64;
    const H = 90;
    const frame = new Uint8Array(W * H);
    // Dark band at top of frame (y = 0..8), then white background, then
    // the card (a darker rectangle on the white).
    for (let y = 0; y < H; y++) {
      const bg = y < 9 ? 30 : 230;
      for (let x = 0; x < W; x++) {
        frame[y * W + x] = bg;
      }
    }
    // Card: 30×42 (5:7 aspect), placed in the lower-middle.
    const cardX = 18;
    const cardY = 40;
    const cardW = 30;
    const cardH = 42;
    for (let y = cardY; y < cardY + cardH; y++) {
      for (let x = cardX; x < cardX + cardW; x++) {
        frame[y * W + x] = 60; // dark card on bright surface
      }
    }
    const box = detectCardBox(frame, W, H);
    expect(box).not.toBeNull();
    // The detected box should land on the card, not span from the
    // shadow line down to the card bottom. Allow ±2 px for the
    // gradient-centring offset.
    expect(Math.abs(box!.y - cardY)).toBeLessThanOrEqual(2);
    expect(Math.abs(box!.h - cardH)).toBeLessThanOrEqual(3);
  });
});
