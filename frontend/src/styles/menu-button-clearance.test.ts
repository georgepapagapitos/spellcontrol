/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The decks and binders lists park an absolutely-positioned ⋮ in each row and
// reserve a right gutter so the name and meta can't slide under it. The
// gutters were literals (2.75rem, 2.25rem, 2.6rem) sized for the mouse button,
// while the coarse pointer grows that button to 44px. Measured at 390px with
// touch emulation, text could run 8-16px under the ⋮ in the decks list, the
// decks compact list and the binders compact list, and 2.4px under it in the
// decks compact list with a mouse. Every gutter now reads the button's own
// size from one variable, which the coarse block grows.
const here = dirname(fileURLToPath(import.meta.url));

const SHEETS = [
  {
    file: 'deck-builder-decks-index.css',
    card: '.decks-index-card',
    button: '.decks-index-card-menu-btn',
    gutters: [
      '.decks-index-list.is-list .decks-index-card-link',
      '.decks-index-list.is-compact .decks-index-card-link',
    ],
  },
  {
    file: 'deck-builder-binders-index.css',
    card: '.binders-index-card',
    button: '.binders-index-card-menu-btn',
    gutters: [
      '.binders-index-list.is-grid .binders-index-card-name',
      '.binders-index-list.is-compact .binders-index-card-link',
    ],
  },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const bodies = (css: string, selector: string) =>
  [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${escape(selector)}\\s*\\{([^}]*)\\}`, 'g'))].map(
    (m) => m[1]
  );

describe('list rows clear their ⋮ at every pointer size', () => {
  for (const { file, card, button, gutters } of SHEETS) {
    const css = readFileSync(join(here, file), 'utf8');

    it(`${button} is sized by --menu-btn`, () => {
      expect(bodies(css, card).join('\n')).toMatch(/--menu-btn:/);
      const rest = bodies(css, button).find((b) => /(^|\s)width:/.test(b));
      expect(rest, `${button} sets no width`).toMatch(/width:\s*var\(--menu-btn\)/);
    });

    it(`${file} grows --menu-btn on a coarse pointer`, () => {
      const coarse = css
        .split(/@media\s*\(pointer:\s*coarse\)/)
        .slice(1)
        .join('\n');
      expect(coarse).toMatch(
        new RegExp(`${escape(card)}[^{]*\\{[^}]*--menu-btn:\\s*var\\(--touch-target\\)`)
      );
    });

    for (const gutter of gutters) {
      it(`${gutter} reserves its gutter from --menu-btn`, () => {
        const found = bodies(css, gutter).join('\n');
        expect(found, `no rule for ${gutter}`).not.toBe('');
        expect(found).toMatch(/padding(-right)?:[^;]*calc\(var\(--menu-btn\)/);
      });
    }
  }
});
