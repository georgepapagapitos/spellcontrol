/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * `.settings-card-body` is a column flexbox, and a column flexbox stretches
 * every child to the row width unless the child opts out. A segmented track
 * placed directly in it therefore spans the whole card with two small
 * segments huddled at the left — the price-currency chooser on /you read as
 * an empty text field with "$ USD / € EUR" typed into it (2026-09-19).
 *
 * `display: inline-flex` is NOT the opt-out (a flex item's outer display is
 * blockified), so every intrinsic-width control that lives in a settings
 * card body must carry its own `align-self` / `width: fit-content`. This
 * guards the ones we know about; add a selector when a new one lands.
 */
const INTRINSIC_WIDTH_CONTROLS = ['.settings-currency-toggle'];

function ruleBody(css: string, selector: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const idx = stripped.indexOf(`\n${selector} {`);
  expect(idx, `${selector} rule exists`).toBeGreaterThan(-1);
  const start = stripped.indexOf('{', idx) + 1;
  return stripped.slice(start, stripped.indexOf('}', start));
}

describe('settings-card-body children keep their intrinsic width', () => {
  const css = readFileSync(join(here, 'settings-sync.css'), 'utf8');

  it('the card body is the column flexbox this guard exists for', () => {
    const body = ruleBody(css, '.settings-card-body');
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/flex-direction:\s*column/);
  });

  for (const selector of INTRINSIC_WIDTH_CONTROLS) {
    it(`${selector} opts out of the column stretch`, () => {
      const body = ruleBody(css, selector);
      expect(body).toMatch(/align-self:\s*flex-start|width:\s*fit-content/);
    });
  }
});

// The shared SegmentedControl lands in any column flexbox (the cube
// workshop's `.cube-size` stretched its Draft / Commander track across the
// panel, 2026-09-25), so the opt-out lives on the component, not per parent.
describe('the shared segmented track keeps its intrinsic width', () => {
  it('.segmented opts out of the column stretch', () => {
    const css = readFileSync(join(here, '../components/shared/form.css'), 'utf8');
    expect(ruleBody(css, '.segmented')).toMatch(/align-self:\s*flex-start|width:\s*fit-content/);
  });
});
