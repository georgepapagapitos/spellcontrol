/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const layout = readFileSync(join(here, '..', 'components', 'Layout.tsx'), 'utf8');
const css = readFileSync(join(here, 'base-layout.css'), 'utf8');

/**
 * WCAG 2.4.1 Bypass Blocks (Level A). The shell shipped without a skip link
 * for its whole life: the header carries the brand, five nav links, card
 * search and the account menu, so a keyboard user crossed eight tab stops on
 * every route before reaching page content. Found by probing the rendered
 * shell during the page-by-page playtest sweep (batch 1) — `document
 * .querySelector('.skip-link')` came back null on every route and tier.
 *
 * Markup and styling are asserted together because either half alone is a
 * silent no-op: a link with no target scrolls nowhere, and a link styled with
 * `display: none` is removed from the tab order, which is the one thing it
 * must never be.
 */
describe('skip to content', () => {
  it('Layout renders a skip link pointing at the main landmark', () => {
    const href = layout.match(/className="skip-link"\s+href="#([\w-]+)"/);
    expect(href, 'Layout.tsx has no <a className="skip-link" href="#…">').toBeTruthy();
    const target = href![1];
    expect(
      new RegExp(`<main[^>]*id="${target}"`).test(layout),
      `the skip link points at #${target} but no <main id="${target}"> renders it`
    ).toBe(true);
  });

  it('the main landmark can receive focus, so the jump moves focus not just scroll', () => {
    expect(/<main[^>]*tabIndex=\{-1\}/.test(layout)).toBe(true);
  });

  it('the skip link is the first focusable thing in the shell', () => {
    const shell = layout.indexOf('className="app-shell"');
    const skip = layout.indexOf('className="skip-link"');
    const header = layout.indexOf('<Header');
    expect(shell).toBeGreaterThanOrEqual(0);
    expect(skip).toBeGreaterThan(shell);
    expect(
      skip < header,
      'the skip link must precede <Header /> in the DOM or it is not the first tab stop'
    ).toBe(true);
  });

  it('is hidden off-screen rather than removed from the tab order', () => {
    const rule = css.match(/\n\.skip-link\s*\{([^}]*)\}/);
    expect(rule, '.skip-link has no rule in base-layout.css').toBeTruthy();
    const body = rule![1];
    expect(
      /display:\s*none/.test(body) || /visibility:\s*hidden/.test(body),
      'display:none / visibility:hidden would drop the skip link out of the tab order'
    ).toBe(false);
    expect(/transform:\s*translate/.test(body), 'expected it parked off-screen').toBe(true);
    expect(/min-height:\s*44px/.test(body)).toBe(true);
  });

  it('becomes visible on keyboard focus', () => {
    const focus = css.match(/\.skip-link:focus-visible\s*\{([^}]*)\}/);
    expect(focus, '.skip-link:focus-visible is missing — the link would never appear').toBeTruthy();
    expect(focus![1]).toMatch(/transform:\s*none/);
  });
});
