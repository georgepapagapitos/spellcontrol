/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'playtest.css'), 'utf8');
const quadrant = readFileSync(
  join(here, '..', 'playtest', 'components', 'OpponentQuadrant.css'),
  'utf8'
);

/** Every rule in the sheet whose selector ends with `selector`, declarations only. */
function rules(sheet: string, selector: string): string[] {
  const out: string[] = [];
  for (const m of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().split('\n').pop()!.trim();
    if (sel === selector) out.push(m[2].replace(/\s+/g, ' ').trim());
  }
  return out;
}

/**
 * The zone shelf rests ON the table's edge, like a stack of real cards pushed
 * to the near side — not on a margin above it, which reads as a floating tray.
 *
 * The edge is not `0`. The felt's turn ring is an inset band, and a pile laid
 * across it cuts a notch out of the one border the board wears. Both the ring
 * and the shelf therefore read a single token, `--pt-table-edge`: the shelf
 * sits exactly where the band ends. Hard-code either one and they drift apart
 * the first time the ring's weight is touched.
 */
describe('the zone shelf’s tuck', () => {
  it('rests on the table edge at every tier, never on a spacing gap', () => {
    const withBottom = rules(css, '.playtest-piles').filter((r) => /(?<![-\w])bottom\s*:/.test(r));
    // The base rule plus any tier override that repositions it — all of them,
    // or the tier that opts out is the one that floats.
    expect(withBottom.length).toBeGreaterThan(0);
    for (const r of withBottom) {
      expect(r).toMatch(/(?<![-\w])bottom:\s*var\(--pt-table-edge\)/);
    }
  });

  it('shows a slice of the top card, not most of it', () => {
    // The exact ratio is pinned in playtest-table-chrome.test.ts, which owns
    // the shelf's peek. Here it only has to stay a slice: at much more than
    // this the piles stop reading as cards at the edge and become a fifth row.
    const stack = rules(css, '.playtest-pile__stack')[0] ?? '';
    const height = /(?<![-\w])height:\s*calc\(var\(--pt-card-h\)\s*\*\s*([\d.]+)\)/.exec(stack);
    expect(height).not.toBeNull();
    expect(Number(height![1])).toBeLessThanOrEqual(0.4);
  });

  it('is squared off where the edge cuts it', () => {
    const stack = rules(css, '.playtest-pile__stack')[0] ?? '';
    // Four-value radius with two zeros at the end: rounded on top, cut below.
    expect(stack).toMatch(/border-radius:\s*[^;]+\s0\s+0\s*;/);
  });

  it('shares one edge width with the turn ring it tucks against', () => {
    for (const sheet of [css, quadrant]) {
      const ring = /box-shadow:\s*inset 0 0 0 ([^\s]+) var\(--brand-seal-gold\)/.exec(sheet);
      expect(ring).not.toBeNull();
      expect(ring![1]).toBe('var(--pt-table-edge)');
    }
  });
});
