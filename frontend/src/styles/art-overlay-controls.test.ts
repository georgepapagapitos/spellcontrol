/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(src, f), 'utf8');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A control painted straight onto card art has no background of its own to
 * read against, and art can be any colour. The binder and deck tile ⋮ were a
 * white glyph with a drop shadow, which users reported as hard to see: it
 * vanished on pale and busy art (E466). Every such control paints a solid
 * surface under its glyph at rest. A new control over art belongs in this
 * list. (The deck header's menu used to sit on the phone's full-bleed art;
 * the art is a thumbnail beside the title now, so nothing overlays it.)
 */
const OVER_ART: Array<[file: string, selector: string]> = [
  [
    'styles/deck-builder-binders-index.css',
    '.binders-index-list.is-grid .binders-index-card-menu-btn',
  ],
  ['styles/deck-builder-decks-index.css', '.decks-index-list.is-grid .decks-index-card-menu-btn'],
];

/** Every `selector { … }` body in the file (at any nesting depth). */
const rules = (css: string, selector: string) =>
  [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${escape(selector)}\\s*\\{([^}]*)\\}`, 'g'))].map(
    (m) => m[1]
  );

describe('controls over card art paint their own surface', () => {
  for (const [file, selector] of OVER_ART) {
    it(`${selector} has a solid surface at rest`, () => {
      const bodies = rules(read(file), selector);
      expect(bodies.length, `no ${selector} rule in ${file}`).toBeGreaterThan(0);
      const rest = bodies.find((b) => /(^|\s|;)background:/.test(b));
      expect(rest, `${selector} sets no background at rest`).toBeTruthy();
      expect(rest).toMatch(/background:\s*var\(--surface\)/);
      expect(bodies.join('\n')).not.toMatch(/filter:\s*drop-shadow/);
    });
  }

  it('the tile ⋮ keeps its 44px coarse target on a ghost, not its painted square', () => {
    for (const [file, selector] of OVER_ART.slice(1)) {
      const ghost = rules(read(file), `${selector}::after`)[0];
      expect(ghost, `no coarse ${selector}::after ghost in ${file}`).toBeTruthy();
      expect(ghost).toContain('width: 44px');
      expect(ghost).toContain('height: 44px');
      expect(ghost).toContain('translate(-50%, -50%)');
    }
  });
});
