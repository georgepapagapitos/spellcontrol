// Guard for the popup-placement class of bug. The Build health ⓘ on the deck
// stats card opened its tooltip at the far LEFT of the screen: InfoTip read only
// `placement.left` from computePopoverPlacement, which had flipped to `right`.
// No check measured a popup against its trigger, so it shipped. The nightly
// journey now opens every popup trigger on every route at phone and desktop
// and judges the panel against it. The scripts are read as text (importing the
// walk would pull in puppeteer-core, which the frontend install does not have);
// the pure rule is imported and tested directly.
// If a test here fails, restore the check: scripts/journey-popups.mjs (the
// walk), scripts/journey-popups-judge.mjs (the rule), the `--popups` branch in
// scripts/journey.mjs and the flag on the "Journey in Chrome" step in
// .github/workflows/nightly-journey.yml. Do not widen the tolerances to make a
// finding pass: fix the primitive that placed the panel.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: plain .mjs with no types, outside the frontend tree
import { judgePlacement, MAX_GAP, pickWindow } from '../../../scripts/journey-popups-judge.mjs';

const root = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');
const walk = read('scripts/journey-popups.mjs');
const journey = read('scripts/journey.mjs');
const overlays = read('scripts/journey-overlays.mjs');
const workflow = read('.github/workflows/nightly-journey.yml');

describe('popup placement nightly check', () => {
  it('finds every popup primitive by its trigger, and opens each the way a user does', () => {
    for (const sel of ['.info-tip-btn', '[aria-haspopup', '.legend-trigger'])
      expect(walk).toContain(sel);
    expect(walk).toContain('await handle.hover()'); // tooltips: mouse on desktop
    expect(walk).toContain('await handle.focus()'); // tooltips: focus on the phone
    expect(walk).toContain('await handle.click()'); // menus
    // A mouse rests on a menu's trigger before it clicks: the trigger is
    // measured after that hover (a pile opens under the pointer), not before.
    expect(walk.indexOf('await handle.hover();\n        await sleep(200);')).toBeGreaterThan(-1);
    expect(walk.indexOf('await sleep(200);')).toBeLessThan(walk.indexOf('const t0 ='));
    expect(walk).toContain("page.keyboard.press('Escape')"); // and closes each one
  });
  it('opens only what says it opens a popup, never a plain toolbar button', () => {
    // `.toolbar-pill` is also every plain toolbar button. The walk clicked
    // Select on /collection, left the grid in select mode, and every row menu
    // after it was unreachable (E1109). The pill popovers announce themselves.
    const trigger = walk.slice(walk.indexOf('const TRIGGER'), walk.indexOf('const PANEL'));
    expect(trigger).not.toContain('.toolbar-pill');
    expect(read('frontend/src/components/shared/ToolbarPopover.tsx')).toContain('aria-haspopup=');
    expect(read('frontend/src/components/shared/Legend.tsx')).toContain('aria-haspopup="dialog"');
  });
  it('exempts sheets and modals by their primitive, never by route', () => {
    expect(walk).toContain('aria-modal');
    expect(walk).not.toMatch(/route\s*(===|\.startsWith|\.includes)/);
  });
  it('bounds the cost and logs what it skipped', () => {
    expect(walk).toMatch(/export const CAP = \d+/);
    expect(journey).toContain('skipped past cap');
  });
  it('runs on the route walk at both tiers, and is a failure, not a note', () => {
    expect(journey).toContain("argv.includes('--popups')");
    expect(journey).toContain("from './journey-popups.mjs'");
    expect(journey).toContain('(popups?.findings.length ?? 0) > 0');
    // The tier loop is the same one the route walk runs on; a tier filter here
    // would turn the check off for one of them.
    expect(walk).toContain("tierName === 'phone'");
    expect(walk).not.toMatch(/tierName !== 'desktop'|tierName === 'desktop'\s*\)\s*return/);
    // An open overlay hides the page behind it: the overlay walk probes only
    // the steps that opt in, and the playtest table with cards on it is one.
    expect(overlays).toContain('popups: it.popups === true');
    const table = overlays.slice(overlays.indexOf("name: 'table after a draw and a play'"));
    expect(table.slice(0, table.indexOf('\n    },'))).toContain('popups: true');
  });
  it('probes the post-generation build report in place, without closing it', () => {
    // The sheet opens once, from router state, and holds the deck's ⓘ tips (the
    // "mana sources" tip among them). The route walk's reload or Escape would
    // close it for good, so it is probed scoped, with no reload, tips only.
    const sheet = journey.slice(journey.indexOf("'/decks/{deck} (generated, build report)'"));
    expect(sheet.slice(0, 200)).toContain(
      "popups: { within: '.build-report-sheet', reload: false, tooltipsOnly: true }"
    );
    expect(walk).toContain('if (reload && checked + exempt + unreachable.length > 0)');
    expect(walk).toContain("if (!within) await page.keyboard.press('Escape')");
  });
  it('rotates which triggers past the cap it opens, so none is skipped forever', () => {
    expect(walk).toContain('pickWindow(count, CAP, ROTATION)');
    expect(walk).toContain('Math.floor(Date.now() / 86_400_000)');
  });
  it('names route, tier, trigger and offsets in the failure line', () => {
    expect(walk).toContain('`${label} [${tierName}] ${t.kind} "${t.label}"');
  });
  it('is on the nightly Chrome step (phone + desktop)', () => {
    expect(workflow).toMatch(
      /- name: Journey in Chrome \(phone \+ desktop\)\n\s+run: [^\n]*--popups/
    );
  });
  it('is on the nightly Firefox step too: a placement can differ by engine', () => {
    expect(workflow).toMatch(
      /- name: Journey in Firefox[^\n]*\n(?:\s+if:[^\n]*\n)?\s+run: [^\n]*--popups/
    );
  });
});

describe('pickWindow', () => {
  it('opens every trigger when a kind is under the cap', () => {
    expect(pickWindow(5, 8, 123)).toEqual([0, 1, 2, 3, 4]);
  });
  it('opens a different window each night past the cap, and covers all of them', () => {
    const seen = new Set<number>();
    for (let night = 0; night < 3; night++) {
      const w = pickWindow(20, 8, night);
      expect(w.length).toBeLessThanOrEqual(8);
      for (const i of w) seen.add(i);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(pickWindow(20, 8, 0)).not.toEqual(pickWindow(20, 8, 1));
  });
});

// A 300x150 panel under a 16x16 trigger, on a 1440x900 desktop.
const vp = { width: 1440, height: 900 };
const box = (left: number, top: number, w: number, h: number) => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

describe('judgePlacement', () => {
  const trigger = box(1300, 300, 16, 16);

  it('accepts a panel just below, left-aligned to the trigger', () => {
    expect(judgePlacement(trigger, box(1300, 322, 300 - 160, 150), vp)).toBeNull();
  });
  it('accepts a panel just above (flipped), and right-aligned to the trigger', () => {
    expect(judgePlacement(trigger, box(1316 - 300, 300 - 6 - 150, 300, 150), vp)).toBeNull();
  });
  it('rejects the Build health bug: trigger at the right edge, panel at the far left', () => {
    const why = judgePlacement(trigger, box(8, 322, 300, 150), vp);
    expect(why).toContain('not beside its trigger horizontally');
    expect(why).toContain('x 8..308');
    expect(why).toContain('x 1300..1316');
  });
  it('accepts a panel clamped to the left edge when the trigger is near it', () => {
    expect(judgePlacement(box(20, 300, 16, 16), box(8, 322, 300, 150), vp)).toBeNull();
  });
  it('rejects a clamp against an edge the trigger is far from', () => {
    expect(judgePlacement(box(700, 300, 16, 16), box(8, 322, 300, 150), vp)).toContain(
      'not beside its trigger horizontally'
    );
  });
  it('rejects a panel off-screen and names the overflow', () => {
    expect(judgePlacement(box(1400, 300, 16, 16), box(1300, 322, 300, 150), vp)).toContain(
      'off-screen (right 160px)'
    );
    expect(judgePlacement(trigger, box(1300, 322, 300, 150), vp)).toContain('off-screen');
  });
  it('rejects a panel far below its trigger', () => {
    const why = judgePlacement(trigger, box(1300, 316 + MAX_GAP + 40, 100, 100), vp);
    expect(why).toContain('not adjacent vertically');
  });
  it('rejects a panel that covers its trigger when there is room elsewhere', () => {
    const why = judgePlacement(trigger, box(1290, 290, 100, 100), vp);
    expect(why).toContain('covers the trigger');
  });
  it('rejects covering the trigger even when neither side has room for the whole panel', () => {
    const tall = { width: 390, height: 300 };
    expect(judgePlacement(box(20, 140, 16, 16), box(8, 8, 200, 284), tall)).toContain(
      'covers the trigger'
    );
  });
  it('accepts a flyout beside its trigger on the same row', () => {
    expect(judgePlacement(box(100, 300, 200, 32), box(306, 296, 180, 200), vp)).toBeNull();
  });
  it('ignores the bottom edge of a panel taller than the viewport (it scrolls inside itself)', () => {
    expect(judgePlacement(box(100, 10, 40, 30), box(100, 46, 200, 1000), vp)).toBeNull();
  });
});
