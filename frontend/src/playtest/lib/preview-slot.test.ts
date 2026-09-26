import { describe, expect, it } from 'vitest';
import { MARGIN, previewSlot, type Box } from './preview-slot';

const box = (left: number, top: number, right: number, bottom: number): Box => ({
  left,
  top,
  right,
  bottom,
});
const overlaps = (a: Box, b: Box) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe('previewSlot', () => {
  // A 1440x900 desk: menu/turn stack top-right, piles bottom-right, fan
  // bottom-centre. The pane clears all of it, so it keeps the slot the table
  // has always used.
  it('keeps the centred right-edge slot wherever it clears the chrome', () => {
    const width = 345.6;
    const slot = previewSlot({
      vw: 1440,
      vh: 900,
      paneWidth: width,
      height: width * 1.4,
      card: box(600, 700, 700, 840),
      corners: [box(12, 12, 260, 120), box(1300, 12, 1428, 180)],
      edges: [],
      floor: [box(900, 760, 1428, 900), box(300, 720, 840, 900)],
    });
    expect(slot).toEqual({ left: 1440 - 24 - width, top: (900 - width * 1.4) / 2, scale: 1 });
  });

  // The 832x384 phone on its side, measured off the real board (2026-09-25):
  // centred at the right edge the pane covered the TURN chip, the zones tab
  // and the Hand/Library row.
  it('moves to the top of the table, left of the corner column, on a phone on its side', () => {
    const width = 832 * 0.24;
    const corners = [box(12, 12, 112, 64), box(768, 12, 820, 120)];
    const edges = [box(789, 195, 832, 311)]; // zones tab
    const floor = [
      box(572, 329, 824, 380), // piles
      box(73, 268, 527, 384), // hand fan
    ];
    const card = box(73, 288, 157, 384);
    const slot = previewSlot({
      vw: 832,
      vh: 384,
      paneWidth: width,
      height: width * 1.4,
      card,
      corners,
      edges,
      floor,
    });
    expect(slot.top).toBe(MARGIN);
    expect(slot.scale).toBe(1);
    const pane = box(slot.left, slot.top, slot.left + width, slot.top + width * 1.4);
    expect(pane.right).toBe(768 - MARGIN);
    for (const o of [...corners, ...edges, ...floor, card]) expect(overlaps(pane, o)).toBe(false);
  });

  it('shrinks to the room above the pile row, but no further than readable', () => {
    const width = 200;
    const slot = previewSlot({
      vw: 832,
      vh: 300,
      paneWidth: width,
      height: 280,
      card: box(73, 250, 157, 300),
      corners: [box(768, 12, 820, 120)],
      edges: [],
      floor: [box(560, 240, 824, 300)],
    });
    // 240 above the row, less a margin either side: 216 of 280.
    expect(slot.scale).toBeCloseTo(216 / 280, 3);
    expect(slot.left + width * slot.scale).toBe(768 - MARGIN);

    const cramped = previewSlot({
      vw: 832,
      vh: 200,
      paneWidth: width,
      height: 280,
      card: box(73, 150, 157, 200),
      corners: [box(768, 12, 820, 120)],
      edges: [],
      floor: [box(560, 100, 824, 200)],
    });
    expect(cramped.scale).toBe(0.7);
  });

  it('falls back to the desk slot, flipped clear of the card, when the top would cover it', () => {
    const width = 200;
    const card = box(500, 20, 600, 160);
    const slot = previewSlot({
      vw: 832,
      vh: 384,
      paneWidth: width,
      height: 280,
      card,
      corners: [box(768, 12, 820, 120)],
      edges: [],
      floor: [box(572, 329, 824, 380)],
    });
    expect(slot.scale).toBe(1);
    expect(slot.left).toBe(24);
  });

  // A 390x844 phone held upright: life panel and the menu/turn stack at the
  // top, the zones tab on the right edge, the Hand button and piles standing
  // above a hand that has the whole bottom edge. The desk slot sat over the
  // zones tab and the top slot over the life panel; the felt between is empty.
  describe('upright', () => {
    const corners = [box(12, 12, 111, 64), box(326, 12, 378, 120)];
    const edges = [box(346, 364, 390, 480)];
    const floor = [box(221, 600, 382, 700), box(0, 720, 390, 844)];
    const card = box(150, 740, 236, 860);
    const input = { vw: 390, vh: 844, card, corners, edges, floor, upright: true };

    it('centres the pane in the felt between the chrome, clear of all of it', () => {
      const width = 281;
      const slot = previewSlot({ ...input, paneWidth: width, height: width * 1.4 });
      expect(slot.scale).toBe(1);
      const pane = box(slot.left, slot.top, slot.left + width, slot.top + width * 1.4);
      for (const o of [...corners, ...edges, ...floor, card]) expect(overlaps(pane, o)).toBe(false);
      expect(slot.left - MARGIN).toBeCloseTo(346 - MARGIN - pane.right);
      expect(slot.top - (120 + MARGIN)).toBeCloseTo(600 - MARGIN - pane.bottom);
    });

    it('shrinks a two-faced card to fit the width, past the desk floor on the scale', () => {
      const width = 281 * 2 + 8;
      const slot = previewSlot({ ...input, paneWidth: width, height: 281 * 1.4 });
      expect(slot.scale).toBeLessThan(0.7);
      expect(slot.left).toBeGreaterThanOrEqual(MARGIN);
      expect(slot.left + width * slot.scale).toBeLessThanOrEqual(346 - MARGIN);
    });

    it('leaves the middle to a card that sits there', () => {
      const middle = box(100, 300, 200, 440);
      const slot = previewSlot({ ...input, card: middle, paneWidth: 281, height: 281 * 1.4 });
      const pane = box(
        slot.left,
        slot.top,
        slot.left + 281 * slot.scale,
        slot.top + 281 * 1.4 * slot.scale
      );
      expect(overlaps(pane, middle)).toBe(false);
    });
  });
});
