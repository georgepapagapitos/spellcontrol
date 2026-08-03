/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * `transition` is a SHORTHAND. The zoom layer needs several bits of preview
 * chrome to fade while `[data-zoomed]`, and the obvious way to write that is
 * one blanket rule listing them all:
 *
 *     .card-preview-track, .card-preview-panel, .card-preview-close { … }
 *
 * That rule sits at the end of the file, so for any element which ALREADY
 * declared a transition it wins on order at equal specificity and **replaces**
 * the original rather than adding to it. It shipped exactly that way in #1479
 * and silently took out two animations:
 *
 *   - `.card-preview-panel`'s `transition: height` — the Details expand /
 *     collapse, which then snapped instead of animating.
 *   - `.card-preview-close`'s `background` / `transform` hover-press feel.
 *
 * Nothing errors, nothing warns, and the shorthand reads as additive at a
 * glance — so it gets a CI guard rather than an eyeball. Elements that need
 * both must fold `opacity` into their OWN declaration; only elements with no
 * transition of their own may sit in a blanket rule.
 */
const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'footer-card-preview.css');
const css = readFileSync(cssPath, 'utf8');
/** Comments are stripped up front — several contain commas, which would
 *  otherwise split a rule head into bogus "selectors". */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `transition:` value declared for an exact standalone selector. */
function transitionsFor(selector: string): string[] {
  const out: string[] = [];
  // Rule heads that contain this selector as a whole comma-separated entry.
  const ruleRe = /([^{}]+)\{([^}]*)\}/g;
  for (const [, head, body] of bare.matchAll(ruleRe)) {
    const selectors = head
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!selectors.includes(selector)) continue;
    for (const [, value] of body.matchAll(/(?:^|;)\s*transition\s*:([^;}]*)/g)) {
      out.push(value.trim().replace(/\s+/g, ' '));
    }
  }
  return out;
}

describe('card-preview zoom fade does not clobber existing transitions', () => {
  it('keeps the panel height animation (Details expand/collapse)', () => {
    const declared = transitionsFor('.card-preview-panel');
    expect(declared.length).toBeGreaterThan(0);
    // Whichever declaration wins, height must still be animated somewhere,
    // and no later bare-opacity rule may exist to override it.
    expect(declared.some((t) => t.includes('height'))).toBe(true);
    expect(declared.every((t) => t !== 'opacity 0.2s var(--ease-out-soft)')).toBe(true);
  });

  it('keeps the close button press/hover transition', () => {
    const declared = transitionsFor('.card-preview-close');
    expect(declared.some((t) => t.includes('background'))).toBe(true);
    expect(declared.every((t) => t !== 'opacity 0.2s var(--ease-out-soft)')).toBe(true);
  });

  it('leaves the close button visible while zoomed — it is the way out', () => {
    // The faded-chrome rule must NOT list the close button: with every control
    // gone, a zoomed card is a full-bleed image with no visible exit.
    const fadeRule = css.match(
      /\/\* Chrome steps aside while zoomed[\s\S]*?\{\s*opacity:\s*0;[\s\S]*?\}/
    );
    expect(fadeRule, 'zoom fade rule not found — did the comment change?').toBeTruthy();
    expect(fadeRule![0]).not.toContain('.card-preview-close');
    // …and it must outrank the zoom layer (z-index 4) so it stays tappable.
    expect(css).toMatch(/\[data-zoomed='true'\]\s+\.card-preview-close\s*\{\s*z-index:\s*5/);
  });
});
