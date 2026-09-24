/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * On a phone a modal sheet owns the bottom of the screen, and so does the toast
 * stack. The post-generation build report arrived with "Published. Anyone can
 * view it at …" painted over its last lines, right above its own button. While
 * any aria-modal dialog is open, the stack moves to the top on phones.
 */
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'deck-builder-toast.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

describe('toasts over an open sheet', () => {
  it('moves the phone toast stack to the top while a modal is open', () => {
    const block = css.match(/@media\s*\(max-width:\s*599px\)\s*\{([\s\S]*?\})\s*\}/)?.[1] ?? '';
    const rule = block.match(
      /body:has\(\[aria-modal=['"]true['"]\]\)\s+\.toast-viewport\s*\{([^}]*)\}/
    )?.[1];
    expect(rule, 'no aria-modal toast rule under the phone query').toBeDefined();
    // `inset: top right bottom left`: a top offset from the safe area, bottom auto.
    expect(rule).toMatch(
      /inset:\s*calc\([^;]*var\(--safe-top\)[^;]*\)\s+calc\([^;]*\)\s+auto\s+calc/
    );
  });
});
