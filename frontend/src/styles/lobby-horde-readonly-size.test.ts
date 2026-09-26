// @vitest-environment node
/**
 * Guard: a joiner's read-only horde pick in the online lobby is one tile, not
 * a poster. `.horde-tile` is `width: 100%` because it normally sits in the
 * picker's grid; the read-only tile sits alone in the lobby column, and
 * without a cap it rendered the horde's art full-width above the seats
 * (found playing a two-seat Horde table, E387). happy-dom performs no
 * layout, so the rule itself is the thing to pin.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'components', 'play', 'OnlineLobby.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

describe("the joiner's read-only horde tile", () => {
  it('is capped at one tile width', () => {
    const idx = css.indexOf('.lobby-horde-readonly {');
    expect(idx, 'no .lobby-horde-readonly rule').toBeGreaterThan(-1);
    const body = css.slice(idx, css.indexOf('}', idx));
    const m = /max-width:\s*(\d+(?:\.\d+)?)rem/.exec(body);
    expect(m, `expected a rem max-width, got:\n${body}`).toBeTruthy();
    expect(Number(m![1])).toBeLessThanOrEqual(16);
  });
});
