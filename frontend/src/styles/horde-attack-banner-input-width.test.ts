// @vitest-environment node
/**
 * Guard: the horde attack banner's Damage field must stay wide enough for a
 * life-sized 3-digit value ("999"). E387 PR 5 clipped it twice: first
 * `border-box` counted the shared input rule's padding inside the width
 * ("32" rendered as "3"), then even after switching to `content-box`, the
 * native `type="number"` spin buttons rendered INSIDE the content box and
 * re-clipped it ("14" as "1") — which is also why the field is a
 * `type="text"`/`inputMode="numeric"` field, not a number input, and why it
 * uses a monospace/tabular-nums font (a proportional font's "0" glyph, what
 * `ch` measures, understates how wide a real digit renders).
 *
 * happy-dom performs no layout, so a rendered `getComputedStyle` check here
 * would only read back whatever this file already declares — a spec-shaped
 * assertion against the stylesheet source is the real guard.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'horde-table.css'), 'utf8');

function ruleBody(selector: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const idx = stripped.indexOf(`${selector} {`);
  if (idx === -1) throw new Error(`No rule found for "${selector}"`);
  const close = stripped.indexOf('}', idx);
  return stripped.slice(idx, close);
}

describe('horde attack banner damage field width', () => {
  const body = ruleBody('.horde-attack-banner-input input');

  it('is a content-box ch width of at least 3 (a life-sized 3-digit value)', () => {
    expect(body).toMatch(/box-sizing:\s*content-box/);
    const m = /width:\s*(\d+(?:\.\d+)?)ch/.exec(body);
    expect(m, `expected a "Nch" width, got:\n${body}`).toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(3);
  });

  it('uses a monospace, tabular-nums font — not the default proportional one', () => {
    expect(body).toMatch(/font-family:\s*var\(--font-mono\)/);
    expect(body).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });
});
