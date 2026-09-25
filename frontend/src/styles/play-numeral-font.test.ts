/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, f), 'utf8');
const board = read('play-board.css');
const effects = read('play-effects.css');
const counters = read('play-counters-panel.css');
const fonts = read('play-fonts.css');
const highroll = read('../components/play/BoardHighRoll.css');

/** The body of a standalone top-level rule (`\nSELECTOR {`, not a compound
 *  selector containing SELECTOR as a substring, not nested/indented), up to
 *  its own unindented closing brace. Throws with a clear message if the
 *  exact opening isn't found — every selector here is written flush-left in
 *  its source file. */
function rule(css: string, selector: string): string {
  const open = `\n${selector} {`;
  const start = css.indexOf(open);
  expect(start, `${selector} (standalone, top-level) is missing`).toBeGreaterThan(-1);
  const end = css.indexOf('\n}\n', start);
  return css.slice(start, end);
}

/**
 * E416: every board numeral — the life total, the ± step glyphs, the
 * running burst count, the commander-damage split-half values and the High
 * Roll value — reads the same self-hosted Bebas Neue with tabular figures,
 * via one shared token (`--font-numeral`, declared on `.player-panel`) so
 * the family lives in exactly one place. A numeral that falls back to the
 * app's mono face (missing `--font-numeral`) or proportional digits
 * (missing tabular-nums) is a silent mismatch — nothing else catches it,
 * since CSS isn't typecheck/lint-gated. Weight 400 everywhere: it's the
 * only weight this face ships, and requesting a heavier one would ask the
 * browser to synthesize a faux-bold, which smears a condensed face.
 */
describe('board numerals share one Bebas Neue tabular face', () => {
  it('the shared token points at Bebas Neue with a mono fallback', () => {
    expect(board).toContain("--font-numeral: 'Bebas Neue', var(--font-mono);");
  });

  it('the face is self-hosted at weight 400 only, loaded by the play-board chunk', () => {
    expect(fonts).toMatch(/font-family:\s*'Bebas Neue'/);
    expect(fonts).toMatch(/font-weight:\s*400/);
    expect(fonts).toMatch(/font-display:\s*swap/);
    expect(fonts).toContain("url('/fonts/bebas-neue-400-latin.woff2')");
    // Loaded only by PlayPage.tsx (the lazy play-board chunk), never
    // main.tsx — css-chunk-ownership.test.ts covers the general contract;
    // this pins the specific import site so it can't quietly move to a page
    // that isn't lazy.
    const playPage = read('../pages/PlayPage.tsx');
    expect(playPage).toContain("import '@/styles/play-fonts.css'");
  });

  for (const [label, css, selector] of [
    ['life numeral', board, '.player-panel-life'],
    ['± step glyph', board, '.player-panel-step-btn'],
    ['burst count', effects, '.player-panel-step-count'],
    ['commander-damage split value', counters, '.pp-cmd-half-value'],
    ['High Roll value', highroll, '.pp-highroll-value'],
  ] as const) {
    it(`${label} (${selector}) uses the shared token at weight 400 with tabular figures`, () => {
      const body = rule(css, selector);
      expect(body, label).toMatch(/font-family:\s*var\(--font-numeral\)/);
      expect(body, label).toMatch(/font-weight:\s*400/);
      expect(body, label).toMatch(/font-variant-numeric:\s*tabular-nums/);
    });
  }

  it('the button-chrome reset no longer fights the numeral for font-family', () => {
    // E416: `.player-panel-life-btn` and `.player-panel-life` are the SAME
    // element (two classes on one button) — an `inherit` here beat the
    // numeral's own font-family by cascade order (this file loads after
    // play-board.css), silently keeping the numeral on the mono fallback.
    // Only one of the two may declare font-family. (Strip comments first —
    // this rule's own explanatory comment names the banned property.)
    const body = rule(effects, '.player-panel-life-btn').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body).not.toMatch(/font-family:\s*inherit/);
  });
});
