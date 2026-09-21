// @vitest-environment node
/**
 * Guard: the hold banner and the takeback consent prompt can both be live at
 * once, and must not land on each other.
 *
 * Both are centred, body-portaled banners with fixed top offsets — hold at
 * `3.25rem`, consent at `6rem`. That is 44px of clearance, which only survives
 * a ONE-LINE hold message. The hold summary is free text a seat types, and a
 * pod holding for a complicated stack does not write four words: measured in a
 * browser at 1440x900, a two-line hold banner is 56px tall and overlaps the
 * consent prompt by 20px. `HoldBanner.css` states the two "must never visually
 * collide when both are live at once", so this is the rule that makes the
 * statement true.
 *
 * jsdom does not lay out or load CSS, so no render test can catch this — the
 * same blind spot that let five overlays ship painted under the board
 * (see `playtest/components/body-portal-stacking.test.ts`). Reading the
 * stylesheet is what is left.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'playtest.css'), 'utf8');

describe('hold banner vs takeback consent', () => {
  it('steps the consent prompt down while a hold is on screen', () => {
    expect(css).toMatch(
      /body:has\(\.playtest-hold-banner\)\s+\.playtest-takeback-consent\s*\{[^}]*top:/
    );
  });

  it('steps it down far enough to clear a two-line hold banner', () => {
    const rule =
      /body:has\(\.playtest-hold-banner\)\s+\.playtest-takeback-consent\s*\{([^}]*)\}/.exec(css);
    const rem = Number(/top:\s*calc\(var\(--safe-top\)\s*\+\s*([\d.]+)rem\)/.exec(rule![1])![1]);
    // The hold banner starts at 3.25rem and is 56px (3.5rem) tall at two
    // lines, so anything at or below 6.75rem is still a collision.
    expect(rem).toBeGreaterThan(6.75);
  });
});
