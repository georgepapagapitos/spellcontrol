/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Two invisible invariants of the card/binder preview sheets. Neither errors,
 * warns, nor shows up in a diff review — both have already shipped broken once.
 *
 * 1. **`touch-action` must keep `pinch-zoom`.** Zooming a card is the
 *    browser's own gesture (the hand-rolled zoom layer was deleted), and
 *    `touch-action` INTERSECTS down the ancestor chain: a bare
 *    `touch-action: pan-x` anywhere between the card and the viewport takes
 *    native pinch-zoom away entirely — silently, with the carousel still
 *    swiping perfectly. Every restricted value on these surfaces must spell
 *    `pinch-zoom` out.
 *
 * 2. **`transition` is a SHORTHAND.** A blanket rule listing several elements
 *    sits at the end of the file, so for any element that ALREADY declared a
 *    transition it wins on order at equal specificity and **replaces** the
 *    original rather than adding to it. #1479 shipped exactly that and took
 *    out `.card-preview-panel`'s `height` animation (Details expand/collapse)
 *    and `.card-preview-close`'s hover/press feel. Elements needing both must
 *    fold the new property into their OWN declaration.
 */
const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'footer-card-preview.css');
const css = readFileSync(cssPath, 'utf8');
/** Comments are stripped up front — several contain commas, which would
 *  otherwise split a rule head into bogus "selectors". */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every value declared for `prop` under an exact standalone selector. */
function declarationsFor(selector: string, prop: string): string[] {
  const out: string[] = [];
  const ruleRe = /([^{}]+)\{([^}]*)\}/g;
  for (const [, head, body] of bare.matchAll(ruleRe)) {
    const selectors = head
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!selectors.includes(selector)) continue;
    for (const [, value] of body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:([^;}]*)`, 'g'))) {
      out.push(value.trim().replace(/\s+/g, ' '));
    }
  }
  return out;
}

// Every node a finger lands on between the card image and the viewport.
const gestureSurfaces = [
  '.card-preview-track',
  '.card-preview-panel-inner',
  '.binder-pages-sheet',
  '.binder-pages-track',
];

describe('preview sheets never take native pinch-zoom away', () => {
  it.each(gestureSurfaces)('%s keeps pinch-zoom in its touch-action', (selector) => {
    const declared = declarationsFor(selector, 'touch-action');
    for (const value of declared) {
      // `auto` and `manipulation` already permit pinch-zoom; anything naming
      // an axis has opted out of it and must opt back in.
      if (value === 'auto' || value === 'manipulation') continue;
      expect(value, `${selector} { touch-action: ${value} } kills native zoom`).toContain(
        'pinch-zoom'
      );
    }
  });

  it('covers the surfaces that actually declare a touch-action', () => {
    // Guards the guard: if a selector is renamed, `declarationsFor` quietly
    // returns [] and every assertion above passes vacuously.
    const covered = gestureSurfaces.filter((s) => declarationsFor(s, 'touch-action').length > 0);
    expect(covered).toEqual(gestureSurfaces);
  });
});

describe('blanket rules do not clobber existing transitions', () => {
  it('keeps the panel height animation (Details expand/collapse)', () => {
    const declared = declarationsFor('.card-preview-panel', 'transition');
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.some((t) => t.includes('height'))).toBe(true);
    expect(declared.every((t) => t !== 'opacity 0.2s var(--ease-out-soft)')).toBe(true);
  });

  it('keeps the close button press/hover transition', () => {
    const declared = declarationsFor('.card-preview-close', 'transition');
    expect(declared.some((t) => t.includes('background'))).toBe(true);
    expect(declared.every((t) => t !== 'opacity 0.2s var(--ease-out-soft)')).toBe(true);
  });
});
