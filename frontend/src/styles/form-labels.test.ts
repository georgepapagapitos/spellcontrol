/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, f), 'utf8');

/** Every selector list whose body sets `text-transform: uppercase`. */
function uppercaseSelectors(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/text-transform:\s*uppercase/.test(m[2])) {
      out.push(...m[1].split(',').map((s) => s.trim()));
    }
  }
  return out;
}

/**
 * Uppercase is a HEADING role in a form, never an option's (STYLE_GUIDE §
 * Config surfaces). `.field label` used to uppercase every label inside a
 * field, checkbox labels included, so the binder editor's options read as
 * section headings: "DOUBLE-SIDED", "FIXED", "SHOW CARDS THAT ARE IN A DECK".
 */
describe('form labels', () => {
  it('a bare `.field label` selector never carries the uppercase role', () => {
    const selectors = uppercaseSelectors(read('forms-banners.css'));
    expect(selectors.length, 'read the stylesheet at all').toBeGreaterThan(0);
    for (const sel of selectors) {
      if (!/\.field\s+label\b/.test(sel)) continue;
      expect(sel, `${sel} would uppercase a checkbox option`).toContain(':not(.field-checkbox)');
    }
  });

  it('the kit keeps uppercase on headings and off field and option labels', () => {
    const selectors = uppercaseSelectors(read('../components/shared/form.css'));
    expect(selectors).toContain('.form-section-heading');
    for (const bad of [
      '.form-field-label',
      '.switch-row-label',
      '.choice-option-label',
      '.segmented-option span',
    ]) {
      expect(selectors, `${bad} is an option or field label`).not.toContain(bad);
    }
  });
});
