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
    const phone = css.slice(css.indexOf('@media (max-width: 600px)'));
    const tab = ruleBody('.add-cards-tabs.sc-tabs--underline .sc-tab', phone);
    expect(tab).toMatch(/flex:\s*1 1 0/);
    expect(tab).toMatch(/min-width:\s*0/);
  });

  it('carries no rules for the old hand-rolled tab buttons, which nothing renders', () => {
    expect(css).not.toMatch(/\.add-cards-tab(?![s\w-])/);
    expect(css).not.toMatch(/\.add-cards-tab-icon/);
  });
});
