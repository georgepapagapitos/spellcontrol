/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The Add cards sheet is a `.modal`, which has a max-height and no height. On
// the Products tab its list outgrew that, and flexbox shrank every child to
// fit: the tab strip is a scroll container (min-height 0), so it gave up half
// its height and its labels were clipped mid-word (T153, from a screenshot).
// The header and the strip are chrome and must never shrink.
//
// On phones the four tabs share the width, icon over label. The strip used to
// scroll, which left Scan cut off at 390px with nothing to say there was more.
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'binder-card-management.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBody(selector: string, source = css): string {
  const at = source.indexOf(`${selector} {`);
  expect(at, `${selector} rule is missing`).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf('}', at));
}

describe('Add cards sheet chrome', () => {
  it('never shrinks its header or its tab strip', () => {
    expect(ruleBody('.add-cards-modal-header')).toMatch(/flex-shrink:\s*0/);
    expect(ruleBody('.add-cards-tabs')).toMatch(/flex-shrink:\s*0/);
  });

  it('shares the width between the tabs on a phone instead of scrolling them', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 599px)'));
    const tab = ruleBody('.add-cards-tabs.sc-tabs--underline .sc-tab', phone);
    expect(tab).toMatch(/flex:\s*1 1 0/);
    expect(tab).toMatch(/min-width:\s*0/);
  });

  it('carries no rules for the old hand-rolled tab buttons, which nothing renders', () => {
    expect(css).not.toMatch(/\.add-cards-tab(?![s\w-])/);
    expect(css).not.toMatch(/\.add-cards-tab-icon/);
  });
});

// T153 phase 4: the sheet moved onto <Modal>, which needs `add-cards-backdrop`
// as its `backdropClassName` and the dialog widened for the desktop two-pane
// workbench (STYLE_GUIDE § Overlays width table). Both are load-bearing CSS
// this test pins so a future edit can't silently narrow the dialog back down
// or shrink the sheet breakpoint back to the shared 600px default.
describe('Add cards desktop workbench + sheet breakpoint', () => {
  it('widens the dialog past the shell default for the two-pane workbench', () => {
    const rule = ruleBody('.add-cards-modal');
    const maxWidth = Number(/max-width:\s*(\d+)px/.exec(rule)?.[1] ?? 0);
    expect(maxWidth).toBeGreaterThanOrEqual(1024);
  });

  it('is a bottom sheet up to the tablet/desktop boundary, not just the shared 600px default', () => {
    expect(css).toMatch(/@media \(max-width: 1023px\) \{\s*\.modal-backdrop\.add-cards-backdrop/);
  });

  // It opened at half height and grew as results arrived, jumping under the
  // thumb on every keystroke. The sheet has a fixed height, not a content one.
  it('opens the phone sheet at a fixed height, never sized to its content', () => {
    const selector = ".modal-backdrop.add-cards-backdrop > [role='dialog'] {";
    const phone = css.slice(css.indexOf('@media (max-width: 1023px)'));
    const start = phone.indexOf(selector);
    expect(start).toBeGreaterThan(-1);
    const dialog = phone.slice(start, phone.indexOf('}', start));
    expect(dialog).toMatch(/(^|\s)height:\s*calc\(var\(--vh-safe\)/);
  });

  it('declares the desktop workbench grid, in the min-width block AFTER its base padding rule', () => {
    const baseAt = css.indexOf(
      '.add-cards-panel-search,\n.add-cards-panel-upload,\n.add-cards-panel-product'
    );
    // The file has other, unrelated `@media (min-width: 1024px)` blocks —
    // search from the base rule onward for the one that overrides it.
    const mqAt = css.indexOf('@media (min-width: 1024px)', baseAt);
    expect(baseAt).toBeGreaterThan(-1);
    expect(mqAt).toBeGreaterThan(baseAt);

    const desktop = css.slice(
      mqAt,
      css.indexOf('}\n\n.add-cards-panel-search .add-card-sheet-body')
    );
    expect(desktop).toMatch(/\.add-cards-search-workbench\s*\{[^}]*display:\s*grid/);
    expect(desktop).toMatch(/grid-template-columns:\s*26rem minmax\(0,\s*1fr\)/);
  });
});
