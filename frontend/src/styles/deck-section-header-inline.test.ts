/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'deck-builder-card-list.css'), 'utf8');
const row = readFileSync(join(here, '..', 'components', 'deck', 'DeckMainboardRow.tsx'), 'utf8');

/**
 * The deck list's section header is one line: icon, title (+ gauge), optional
 * price subtotal, optional action. The Commander section is the only one that
 * renders all four — its action is the "Add/Edit partner" control — and it was
 * shipped on a three-column grid (`auto 1fr auto`). Grid auto-placement had
 * nowhere to put the 4th child, so it was explicitly pushed onto its own
 * full-width row: a partnered Commander header spent an entire stretched line
 * on a single text link, above a commander row two cards tall.
 *
 * The guard is on the layout contract, not on that one selector: the header
 * must use a line-based layout (flex), and nothing inside it may claim a row
 * of its own. A future child that needs its own line fails here.
 */
describe('deck section header stays on one line', () => {
  const block = /\.deck-section-header\s*\{([^}]*)\}/.exec(css)?.[1];

  it('lays the header out as a wrapping flex line, not a fixed column grid', () => {
    expect(block).toBeTruthy();
    expect(block).toMatch(/display:\s*flex/);
    expect(block).toMatch(/flex-wrap:\s*wrap/);
    expect(block).not.toMatch(/grid-template-columns/);
  });

  it('gives no header child a row of its own', () => {
    const childRules = [...css.matchAll(/\.deck-section-header\s*>\s*[^{]*\{([^}]*)\}/g)];
    for (const [, body] of childRules) {
      expect(body).not.toMatch(/grid-column|flex-basis:\s*100%|width:\s*100%/);
    }
  });

  it('still renders the header children the contract is about', () => {
    // Fails loudly if the header markup is restructured out from under the
    // CSS guard above (e.g. the action moves into its own wrapper element).
    expect(row).toMatch(/className="deck-section-header"/);
    expect(row).toMatch(/\{headerAction\}/);
  });
});
