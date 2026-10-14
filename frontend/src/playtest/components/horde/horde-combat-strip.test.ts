// @vitest-environment node
/**
 * Guard: the desktop combat total stays in the horde half's reserved bottom
 * strip (`HORDE_RESERVED_BOTTOM`, which `autoPlace` never puts a card in),
 * as one row. It used to float at the top of your own half and cover your
 * top row of permanents (T144). Anchoring it by `top`, or letting it stack
 * into a column, would let it grow out of the strip and over the horde's
 * attackers instead.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'HordeHalf.css'), 'utf8');

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} is defined`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

describe('horde combat strip', () => {
  it('anchors to the bottom of the horde half, never the top', () => {
    const strip = block('.horde-half-combat');
    expect(strip).toContain('position: absolute');
    expect(strip).toMatch(/\bbottom:/);
    expect(strip).not.toMatch(/\btop:/);
  });

  it('lays the prompt out as one row, not the floating banner column', () => {
    const banner = block('.horde-half-combat .horde-attack-banner');
    expect(banner).toContain('position: static');
    expect(banner).toContain('flex-flow: row wrap');
  });
});
