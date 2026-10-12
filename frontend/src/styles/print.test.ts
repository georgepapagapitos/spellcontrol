/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// T117 guard: printable checklists (deck list, binder list) must be the
// ONLY thing that ever prints. `.print-list` is hidden on screen and
// resurrected under `@media print`, while everything else on the page is
// hidden via the `body * { visibility: hidden }` recipe — this test fails
// loudly if that contract erodes (chrome leaking into a print, or the
// checklist itself staying invisible).
const stylesRoot = join(dirname(fileURLToPath(import.meta.url)));
const printCss = readFileSync(join(stylesRoot, 'print.css'), 'utf8');
const mainTsx = readFileSync(join(stylesRoot, '..', 'main.tsx'), 'utf8');

/** Extract the body of the first `@media print { ... }` block by brace
 *  depth (nested rule blocks inside it rule out a simple regex match). */
function extractMediaPrintBlock(css: string): string {
  const start = css.indexOf('@media print');
  expect(start, '@media print block should exist').toBeGreaterThanOrEqual(0);
  const openBrace = css.indexOf('{', start);
  let depth = 0;
  for (let i = openBrace; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(openBrace + 1, i);
    }
  }
  throw new Error('Unbalanced braces in @media print block');
}

describe('print stylesheet (T117)', () => {
  it('hides .print-list on screen by default', () => {
    expect(/\.print-list\s*\{[^}]*display:\s*none/.test(printCss)).toBe(true);
  });

  it('hides everything under @media print, then un-hides only .print-list', () => {
    const block = extractMediaPrintBlock(printCss);
    expect(/body\s*\*\s*\{[^}]*visibility:\s*hidden/.test(block)).toBe(true);
    expect(/\.print-list,\s*\.print-list \*\s*\{[^}]*visibility:\s*visible/.test(block)).toBe(true);
    expect(/\.print-list\s*\{[^}]*display:\s*block/.test(block)).toBe(true);
  });

  it('is imported in main.tsx after every other global stylesheet (print rules must win)', () => {
    const styleImports = [...mainTsx.matchAll(/^import '\.\/styles\/([\w-]+)\.css';/gm)].map(
      (m) => m[1]
    );
    expect(styleImports[styleImports.length - 1]).toBe('print');
  });
});

describe('printable checklists wire up .print-list (T117)', () => {
  const componentsRoot = join(stylesRoot, '..', 'components');
  const pagesRoot = join(stylesRoot, '..', 'pages');

  it('DeckPrintList renders a .print-list checklist', () => {
    const css = readFileSync(join(componentsRoot, 'deck', 'DeckPrintList.tsx'), 'utf8');
    expect(css).toContain('className="print-list"');
  });

  it('BinderPage renders a .print-list checklist', () => {
    const css = readFileSync(join(pagesRoot, 'BinderPage.tsx'), 'utf8');
    expect(css).toContain('className="print-list"');
  });
});
