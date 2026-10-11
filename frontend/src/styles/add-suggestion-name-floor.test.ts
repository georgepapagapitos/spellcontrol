/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Guard: an Add cards suggestion with two problem segments ("Short on green in
// 7%" and "Cascades into a mana creature 23%") has a meta line wide enough to
// squeeze the card name down to "Bloodbr…" on a tablet-wide sheet (verified at
// 820 in a real browser). A flow row gives its name/thumbnail trigger a floor,
// so the meta wraps first. Read off disk: CSS `?raw` imports come back empty here.
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'deck-builder-card-search.css'), 'utf8');

describe('suggestion row name floor', () => {
  it('keeps a minimum name width on a flow row above the phone breakpoint', () => {
    const block =
      /@media \(min-width: 600px\)\s*\{\s*\.inline-card-search-row:has\(\.is-flow\) \.inline-card-search-preview-trigger\s*\{([^}]*)\}/.exec(
        css
      );
    expect(block, 'min-width: 600px flow-row name floor').not.toBeNull();
    expect(block![1]).toMatch(/min-width:\s*\d+(\.\d+)?rem\s*;/);
  });

  it('stacks a two-problem row on a tablet sheet so no separator dangles', () => {
    const block = /@media \(min-width: 600px\) and \(max-width: 1023px\)\s*\{([\s\S]*?)\n\}/.exec(
      css
    );
    expect(block, 'tablet two-problem stacking block').not.toBeNull();
    expect(block![1]).toMatch(/\.card-search-problem ~ \.card-search-problem/);
    expect(block![1]).toMatch(/\.card-search-sep\s*\{\s*display:\s*none/);
    expect(block![1]).toMatch(/\.card-search-problem\s*\{\s*display:\s*block/);
  });
});
