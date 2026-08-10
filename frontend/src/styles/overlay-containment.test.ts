/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Guards the overlay-containment / dialog-spacing / touch-target sweep. Every
// rule below is a silent-failure class: nothing throws, nothing warns, the UI
// just misbehaves on a device.
//
//  1. Scroll chaining — `body` is permanently `overflow: hidden`
//     (base-layout.css) and `.app-main` is the app's only real scroll region,
//     so `useLockBodyScroll` never had anything to lock. What actually leaks is
//     an overlay's inner scroller handing its leftover delta up the ancestor
//     chain: scroll a sheet's list to the bottom, keep swiping, and the page
//     behind the sheet moves. `.app-main`'s own `overscroll-behavior: contain`
//     only stops chaining OUT of it, not delta arriving from a descendant.
//  2. `.choice-dialog-actions` is the one row class every confirm dialog uses;
//     with no `gap` its buttons touch, and with no `flex-wrap` a 3-button row
//     overflows a ~240px dialog at the 320px floor (`.btn` is nowrap).
//  3. `.collection-hub-tabs` sets `overflow-x`; with the other axis unstated it
//     computes to `auto` too, making the sticky tab strip an unintended 2-axis
//     scroller with a 1px block-axis range under the active tab's -1px margin.
//  4. Coarse-pointer 44px floor (STYLE_GUIDE § Responsive) on the dismiss /
//     reveal / row-menu controls that shipped at 18-32px.
//  5. `.app-main` must never form a stacking context. It is the scroll region
//     every page renders into, so any of these properties on it traps EVERY
//     `position: fixed` overlay in the app — sheets, modals, scrims — inside
//     it, and the mobile tab bar (a later sibling) paints straight over them
//     no matter how high their z-index is. `view-transition-name: app-main`
//     did exactly this: it forms a stacking context permanently, not only
//     while a transition runs. The route transition now names the chrome
//     instead (see base-layout.css § Route view transitions).
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(srcRoot, rel), 'utf8');

/** Declaration bodies of every rule whose selector is exactly `selector`. */
function blocks(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) out.push(m[1]);
  return out;
}

describe('overlay scroll containment', () => {
  // [file, selector] — every scroller that sits inside an overlay and can
  // therefore chain into the page behind it.
  const SCROLLERS: Array<[string, string]> = [
    ['styles/modals-dialogs.css', '.modal-body'],
    ['styles/binder-card-management.css', '.card-picker-list'],
    ['styles/binder-card-management.css', '.add-card-sheet-body'],
    ['styles/play-layout-editor.css', '.cle'],
    ['components/AvatarPickerSheet.css', '.avatar-picker-body'],
    // The trade composer's per-printing chooser — capped and scrolled because a
    // real collection holds 59 printings of Mountain.
    ['components/trade/TradeComposer.css', '.trade-copy-list'],
  ];

  for (const [file, selector] of SCROLLERS) {
    it(`${selector} contains its overscroll`, () => {
      const found = blocks(read(file), selector);
      expect(found, `no rule for ${selector} in ${file}`).not.toEqual([]);
      expect(
        found.some((b) => /overscroll-behavior:\s*contain/.test(b)),
        `${selector} (${file}) scrolls inside an overlay but lets its leftover ` +
          `scroll delta chain into .app-main behind it — add overscroll-behavior: contain`
      ).toBe(true);
    });
  }
});

describe('.app-main never forms a stacking context', () => {
  // Every property that makes an element a stacking context AND a containing
  // block for its fixed descendants. `contain`/`container-type` are listed
  // with the values that imply layout containment.
  const TRAPS = [
    /view-transition-name:\s*(?!none)/,
    /(?<!-)transform:\s*(?!none)/,
    /\bfilter:\s*(?!none)/,
    /backdrop-filter:\s*(?!none)/,
    /perspective:\s*(?!none)/,
    /contain:\s*[^;]*\b(layout|paint|strict|content)\b/,
    /container-type:\s*(?!normal)/,
    /will-change:\s*[^;]*\b(transform|filter|perspective|opacity|view-transition-name)\b/,
    /isolation:\s*isolate/,
  ];

  const css = read('styles/base-layout.css');

  it('finds the .app-main rules it is asserting against', () => {
    // Without this the loop below passes vacuously if the selector is ever
    // renamed or the rules move to another file.
    expect(blocks(css, '.app-main').length).toBeGreaterThan(0);
  });

  for (const trap of TRAPS) {
    it(`declares no ${String(trap)}`, () => {
      const offenders = blocks(css, '.app-main').filter((b) => trap.test(b));
      expect(
        offenders,
        `.app-main declares a stacking-context-forming property. It is the scroll ` +
          `region every page renders into, so this traps every position:fixed overlay ` +
          `inside it and the mobile tab bar paints over sheets/modals regardless of ` +
          `z-index. Put the property on a wrapper that hosts no overlays instead.`
      ).toEqual([]);
    });
  }

  it('runs the route transition off the chrome, not the content', () => {
    // If the chrome loses its names the root snapshot swallows header + tab
    // bar and they cross-fade with the content — the regression that made
    // someone move the name onto .app-main in the first place.
    for (const sel of ['.site-header', '.mobile-tab-bar', '.scan-fab-root']) {
      expect(
        blocks(css, sel).some((b) => /view-transition-name:\s*sc-chrome-/.test(b)),
        `${sel} must carry its own view-transition-name so it is pulled out of the ` +
          `root snapshot and holds still during a route change`
      ).toBe(true);
    }
  });
});

describe('shared confirm-dialog action row', () => {
  const actions = blocks(read('styles/modals-dialogs.css'), '.choice-dialog-actions')[0] ?? '';

  it('separates its buttons', () => {
    expect(
      actions,
      '.choice-dialog-actions has no gap — every confirm dialog’s buttons touch'
    ).toMatch(/gap:\s*\S/);
  });

  it('wraps instead of overflowing a narrow dialog', () => {
    expect(
      actions,
      '.choice-dialog-actions must wrap — 3-button confirm rows overflow a ~240px dialog at 320px'
    ).toMatch(/flex-wrap:\s*wrap/);
  });
});

describe('sticky hub tab strip', () => {
  it('scrolls on one axis only', () => {
    const strip = blocks(read('styles/responsive-nav.css'), '.collection-hub-tabs')[0] ?? '';
    expect(strip, 'no .collection-hub-tabs rule found').toMatch(/overflow-x:\s*auto/);
    expect(
      strip,
      '.collection-hub-tabs sets overflow-x but not overflow-y, so the block axis ' +
        'computes to auto and the strip becomes an unintended 2-axis scroller'
    ).toMatch(/overflow-y:\s*(hidden|clip)/);
  });
});

describe('coarse-pointer touch floor', () => {
  // [file, selector] — controls whose base size is below 44px, each of which
  // must grow inside a (pointer: coarse) block. A control sitting in a dense
  // list row grows its *ghost* (`::after`) instead of its own box — see
  // STYLE_GUIDE "44px touch targets"; growing the box itself inflates every
  // row (the deck row hit ~50px for one line of text). Point the guard at the
  // ghost in that case so the floor is still enforced.
  const CONTROLS: Array<[string, string]> = [
    ['styles/modals-dialogs.css', '.modal-close'],
    ['styles/deck-builder-card-list.css', '.deck-row-menu-trigger::after'],
    ['styles/auth.css', '.auth-reveal'],
    ['styles/tooltip-legend.css', '.banner-dismiss'],
    ['components/trade/TradeComposer.css', '.trade-stepper-btn::after'],
    ['components/trade/TradeComposer.css', '.trade-picked-remove::after'],
    // The "which of my copies is leaving" disclosure — ghosted like its row
    // siblings, since the row's padding means a real 44px box would inflate it.
    ['components/trade/TradeComposer.css', '.trade-picked-choose::after'],
    // An expanded copy is its OWN row, so it takes the floor on its real box.
    ['components/trade/TradeComposer.css', '.trade-copy-row'],
    // The accept-side picker — the mirror of the composer's, ghosted for the
    // same reason (28px controls inside a padded printing row).
    ['components/trade/TradeAcceptDialog.css', '.trade-accept-stepper-btn::after'],
    // Its confirm/cancel pair settles a collection, so they take the floor on
    // their real boxes rather than a ghost — `.btn` is 32-36px by default.
    ['components/trade/TradeAcceptDialog.css', '.trade-accept-actions .btn'],
    // Card header, not a dense row — it grows its own box rather than a ghost
    // (a ghost here would only overlap the non-interactive sides grid below).
    ['components/trade/TradeOfferList.css', '.trade-offer-who'],
    // The /friends page doors (Trades, Pods). `.site-nav-link` is 32.8px
    // app-wide; these two are lifted in-place, scoped to that row.
    ['components/FriendsManagement.css', '.friends-page-links .site-nav-link'],
    // /trades' empty-state CTA — an <a>, so it also needs a non-inline
    // display or the floor below is silently ignored (measured 29px).
    ['pages/TradesPage.css', '.trades-page .empty-state .btn'],
    // Home's Quick Actions, which now carry the phone's front door to the
    // social cluster (the Friends pill). The floor was already applied here
    // but nothing pinned it, so deleting the coarse block would have dropped
    // the door below 44px silently — this allowlist is opt-in, so a control
    // is unguarded until it is named. Measured 121.3×44 at 320-1440px.
    ['components/home/QuickActionsRow.css', '.home-quick-action'],
  ];

  for (const [file, selector] of CONTROLS) {
    it(`${selector} reaches 44px on touch`, () => {
      const found = blocks(read(file), selector);
      expect(found, `no rule for ${selector} in ${file}`).not.toEqual([]);
      expect(
        // 2.75rem is the same 44px at the default root size, and is the
        // better spelling (it scales with the user's font-size preference),
        // so the floor must be expressible either way — otherwise the guard
        // quietly pushes authors toward the px form to get a green tick.
        found.some((b) => /(?:min-)?(?:width|height):\s*(?:44px|2\.75rem)/.test(b)),
        `${selector} (${file}) stays below the 44px coarse-pointer floor — ` +
          `add a @media (pointer: coarse) block sizing it to 44px`
      ).toBe(true);
    });
  }
});
