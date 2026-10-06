/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

/**
 * A SegmentedControl option's label is caller markup, and callers nest their
 * own spans in it (the edit dialog's owned-finish dot, the add picker's
 * price line). The segment's chip styling — 32px/44px min-height, side
 * padding, nowrap — belongs on the ONE span SegmentedControl renders, so every
 * rule reaching it is `.segmented-option > span` (or `input + span`). A
 * descendant `.segmented-option span` also hit the 6px owned dot in the deck
 * view's Edit printing dialog and blew it up into a 32px green blob beside
 * "Foil".
 */

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return cssFiles(p);
    return e.name.endsWith('.css') ? [p] : [];
  });
}

/** `.segmented-option` (any compound/pseudo suffix) then whitespace then `span`. */
const DESCENDANT_SPAN = /\.segmented-option(?:[.:][\w-]+(?:\([^)]*\))?)*\s+span\b/;

describe('segment styling reaches only its own span', () => {
  it('the form kit styles the segment span with a child combinator', () => {
    const css = strip(readFileSync(join(src, 'components/shared/form.css'), 'utf8'));
    expect(css).toMatch(/\.segmented-option > span\s*\{[^}]*min-height:\s*32px/);
  });

  it('no stylesheet styles .segmented-option descendant spans', () => {
    const hits = cssFiles(src).flatMap((file) =>
      [...strip(readFileSync(file, 'utf8')).matchAll(/([^{}]+)\{/g)]
        .flatMap((m) => m[1].split(','))
        .map((sel) => sel.trim())
        .filter((sel) => DESCENDANT_SPAN.test(sel))
        .map((sel) => `${relative(src, file)}: ${sel}`)
    );
    expect(hits).toEqual([]);
  });
});
