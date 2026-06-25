/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// E68 guard: responsive / cross-device primitive rulings that CSS tooling can't
// catch (CSS is not typecheck/eslint/CI-gated). These lock in the systemic fixes
// from the E68 responsive overhaul so they can't silently regress per-instance.
// See STYLE_GUIDE.md and memories project_native_grid_overflow_and_hover_gate /
// project_responsive_toolbar_pattern.
//
// CSS `?raw` imports come back empty under this vite/rolldown setup, so read the
// stylesheets off disk (tests run in the node env per vitest.config.ts).
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

// Return the balanced `{ … }` block body starting at the brace index `open`.
function balancedBlock(css: string, open: number): string {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return css.slice(open + 1);
}

const files = cssFiles(srcRoot);
const byFile = files.map((f) => ({ file: f, css: readFileSync(f, 'utf8') }));
const rel = (f: string) => f.slice(srcRoot.length + 1);

describe('responsive primitives (E68 cross-device guard)', () => {
  // Samsung Galaxy WebViews report `(hover: hover)` on touch, so a `:hover` rule
  // that changes visual state without an `and (pointer: fine)` gate sticks after
  // a tap (looks permanently "active"/"open"). A bare `@media (hover: hover)`
  // block is only safe if it contains no `:hover` selector (e.g. a cursor-only
  // rule). This is the bug class fixed in F11/F12/F19.
  it('never applies a :hover visual rule inside @media (hover: hover) without (pointer: fine)', () => {
    const offenders: string[] = [];
    const header = /@media([^{]*)\{/g;
    for (const { file, css } of byFile) {
      for (const m of css.matchAll(header)) {
        const cond = m[1];
        if (!/hover:\s*hover/.test(cond)) continue;
        if (/pointer:\s*fine/.test(cond)) continue; // correctly gated
        const block = balancedBlock(css, m.index + m[0].length - 1);
        if (/:hover\b/.test(block)) {
          const line = css.slice(0, m.index).split('\n').length;
          offenders.push(`${rel(file)}:${line} → @media (${cond.trim()}) contains a :hover rule`);
        }
      }
    }
    expect(
      offenders,
      `sticky-hover hazard — gate these with \`@media (hover: hover) and (pointer: fine)\`:\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  // F1: a global \`input[type='text'] { width: <fixed> }\` hard-caps every text
  // input app-wide and fights the SearchPill flex layout → truncated placeholder
  // / horizontal scroll on Android WebView. Width on text inputs belongs to the
  // flex/grid context or a scoped form-field selector, never the bare element.
  it("never sets a fixed width on a bare global input[type='text'] rule", () => {
    // Standalone bare selector (start-of-rule, not `.x`/`> ` scoped) opening a
    // block that declares a px/rem/em width.
    const re = /(^|\})\s*input\[type=['"]text['"]\]\s*\{([^}]*)\}/gm;
    const offenders: string[] = [];
    for (const { file, css } of byFile) {
      for (const m of css.matchAll(re)) {
        if (/\bwidth\s*:\s*[\d.]+(px|rem|em)\b/.test(m[2])) {
          const line = css.slice(0, m.index).split('\n').length;
          offenders.push(`${rel(file)}:${line} → bare input[type='text'] with a fixed width`);
        }
      }
    }
    expect(
      offenders,
      `global fixed-width text input (caps every input, truncates SearchPill placeholder):\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  // Positive invariants: the load-bearing rules behind the fixes must stay put.
  it('keeps min-width:0 on the SearchPill input so it can shrink to fit the pill', () => {
    const f = byFile.find((x) => x.file.endsWith('search-controls.css'));
    expect(f, 'search-controls.css should exist').toBeTruthy();
    // The `.search-pill > input` rule (the primitive's text field) must declare
    // min-width: 0 — without it the input can't shrink below its content width
    // and the placeholder clips.
    const block = f!.css.match(/\.search-pill\s*>\s*input\s*\{([^}]*)\}/);
    expect(block, '.search-pill > input rule should exist').toBeTruthy();
    expect(/min-width:\s*0/.test(block![1]), '.search-pill > input must keep min-width: 0').toBe(
      true
    );
  });

  it('keeps the collection toolbar row wrapping (never nowrap) so it cannot clip', () => {
    const f = byFile.find((x) => x.file.endsWith('collection.css'));
    expect(f, 'collection.css should exist').toBeTruthy();
    // The base .collection-toolbar-row must declare flex-wrap: wrap, and no rule
    // may force it to nowrap (the F16 ruling: filter/control strips wrap, never
    // clip).
    const base = f!.css.match(/\.collection-toolbar-row\s*\{([^}]*)\}/);
    expect(base, '.collection-toolbar-row base rule should exist').toBeTruthy();
    expect(/flex-wrap:\s*wrap/.test(base![1]), 'base .collection-toolbar-row must wrap').toBe(true);
    expect(
      /\.collection-toolbar-row[^{]*\{[^}]*flex-wrap:\s*nowrap/.test(f!.css),
      '.collection-toolbar-row must never be forced to nowrap'
    ).toBe(false);
  });
});
