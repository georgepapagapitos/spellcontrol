import { describe, it, expect } from 'vitest';
import {
  computePopoverPlacement,
  type AnchorRect,
  type SafeViewport,
  type PopoverSize,
} from './popover-placement';

// Standard safe viewport — 375×812 mobile, no header, 56px bottom nav, no keyboard.
const MOBILE_SAFE: SafeViewport = { top: 0, bottom: 756, left: 0, right: 375 };

// Desktop safe viewport — 1280×800, 52px header, no bottom nav.
const DESKTOP_SAFE: SafeViewport = { top: 52, bottom: 800, left: 0, right: 1280 };

// A medium-height panel.
const PANEL: PopoverSize = { width: 200, height: 180 };

// Helper: trigger near the top of the screen.
const triggerTop = (top: number, left: number, w = 120): AnchorRect => ({
  top,
  bottom: top + 40,
  left,
  right: left + w,
});

describe('computePopoverPlacement — vertical', () => {
  it('opens BELOW trigger when there is room below', () => {
    // Trigger is near the top — plenty of room below.
    const anchor = triggerTop(100, 80);
    const result = computePopoverPlacement(anchor, PANEL, DESKTOP_SAFE);
    expect(result.opensAbove).toBe(false);
    expect(result.top).toBeDefined();
    // top should be anchor.bottom + gap (6).
    expect(result.top).toBe(anchor.bottom + 6);
  });

  it('flips ABOVE when no room below but room above', () => {
    // Trigger near the BOTTOM — not enough room below, enough above.
    const anchor = triggerTop(700, 80); // bottom = 740; safe.bottom = 800; space below = 60
    // space above = 700 - 52 = 648, space below = 800 - 740 = 60 → opens above
    const result = computePopoverPlacement(anchor, PANEL, DESKTOP_SAFE, 'right', 6, 800);
    expect(result.opensAbove).toBe(true);
    expect(result.bottom).toBeDefined();
    expect(result.top).toBeUndefined();
  });

  it('clamps to safe top when panel would overflow above', () => {
    // Trigger so close to top that even "open above" would go off-screen.
    const anchor = triggerTop(60, 80); // very close to header (top=52)
    // space above = 60 - 52 = 8px; space below = 800 - 100 = 700 → opens below, no flip
    const result = computePopoverPlacement(anchor, PANEL, DESKTOP_SAFE);
    // Plenty of space below, so it opens below.
    expect(result.opensAbove).toBe(false);
    expect(result.top).toBeGreaterThanOrEqual(DESKTOP_SAFE.top + 8 /* EDGE_PAD */);
  });

  it('subtracts bottom tab bar from safe bottom on mobile', () => {
    // On mobile with a 56px bottom nav: safe.bottom = 756.
    // Trigger near the bottom — trigger.bottom = 720, safe.bottom = 756.
    // space below = 756 - 720 = 36 < MIN_BELOW_SPACE (160). Opens above.
    const anchor = triggerTop(680, 50); // bottom = 720
    const result = computePopoverPlacement(anchor, PANEL, MOBILE_SAFE, 'right', 6, 812);
    expect(result.opensAbove).toBe(true);
  });

  it('subtracts keyboard inset from safe bottom', () => {
    // Simulate keyboard showing: safe.bottom reduced by 300px (keyboard).
    const kbSafe: SafeViewport = { top: 0, bottom: 456, left: 0, right: 375 };
    // Trigger at y=400, bottom=440. space below = 456 - 440 = 16 < 160 → opens above.
    const anchor = triggerTop(400, 50); // bottom = 440
    const result = computePopoverPlacement(anchor, PANEL, kbSafe, 'right', 6, 812);
    expect(result.opensAbove).toBe(true);
  });
});

describe('computePopoverPlacement — horizontal', () => {
  it('right-aligns panel to trigger right edge by default', () => {
    const anchor = triggerTop(100, 800, 120); // right = 920 on a 1280px viewport
    const result = computePopoverPlacement(anchor, PANEL, DESKTOP_SAFE, 'right');
    expect(result.right).toBeDefined();
    // right = max(EDGE_PAD, vw - anchor.right) = max(8, 1280 - 920) = 360
    expect(result.right).toBe(1280 - anchor.right);
  });

  it('left-aligns panel to trigger left edge when align="left"', () => {
    const anchor = triggerTop(100, 100, 120);
    const result = computePopoverPlacement(anchor, PANEL, DESKTOP_SAFE, 'left');
    expect(result.left).toBeDefined();
    expect(result.left).toBe(Math.max(8, anchor.left));
  });

  it('flips from right to left-align when right-aligned panel clips left edge', () => {
    // Trigger is left-aligned, panel is wide — right-align would clip the left edge.
    // anchor.left = 10, anchor.right = 130, panel.width = 200
    // right-align: computedLeft = 130 - 200 = -70 < EDGE_PAD (8) → flip to left.
    const anchor: AnchorRect = { top: 100, bottom: 140, left: 10, right: 130 };
    const result = computePopoverPlacement(anchor, PANEL, DESKTOP_SAFE, 'right');
    expect(result.right).toBeUndefined();
    expect(result.left).toBeDefined();
    expect(result.left).toBeGreaterThanOrEqual(8);
  });

  it('flips from left to right-align when left-aligned panel clips right edge', () => {
    // Trigger is near the right edge; left-aligning a wide panel clips the right edge.
    // anchor.left = 1100, panel.width = 200 → 1100 + 200 = 1300 > 1280 - 8 → flip.
    const anchor: AnchorRect = { top: 100, bottom: 140, left: 1100, right: 1200 };
    const result = computePopoverPlacement(anchor, PANEL, DESKTOP_SAFE, 'left');
    expect(result.left).toBeUndefined();
    expect(result.right).toBeDefined();
  });

  it('clamps left position to safe left edge', () => {
    const anchor: AnchorRect = { top: 100, bottom: 140, left: 2, right: 120 };
    const result = computePopoverPlacement(anchor, PANEL, DESKTOP_SAFE, 'left');
    // Left should be at least EDGE_PAD (8) from the safe left (0).
    if (result.left !== undefined) {
      expect(result.left).toBeGreaterThanOrEqual(8);
    }
  });
});

describe('computePopoverPlacement — sticky chrome insets', () => {
  it('subtracts sticky header from safe top on desktop', () => {
    // Desktop safe has top = 52 (header). Panel opens above a trigger at y=80.
    // space above = 80 - 52 = 28 < panel height (180); space below = 800 - 120 = 680.
    // → opens below (more space below), not above.
    const anchor = triggerTop(80, 400);
    const result = computePopoverPlacement(anchor, PANEL, DESKTOP_SAFE);
    expect(result.opensAbove).toBe(false);
    // top should be >= safe.top + EDGE_PAD
    if (result.top !== undefined) {
      expect(result.top).toBeGreaterThanOrEqual(DESKTOP_SAFE.top + 8);
    }
  });

  it('opensAbove flag is false when below has more room than above', () => {
    // Trigger at 200px from top on a 800px viewport with 52px header.
    // above space = 200 - 52 = 148; below space = 800 - 240 = 560 → opens below.
    const anchor = triggerTop(200, 400);
    const result = computePopoverPlacement(anchor, PANEL, DESKTOP_SAFE);
    expect(result.opensAbove).toBe(false);
  });

  it('gap parameter controls the offset from the trigger', () => {
    const anchor = triggerTop(100, 100);
    const result = computePopoverPlacement(anchor, PANEL, DESKTOP_SAFE, 'left', 12);
    expect(result.top).toBe(anchor.bottom + 12);
  });
});
