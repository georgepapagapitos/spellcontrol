/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The shared `.segmented` track keeps every label on one line (`white-space:
 * nowrap` on the span), so three long labels ("Any of these", "Exactly these",
 * "Within these") are wider than a 320px popover. With no wrap and no shrink the
 * last option spilled past the track and the panel clipped it (E536, the /decks
 * filters popover). The track must wrap its options instead; `.segmented--fill`
 * opts out because its options share the width with `flex: 1 1 0`.
 */

const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, '../components/shared/form.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);
const rule = (sel: string) =>
  new RegExp(`(?:^|\\})\\s*${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

describe('.segmented reflows at narrow widths', () => {
  it('the track wraps its options instead of overflowing', () => {
    expect(rule('.segmented')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.segmented')).toMatch(/max-width:\s*100%/);
  });

  it('the label span stays nowrap, so wrapping is between options, not within one', () => {
    expect(rule('.segmented-option > span')).toMatch(/white-space:\s*nowrap/);
  });
});
