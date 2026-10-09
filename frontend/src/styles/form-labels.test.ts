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
 * No form text is uppercase (E595; styles/uppercase-role.test.ts holds the
 * global rule). It used to be a HEADING role in a form (STYLE_GUIDE § Config
 * surfaces): `.field label` uppercased every label inside a field, checkbox
 * labels included, so the binder editor's options read as section headings:
 * "DOUBLE-SIDED", "FIXED", "SHOW CARDS THAT ARE IN A DECK". Now field labels,
 * option labels and block headings are all sentence case.
 */
describe('form labels', () => {
  it('forms-banners.css uppercases no field label', () => {
    expect(uppercaseSelectors(read('forms-banners.css'))).toEqual([]);
  });

  it('the config kit uppercases neither headings nor field and option labels', () => {
    expect(uppercaseSelectors(read('../components/shared/form.css'))).toEqual([]);
  });
});
