// @vitest-environment node
/**
 * Guard: a board overlay that portals to `<body>` must clear `--z-overlay`.
 *
 * The board is `.playtest-page`, `position: fixed` at `--z-overlay` (1100).
 * Anything portaled to `<body>` is a SIBLING of that, so the 900-series
 * `--z-table-*` tokens do not apply to it — they only order things inside the
 * page. A body-portaled overlay at `--z-table-banner` (902) is painted under
 * the entire board and is invisible, with nothing in the DOM, the type system
 * or any render test to say so.
 *
 * That is not hypothetical: `TriggerReminder` shipped at 902 and reached
 * production 100% covered by the board, found only by driving a real browser.
 * `TableMoments` — the portal idiom it was copied from — had it right at
 * `--z-overlay`; the portal was copied and the z-index was not.
 *
 * jsdom does not load stylesheets and the render tests portal into a bare
 * body, so no component test can see this. Reading the stylesheet can.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const css = (name: string) => readFileSync(join(here, name), 'utf8');

/** The z-index of the first rule for `selector` in `source`. */
function zIndexOf(source: string, selector: string): string | null {
  const start = source.indexOf(`${selector} {`);
  if (start === -1) return null;
  const block = source.slice(start, source.indexOf('}', start));
  return /z-index:\s*([^;]+);/.exec(block)?.[1].trim() ?? null;
}

describe('TriggerReminder stacking', () => {
  it('sits at the same layer as the other body-portaled board overlays', () => {
    expect(zIndexOf(css('TriggerReminder.css'), '.trigger-reminder')).toBe('var(--z-overlay)');
  });

  it('is the layer TableMoments uses, since it copies that portal', () => {
    expect(zIndexOf(css('TableMoments.css'), '.table-moment')).toBe('var(--z-overlay)');
  });

  it('does not reach for a --z-table-* token, which cannot order a body sibling', () => {
    expect(css('TriggerReminder.css')).not.toMatch(/z-index:\s*var\(--z-table-/);
  });
});
