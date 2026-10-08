// @vitest-environment node
/**
 * Guard: no number input in the app shows the browser's native spin buttons.
 * Next to our own [-] [+] steppers they read as a second, cramped set of the
 * same control. The reset used to be copied per class (`.number-stepper`,
 * `.deck-row-qty-input`, `.option-card-input`, …), so every stepper built
 * outside those classes, like the add-to-collection Copies field, shipped
 * with both sets.
 *
 * The fix is one element-level reset in forms-banners.css (a boot sheet, so
 * it covers every page). This pins that rule and forbids copies elsewhere: a
 * scoped copy is redundant, and the habit of writing one is how a new stepper
 * ends up assuming the reset is its own job. If this fails, delete the copy;
 * the global rule already covers your input.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return cssFiles(p);
    return e.name.endsWith('.css') ? [p] : [];
  });
}

function ruleBody(css: string, selector: string): string {
  // Anchor on a line start so `.number-stepper input[type='number'] {` can't match.
  const idx = css.indexOf(`\n${selector} {`);
  if (idx === -1) throw new Error(`No rule found for "${selector}"`);
  return css.slice(idx, css.indexOf('}', idx));
}

describe('native number-input spin buttons', () => {
  const forms = strip(readFileSync(join(here, 'forms-banners.css'), 'utf8'));

  it('are reset once, app-wide, on every input[type=number]', () => {
    const body = ruleBody(forms, "input[type='number']");
    expect(body).toMatch(/(^|[\s;{])appearance:\s*textfield/);
    expect(body).toMatch(/-moz-appearance:\s*textfield/);

    const spin = ruleBody(
      forms,
      "input[type='number']::-webkit-inner-spin-button,\ninput[type='number']::-webkit-outer-spin-button"
    );
    expect(spin).toMatch(/-webkit-appearance:\s*none/);
    expect(spin).toMatch(/margin:\s*0/);
  });

  it('are not reset again (or re-enabled) by any other stylesheet', () => {
    const offenders = cssFiles(srcRoot)
      .filter((f) => !f.endsWith('forms-banners.css'))
      .filter((f) => /spin-button|appearance:\s*textfield/.test(strip(readFileSync(f, 'utf8'))))
      .map((f) => relative(srcRoot, f));
    expect(offenders).toEqual([]);
  });

  it('has exactly one spin-button rule in forms-banners.css', () => {
    expect(forms.match(/::-webkit-inner-spin-button/g)).toHaveLength(1);
  });
});
