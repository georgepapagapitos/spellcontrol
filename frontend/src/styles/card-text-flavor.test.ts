/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Guard for flavor text in the card rules box (CardText: the card preview panel
// and the playtest Card info dialog). It was italic + muted and nothing else,
// which stopped reading as flavor three ways at once:
//  - the desktop column's body-size bump listed `.card-text-flavor`, so at
//    ≥1024px it was the same size as the rules text above it;
//  - reminder text is italic + muted too, so a last ability ending in reminder
//    text ran straight into the flavor;
//  - the keyword line ("Flying, double strike, haste") was italic, so italic
//    did not mean flavor at all.
// The fix is the printed card's own cue: a faded hairline between rules and
// flavor, flavor a size step below the rules, and italic kept for flavor and
// reminder text only. Scryfall also puts an attribution after a line break
// (Befuddle, DOM: `"…I learned that from Radha."\n—Jhoira`), which collapsed
// into one run-on line without `pre-line`.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p: string[]) =>
  readFileSync(join(srcRoot, ...p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const details = read('components', 'card', 'CardDetails.css');
const preview = read('styles', 'footer-card-preview.css');

/** Declarations of the first rule whose selector list is exactly `selector`. */
function block(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? '';
}

describe('card text flavor', () => {
  it('keeps flavor line breaks so an attribution sits on its own line', () => {
    expect(block(details, '.card-text-flavor')).toMatch(/white-space:\s*pre-line/);
  });

  it('draws a faded rule above flavor only when rules text precedes it', () => {
    const rule = block(details, '.card-text-oracle + .card-text-flavor');
    // Faded at both ends, so it can't read as the solid face divider.
    expect(rule).toMatch(
      /linear-gradient\(\s*90deg,\s*transparent,[^;]*var\(--border-strong\)[^;]*,\s*transparent\s*\)/
    );
    expect(rule).toMatch(/padding-top:\s*var\(--space-\d\)/);
    // Keyed on the sibling, never on the flavor alone (a vanilla card's
    // flavor has nothing above it to separate from).
    expect(block(details, '.card-text-flavor')).not.toMatch(/background|border-top/);
  });

  it('keeps flavor a size step below the rules in the desktop column', () => {
    // Every selector list that lifts `.card-text-line` to body size.
    const bumps = [...preview.matchAll(/([^{}]*\.card-text-line[^{}]*)\{([^}]*)\}/g)].filter(
      ([, , body]) => /font-size:\s*var\(--text-base\)/.test(body)
    );
    expect(bumps.length).toBeGreaterThan(0);
    for (const [, selectors] of bumps) expect(selectors).not.toMatch(/card-text-flavor/);
  });

  it('reserves italic in the rules box for flavor and reminder text', () => {
    for (const [, selectors, body] of details.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
      if (/font-style:\s*italic/.test(body)) expect(selectors.trim()).toBe('.card-text-flavor');
    }
  });
});
