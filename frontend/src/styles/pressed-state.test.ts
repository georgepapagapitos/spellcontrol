/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The baseline pressed state (base-layout.css) is a FLOOR: it only applies to
// controls that never defined their own `:active`. That only holds while its
// specificity stays below a bespoke `.foo:active` (0,2,0) — and `:not()` takes
// the specificity of its argument, so writing the disabled guards bare turns
// `button:active:not(:disabled)` into (0,2,1), which outranks every bespoke
// rule instead of yielding to it.
//
// That shipped once. Its loudest symptom: `.game-board-menu-btn` /
// `.game-board-undo-btn` center themselves on the board seam with
// `transform: translate(-50%, -50%)`, so having `transform` replaced by
// `translateY(1px)` dropped the centering and made the play-board hub jump
// half its own size down-and-right the moment you pressed it.
// Comments stripped first — a rule's preceding comment is otherwise captured as
// part of its selector (the same footgun base-layout.css's own comment flags).
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'base-layout.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

/** The selector attached to the baseline `transform: translateY(1px)` rule. */
const selector = (css.match(/([^{}]+)\{[^}]*transform:\s*translateY\(1px\)[^}]*\}/) ?? [])[1]
  ?.trim()
  .replace(/\s+/g, ' ');

describe('baseline pressed state', () => {
  it('exists', () => {
    expect(selector, 'no rule sets the baseline transform: translateY(1px)').toBeTruthy();
  });

  it('keeps its specificity below a bespoke .foo:active', () => {
    // Everything structural must sit inside :where() (contributes 0), leaving
    // :active as the only specificity the selector carries → (0,1,0).
    expect(
      selector,
      `baseline pressed selector is "${selector}" — every matcher except :active must ` +
        `live inside :where(), or this rule outranks the ~29 bespoke .foo:active rules ` +
        `and clobbers any transform they rely on (see the play-board seam hub)`
    ).toMatch(/^:where\(.+\):active$/);
  });

  it('still covers both native buttons and role=button, minus the disabled ones', () => {
    expect(selector).toContain('button:not(:disabled)');
    expect(selector).toContain("[role='button']:not([aria-disabled='true'])");
  });
});
