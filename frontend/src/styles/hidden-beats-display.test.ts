/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `hidden` is not a strong enough hide.
 *
 * Every collapsible section in the deck list hides its body by putting the
 * `hidden` attribute on it — which is nothing but `display: none` in the
 * browser's own stylesheet, and therefore loses to ANY author rule that gives
 * that element a `display` of its own. `.deck-card-grid { display: grid }` and
 * `.deck-section-rows { display: flex }` both did, so collapsing a section in
 * the grid, stacks or list layout turned the chevron, narrowed the stack, set
 * `aria-expanded="false"` — and left all 34 lands on screen. It reads as a
 * dead control, not as a broken one, which is why it survived.
 *
 * Nothing warns about this: the markup is correct, the CSS is correct, and the
 * cascade quietly resolves the wrong way. A component test cannot see it
 * either — `DeckDisplay.tag-lens.test.tsx` asserts the collapsed list's
 * `.hidden` is `true` and passed green throughout, because happy-dom renders
 * no stylesheet. The bug only exists once the CSS is applied, so the guard has
 * to read the CSS. It works from the JSX
 * side — it finds every element that collapses with `hidden`, and fails if the
 * class it carries sets a `display` that the attribute cannot beat.
 */

function files(dir: string, ext: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, ext, out);
    else if (name.endsWith(ext)) out.push(p);
  }
  return out;
}

/** Classes on an element that is hidden by the `hidden` attribute. */
function hiddenClasses(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of [...files(srcRoot, '.tsx')]) {
    const src = readFileSync(file, 'utf8');
    // Opening tags carrying a `hidden={…}` prop, across line breaks.
    for (const tag of src.match(/<[a-zA-Z][^>]*?\shidden=\{[\s\S]*?>/g) ?? []) {
      const cls = tag.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);
      if (!cls) continue;
      for (const token of (cls[1] ?? cls[2]).split(/\s+/)) {
        // Template holes (`grid-${zoom}`) and conditionals aren't literal names.
        if (!token || token.includes('$') || token.includes('{')) continue;
        if (!found.has(token)) found.set(token, relative(srcRoot, file));
      }
    }
  }
  return found;
}

/** Top-level rules of the form `.foo { … }` — a bare class, no combinators. */
function displayByClass(): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of files(srcRoot, '.css')) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/(^|[},])\s*\.([\w-]+)\s*\{([^}]*)\}/g)) {
      const display = m[3].match(/(?:^|[;{\s])display\s*:\s*([\w-]+)/);
      if (display && display[1] !== 'none') out.set(m[2], display[1]);
    }
  }
  return out;
}

describe('a collapsible body that sets its own display overrides `hidden`', () => {
  const hidden = hiddenClasses();
  const display = displayByClass();
  const css = files(srcRoot, '.css')
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

  it('finds the collapsible bodies at all (the scan still works)', () => {
    // A rename that breaks the JSX scan would turn every case below green.
    expect(hidden.has('deck-card-grid')).toBe(true);
    expect(hidden.has('deck-section-rows')).toBe(true);
  });

  it('pairs every one of them with an author rule that wins', () => {
    // Two mechanisms are in use and both work: `.body[hidden]`, and the older
    // `.panel.is-collapsed .body` (the collapsed class rides the same state).
    // Either is a real `display: none` at higher specificity; what this test
    // is looking for is a body with neither.
    const guarded = (cls: string) =>
      [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].some(
        ([, selector, body]) =>
          selector.includes(`.${cls}`) &&
          (selector.includes('[hidden]') || selector.includes('is-collapsed')) &&
          /(?:^|[;{\s])display\s*:\s*none/.test(body)
      );
    const unguarded: string[] = [];
    for (const [cls, where] of hidden) {
      const own = display.get(cls);
      if (!own) continue; // no display of its own — the UA `hidden` applies
      if (!guarded(cls)) unguarded.push(`.${cls} (display: ${own}, used in ${where})`);
    }
    expect(
      unguarded,
      'these collapse with `hidden` but set their own `display`, which outranks the UA rule — add `.<class>[hidden] { display: none }`'
    ).toEqual([]);
  });
});
