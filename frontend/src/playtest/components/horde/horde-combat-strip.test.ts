// @vitest-environment node
/**
 * Guard: the combat total stays in the horde's reserved bottom strip, as one
 * row, on both boards that show it.
 *
 * - Solo (`HordeHalf`): `.horde-half-combat`, in `HORDE_RESERVED_BOTTOM`. It
 *   used to float at the top of your own half and cover your top row (T144).
 * - Paper table (`HordeTable`): `.horde-table-bottom`, beside the actions. It
 *   used to float top-center and cover the horde's 4th attacker onward on a
 *   landscape phone (E1035).
 *
 * Anchoring a strip by `top`, or letting the banner float or stack into a
 * column, would let it grow out of the strip and over the attackers.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const halfCss = readFileSync(join(here, 'HordeHalf.css'), 'utf8');
const tableCss = readFileSync(join(here, '../../../styles/horde-table.css'), 'utf8');

/** The rule whose selector is exactly `selector` at the start of a line (so
 *  `.horde-attack-banner` never matches `.horde-table-bottom .horde-attack-banner`). */
function block(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\s*${escaped} \\{`, 'm').exec(css);
  expect(match, `${selector} is defined`).not.toBeNull();
  const start = match!.index;
  return css.slice(start, css.indexOf('}', start));
}

describe('horde combat strip', () => {
  it.each([
    ['solo half', halfCss, '.horde-half-combat'],
    ['paper table', tableCss, '.horde-table-bottom'],
  ])('the %s strip anchors to the bottom, never the top', (_name, css, selector) => {
    const strip = block(css, selector);
    expect(strip).toContain('position: absolute');
    expect(strip).toMatch(/\bbottom:/);
    expect(strip).not.toMatch(/\btop:/);
  });

  it('the banner itself is one static row, placed by its strip', () => {
    const banner = block(tableCss, '.horde-attack-banner');
    expect(banner).toContain('flex-flow: row wrap');
    expect(banner).not.toMatch(/\bposition:/);
    expect(banner).not.toMatch(/\btop:/);
  });

  // E1035: on a phone held upright the corner (meter + buttons + piles) is
  // wider than the space beside the life box, so it split into grid items of
  // its own; centered over the felt, the status sat on life and the piles and
  // covered Next turn. Each narrow tier must keep the status on its own row
  // and give every corner piece an area, so nothing runs off the edge.
  it.each([
    ['@media (max-width: 599px)', /'meter meter'\s*'life piles'\s*'status status'/],
    [
      '@container horde-table (max-width: 359px)',
      /'piles min menu'\s*'life meter meter'\s*'status status status'/,
    ],
  ])('%s stacks the top chrome into rows', (prelude, areas) => {
    const at = tableCss.indexOf(prelude);
    expect(at, `${prelude} exists`).toBeGreaterThan(-1);
    expect(block(tableCss.slice(at), '.horde-table-top')).toMatch(areas);
  });
});
