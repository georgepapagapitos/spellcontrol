import { describe, expect, it } from 'vitest';
import { computePeekPlacement, peekWidth, type PeekRect } from './hover-peek-placement';

// A roomy desktop viewport for the common cases.
const VIEWPORT = { width: 1440, height: 900 };
const CARD_W = 240;
const CARD_H = 334;

function row(partial: Partial<PeekRect>): PeekRect {
  // Mid-viewport by default so the centered card needs no vertical clamp.
  return { top: 400, right: 320, bottom: 430, left: 40, ...partial };
}

describe('computePeekPlacement', () => {
  it('pins to the right gutter of the row when there is room', () => {
    const { left, top } = computePeekPlacement(row({}), VIEWPORT, CARD_W, CARD_H);
    // right (320) + default gap (12)
    expect(left).toBe(332);
    // vertically centered on the row (center 415) minus half the card
    expect(top).toBe(415 - CARD_H / 2);
  });

  it('falls back to the left of the row when the right gutter would overflow', () => {
    // Row hugging the right edge: right=1420 leaves no room for a 240px card.
    const r = row({ left: 1140, right: 1420 });
    const { left } = computePeekPlacement(r, VIEWPORT, CARD_W, CARD_H);
    // left (1140) - gap (12) - cardW (240)
    expect(left).toBe(1140 - 12 - 240);
  });

  it('clamps into the viewport when neither side fits cleanly (narrow window)', () => {
    const narrow = { width: 360, height: 720 };
    // Right overflows, and the left fallback would go negative → clamp to margin.
    const r = row({ left: 20, right: 340 });
    const { left } = computePeekPlacement(r, narrow, CARD_W, CARD_H, 12, 8);
    expect(left).toBe(8); // margin
    expect(left).toBeGreaterThanOrEqual(0);
  });

  it('clamps the top edge so a near-top row does not push the card off-screen', () => {
    const r = row({ top: 0, bottom: 24 });
    const { top } = computePeekPlacement(r, VIEWPORT, CARD_W, CARD_H);
    expect(top).toBe(8); // margin, not a negative value
  });

  it('clamps the bottom edge so a near-bottom row keeps the card fully visible', () => {
    const r = row({ top: 880, bottom: 900 });
    const { top } = computePeekPlacement(r, VIEWPORT, CARD_W, CARD_H);
    // viewport.height (900) - cardH (334) - margin (8)
    expect(top).toBe(900 - CARD_H - 8);
  });

  it('honors custom gap and margin', () => {
    const { left } = computePeekPlacement(row({}), VIEWPORT, CARD_W, CARD_H, 20, 4);
    expect(left).toBe(320 + 20);
  });
});

describe('peekWidth', () => {
  it('clamps up to the minimum on a small laptop where 18vw is tiny', () => {
    // 1024 * 0.18 = 184 → floored to the 200 minimum.
    expect(peekWidth(1024)).toBe(200);
  });

  it('scales with the viewport in the mid range', () => {
    // 1440 * 0.18 = 259.2 → rounded.
    expect(peekWidth(1440)).toBe(259);
  });

  it('clamps to the maximum on a large / 4K monitor', () => {
    // 2560 * 0.18 = 460.8 → capped at 300.
    expect(peekWidth(2560)).toBe(300);
  });

  it('honors custom bounds', () => {
    expect(peekWidth(1000, 180, 320, 0.2)).toBe(200);
    expect(peekWidth(3000, 180, 320, 0.2)).toBe(320);
  });
});
