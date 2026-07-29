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
  // must grow inside a (pointer: coarse) block.
  const CONTROLS: Array<[string, string]> = [
    ['styles/modals-dialogs.css', '.modal-close'],
    ['styles/deck-builder-card-list.css', '.deck-row-menu-trigger'],
    ['styles/auth.css', '.auth-reveal'],
    ['styles/tooltip-legend.css', '.banner-dismiss'],
  ];

  for (const [file, selector] of CONTROLS) {
    it(`${selector} reaches 44px on touch`, () => {
      const found = blocks(read(file), selector);
      expect(found, `no rule for ${selector} in ${file}`).not.toEqual([]);
      expect(
        found.some((b) => /(?:min-)?(?:width|height):\s*44px/.test(b)),
        `${selector} (${file}) stays below the 44px coarse-pointer floor — ` +
          `add a @media (pointer: coarse) block sizing it to 44px`
      ).toBe(true);
    });
  }
});
