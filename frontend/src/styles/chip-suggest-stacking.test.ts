/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Inside a scrolling dialog body an absolute popover gets clipped, so these
 * suggestion lists are flowed in-line there (`position: static`). An in-flow
 * list is then a flex item of its wrapper: if that wrapper is a flex ROW, the
 * list lands beside the input and the input stretches to the list's height.
 * The binder rules Type line field grew a ~250px-tall input that way
 * (2026-10-05). Each wrapper of a list that can go static must stack: a
 * column flexbox or a plain block.
 */
const STATIC_POPOVERS: { list: string; wrapper: string; file: string }[] = [
  {
    list: '.chip-suggest-list',
    wrapper: '.chip-builder-input-wrap',
    file: 'binder-rules-editor.css',
  },
  { list: '.set-filter-results', wrapper: '.set-filter-picker', file: 'collection.css' },
];

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function ruleBody(css: string, selector: string): string {
  const idx = css.indexOf(`\n${selector} {`);
  expect(idx, `${selector} rule exists`).toBeGreaterThan(-1);
  const start = css.indexOf('{', idx) + 1;
  return css.slice(start, css.indexOf('}', start));
}

describe('in-flow suggestion lists stack under their input', () => {
  const editorCss = stripComments(readFileSync(join(here, 'binder-rules-editor.css'), 'utf8'));

  for (const { list, wrapper, file } of STATIC_POPOVERS) {
    it(`${list} really goes static inside a dialog`, () => {
      expect(editorCss).toMatch(
        new RegExp(`\\.modal-body ${list.replace('.', '\\.')}[^{]*\\{[^}]*position:\\s*static`)
      );
    });

    it(`${wrapper} is not a flex row`, () => {
      const body = ruleBody(stripComments(readFileSync(join(here, file), 'utf8')), wrapper);
      const isFlex = /display:\s*(inline-)?flex/.test(body);
      if (isFlex) expect(body).toMatch(/flex-direction:\s*column/);
      else expect(body).not.toMatch(/display:\s*(inline-)?grid/);
    });
  }
});
