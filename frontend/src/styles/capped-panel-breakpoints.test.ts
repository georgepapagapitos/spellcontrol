/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Guards a silent-failure class the 2026-09 sort-editor overflow exposed (E299):
// a layout breakpoint that governs content inside a WIDTH-CAPPED panel must key
// off the container, not the viewport.
//
// The sort editor's row grid needs ~411px to seat its four tracks (index,
// field picker, direction chip, reorder cluster). Its two-line fallback existed
// and was correct — but it was gated on `@media (max-width: 600px)`, and the
// popover that hosts the editor is capped at `min(26rem, 100vw - 2rem)`. So the
// panel's content box is ~387px at EVERY viewport at or above 600px: the
// trailing `1fr` track was starved to 79px, the 103px-wide reorder cluster
// overflowed it, and the row spilled past the panel's border. Measured at
// 23.1px over at 1440px, 1024px and 717px alike — a desktop bug that a viewport
// breakpoint structurally could not catch. 599px was clean, which is exactly
// why it read as "already handled on mobile".
//
// The rule this encodes: when a panel's width is decoupled from the viewport,
// only a container query asks the right question.

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(srcRoot, rel), 'utf8');

/** The at-rule prelude wrapping the rule where `selector` sets `decl`. */
function wrappingAtRule(css: string, selector: string, decl: string): string | null {
  // Find the occurrence of `selector` whose own block contains `decl` — not
  // merely the first, which is the unwrapped base rule.
  let idx = -1;
  for (let at = css.indexOf(selector); at !== -1; at = css.indexOf(selector, at + 1)) {
    const open = css.indexOf('{', at);
    const close = css.indexOf('}', open);
    if (open === -1 || close === -1) continue;
    if (css.slice(open, close).includes(decl)) {
      idx = at;
      break;
    }
  }
  if (idx === -1) return null;
  const before = css.slice(0, idx);
  const lastOpen = Math.max(before.lastIndexOf('@media'), before.lastIndexOf('@container'));
  if (lastOpen === -1) return null;
  return before.slice(lastOpen, before.indexOf('{', lastOpen)).trim();
}

describe('breakpoints inside width-capped panels', () => {
  const rules = read('styles/binder-rules-editor.css');
  const controls = read('styles/search-controls.css');

  it('.sort-editor declares a layout container', () => {
    // Without this the @container query below silently never matches: an
    // unmatched container query is not an error, it just never applies — the
    // same "nothing throws, the UI just misbehaves" shape as the original bug.
    expect(rules).toMatch(/\.sort-editor\s*\{[^}]*container-type:\s*inline-size/);
  });

  it('the sort-row column fallback is a container query, not a viewport one', () => {
    // The narrow layout is identified by the 3-track grid it sets.
    const at = wrappingAtRule(
      rules,
      '.sort-editor-list',
      'grid-template-columns: auto minmax(0, 1fr) auto'
    );
    expect(at).not.toBeNull();
    expect(at).toMatch(/^@container/);
    expect(at).not.toMatch(/^@media/);
  });

  it('the sort popover sizes itself explicitly, not from its content', () => {
    // Two things ride on this. (1) It is the cap that decouples the panel from
    // the viewport, which is what makes the container query above necessary
    // rather than a style preference. (2) `container-type: inline-size` brings
    // inline-axis size containment, so a `width: max-content` panel measures a
    // child reporting as empty and collapses to its min-width — observed, the
    // panel dropped 416px → 352px and folded rows that had room to stay on one
    // line. An explicit width is immune, and keeps the container query from
    // measuring a width that depends on the layout the query itself picks.
    expect(controls).toMatch(/\.sort-popover-panel\s*\{[^}]*\bwidth:\s*min\(/);
    const block = controls.slice(controls.indexOf('.sort-popover-panel'));
    const body = block.slice(0, block.indexOf('}'));
    expect(body).not.toMatch(/width:\s*max-content/);
  });

  it('no sort-editor layout rule is gated on a viewport width again', () => {
    // Direction/touch-target rules may legitimately use @media (pointer: coarse);
    // what must not come back is a WIDTH media query around the row layout.
    const widthMediaBlocks = [...rules.matchAll(/@media\s*\([^)]*(?:max|min)-width[^)]*\)\s*\{/g)];
    for (const m of widthMediaBlocks) {
      const block = rules.slice(m.index!, m.index! + 600);
      expect(
        block.includes('.sort-editor-list') || block.includes('.sort-editor-actions'),
        `A width media query wraps sort-editor layout again: ${m[0]}`
      ).toBe(false);
    }
  });
});
