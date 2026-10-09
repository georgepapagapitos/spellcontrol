/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Guard: .app-main is the app's single scroll container. With a classic
// (non-overlay) scrollbar, a page that overflows is 12px narrower than a
// short sibling, so a hub's tab strip shifted sideways between tabs (nightly
// journey, Firefox desktop). `scrollbar-gutter: stable` keeps the width the
// same either way. Read off disk: CSS `?raw` imports come back empty here.
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'base-layout.css'), 'utf8');

describe('.app-main scrollbar gutter', () => {
  it('reserves the scrollbar lane even when the page does not scroll', () => {
    const rule = /(^|\n)\.app-main\s*\{([^}]*)\}/.exec(css);
    expect(rule, '.app-main rule').not.toBeNull();
    expect(rule![2]).toMatch(/scrollbar-gutter:\s*stable\s*;/);
  });
});
