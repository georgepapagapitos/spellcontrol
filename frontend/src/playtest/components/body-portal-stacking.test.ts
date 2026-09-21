// @vitest-environment node
/**
 * Guard: every board overlay that portals to `<body>` must clear `--z-overlay`.
 *
 * The board is `.playtest-page`, `position: fixed` at `--z-overlay` (1100).
 * Anything portaled to `<body>` is a SIBLING of that, so the 900-series
 * `--z-table-*` tokens do not order it — they only order things inside the
 * page. A body-portaled overlay below 1100 is painted under the entire board
 * and is invisible, with nothing in the DOM, the type system or any render
 * test to say so. `playtest.css` already carried the same lesson for modals:
 * `body:has(.playtest-page) .modal-backdrop` is lifted to
 * `calc(var(--z-overlay) + 50)`.
 *
 * Five overlays shipped this way and reached production invisible:
 * TriggerReminder (902), HoldBanner (899), TableSignals (900),
 * TakebackPendingBanner (901) and TakebackConsentPrompt (950) — every one
 * measured 100% covered by the board on the deployed site, against
 * TableMoments at `--z-overlay` as a visible control. jsdom loads no
 * stylesheets and the render tests portal into a bare body, so no component
 * test could see any of it. Reading the stylesheets can.
 *
 * Adding a body-portaled overlay? Give it `--z-overlay` (or higher) and it
 * passes. A `--z-table-*` token belongs to elements that live INSIDE the
 * page, like `.playtest-pings` and `.playtest-zones-panel`, where it is
 * correct and must keep its relative order.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const componentsDir = dirname(fileURLToPath(import.meta.url));
const stylesDir = join(componentsDir, '..', '..', 'styles');

/** Every component here that renders through a portal into `document.body`. */
function bodyPortalComponents(): string[] {
  return readdirSync(componentsDir)
    .filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
    .filter((f) => {
      const src = readFileSync(join(componentsDir, f), 'utf8');
      return src.includes('createPortal') && src.includes('document.body');
    });
}

/**
 * The z-index of every `position: fixed` rule in a stylesheet, keyed by
 * selector. Deliberately a dumb block scan rather than a CSS parser: the
 * rules under test are flat, and a dependency-free check is one less thing
 * between a failure and its cause.
 */
function fixedRuleZIndexes(css: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const body = match[2];
    if (!/position:\s*fixed/.test(body)) continue;
    const selector = match[1].trim().split('\n').at(-1)!.trim();
    out.set(selector, /z-index:\s*([^;]+);/.exec(body)?.[1].trim() ?? null);
  }
  return out;
}

/** Tokens that sit at or above `--z-overlay` (1100) — see tokens.css. */
const CLEARS_THE_BOARD = /var\(--z-(overlay|portal-popover|tooltip)\)|calc\(\s*var\(--z-overlay\)/;

/**
 * Classes a body-portaled component renders that live in the page-level
 * stylesheet rather than a co-located one, keyed by component so a reader can
 * see why that file is consulted at all.
 */
const PAGE_LEVEL_CLASSES: Record<string, string[]> = {
  'TakebackPendingBanner.tsx': ['.playtest-takeback-pending'],
  'TakebackConsentPrompt.tsx': ['.playtest-takeback-consent'],
};

const components = bodyPortalComponents();

describe('body-portaled board overlays clear the board', () => {
  it('finds the overlays to check, so the guard cannot pass by matching nothing', () => {
    expect(components.length).toBeGreaterThanOrEqual(8);
    expect(components).toContain('TriggerReminder.tsx');
    expect(components).toContain('HoldBanner.tsx');
    expect(components).toContain('TakebackConsentPrompt.tsx');
  });

  it.each(components)('%s is painted above the board', (component) => {
    const coLocated = component.replace(/\.tsx$/, '.css');
    const wanted = PAGE_LEVEL_CLASSES[component];
    const sources = [
      ...readdirSync(componentsDir)
        .filter((f) => f === coLocated)
        .map((f) => readFileSync(join(componentsDir, f), 'utf8')),
      ...(wanted ? [readFileSync(join(stylesDir, 'playtest.css'), 'utf8')] : []),
    ];

    const offenders: string[] = [];
    for (const css of sources) {
      for (const [selector, z] of fixedRuleZIndexes(css)) {
        if (wanted && !wanted.some((c) => selector.startsWith(c))) continue;
        // A fixed rule with no z-index of its own takes its stacking from
        // context; only an explicit sub-1100 value is the bug this catches.
        if (z && /var\(--z-table-|^\d+$/.test(z) && !CLEARS_THE_BOARD.test(z)) {
          offenders.push(`${selector} -> ${z}`);
        }
      }
    }
    expect(offenders, `${component} portals to <body>; these sit under the board`).toEqual([]);
  });
});
