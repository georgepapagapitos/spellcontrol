// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusInto, getFocusable, trapTab, useOverlayLayer } from './overlay-layer';

function panelWith(html: string): HTMLElement {
  const el = document.createElement('div');
  el.tabIndex = -1;
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

function tab(shift = false): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, cancelable: true });
}

describe('getFocusable', () => {
  it('skips disabled controls and anything inside [hidden]', () => {
    const panel = panelWith(`
      <button id="a">a</button>
      <button id="b" disabled>b</button>
      <div hidden><button id="c">c</button></div>
      <input id="d" />
      <input id="e" type="hidden" />
    `);
    expect(getFocusable(panel).map((el) => el.id)).toEqual(['a', 'd']);
  });
});

describe('getFocusable: rendered controls only', () => {
  // A short seat's drawer hides its header ✕ with a container query. As the
  // "first focusable" it took the initial focus (refused: display:none) and
  // the Tab wrap, so focus never entered the aria-modal dialog.
  it('skips a control under display:none or visibility:hidden, itself or an ancestor', () => {
    const panel = panelWith(`
      <button id="a" style="display: none">a</button>
      <div style="display: none"><button id="b">b</button></div>
      <button id="c" style="visibility: hidden">c</button>
      <button id="d">d</button>
    `);
    expect(getFocusable(panel).map((el) => el.id)).toEqual(['d']);
  });

  it('focusInto and the Tab wrap land on the first RENDERED control', () => {
    const panel = panelWith(`
      <button id="close" style="display: none">x</button>
      <button id="first">first</button>
      <button id="last">last</button>
    `);
    focusInto(panel);
    expect(document.activeElement?.id).toBe('first');
    panel.querySelector<HTMLElement>('#last')!.focus();
    trapTab(panel, tab());
    expect(document.activeElement?.id).toBe('first');
  });

  it('falls back to client rects where checkVisibility is missing (Safari < 17.4)', () => {
    const panel = panelWith('<button id="a">a</button><button id="b">b</button>');
    const [a, b] = Array.from(panel.querySelectorAll('button'));
    for (const el of [a, b]) Object.defineProperty(el, 'checkVisibility', { value: undefined });
    Object.defineProperty(a, 'getClientRects', { value: () => [] });
    expect(getFocusable(panel).map((el) => el.id)).toEqual(['b']);
  });
});

describe('focusInto', () => {
  it('focuses the first focusable child', () => {
    const panel = panelWith('<button id="a">a</button><button id="b">b</button>');
    focusInto(panel);
    expect(document.activeElement?.id).toBe('a');
  });

  it('leaves focus alone when it is already inside — an autoFocus child wins', () => {
    const panel = panelWith('<button id="a">a</button><button id="b">b</button>');
    panel.querySelector<HTMLElement>('#b')!.focus();
    focusInto(panel);
    expect(document.activeElement?.id).toBe('b');
  });

  it('falls back to the panel when nothing inside is focusable', () => {
    const panel = panelWith('<p>nothing tabbable</p>');
    focusInto(panel);
    expect(document.activeElement).toBe(panel);
  });
});

describe('trapTab', () => {
  it('wraps forward off the last element back to the first', () => {
    const panel = panelWith('<button id="a">a</button><button id="b">b</button>');
    panel.querySelector<HTMLElement>('#b')!.focus();
    const e = tab();
    expect(trapTab(panel, e)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('a');
  });

  it('wraps backward off the first element to the last', () => {
    const panel = panelWith('<button id="a">a</button><button id="b">b</button>');
    panel.querySelector<HTMLElement>('#a')!.focus();
    const e = tab(true);
    expect(trapTab(panel, e)).toBe(true);
    expect(document.activeElement?.id).toBe('b');
  });

  it('pulls focus back in when it has escaped the panel entirely', () => {
    const panel = panelWith('<button id="a">a</button><button id="b">b</button>');
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    trapTab(panel, tab());
    expect(document.activeElement?.id).toBe('a');
  });

  it('ignores non-Tab keys', () => {
    const panel = panelWith('<button id="a">a</button>');
    expect(trapTab(panel, new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(false);
  });
});

describe('useOverlayLayer', () => {
  // Modal dialogs and useSheetExit sheets share ONE stack: a confirm dialog
  // opened on top of a sheet must be the only layer answering Escape and the
  // Android back button. With separate stacks both would answer one press.
  it('makes only the most recently mounted layer topmost', () => {
    const first = renderHook(() => useOverlayLayer());
    expect(first.result.current.isTopmost()).toBe(true);

    const second = renderHook(() => useOverlayLayer());
    expect(second.result.current.isTopmost()).toBe(true);
    expect(first.result.current.isTopmost()).toBe(false);

    second.unmount();
    expect(first.result.current.isTopmost()).toBe(true);

    first.unmount();
  });

  it('keeps a stable isTopmost identity across renders', () => {
    // Consumers list it in effect deps; a fresh function each render would
    // re-run the focus effect continuously and keep stealing focus back.
    const { result, rerender } = renderHook(() => useOverlayLayer());
    const before = result.current.isTopmost;
    rerender();
    expect(result.current.isTopmost).toBe(before);
  });

  it('removes the right layer when an inner one unmounts out of order', () => {
    const a = renderHook(() => useOverlayLayer());
    const b = renderHook(() => useOverlayLayer());
    const c = renderHook(() => useOverlayLayer());

    b.unmount();
    expect(c.result.current.isTopmost()).toBe(true);
    expect(a.result.current.isTopmost()).toBe(false);

    c.unmount();
    expect(a.result.current.isTopmost()).toBe(true);
    a.unmount();
  });
});

// E481/T157: "Back closes the topmost overlay first" — the shared history
// integration a `dismiss` callback opts a layer into. The mechanics
// themselves (mark/reuse/skip, the lazy-consumption fix for the
// close-then-navigate race) are unit tested in isolation in
// overlay-history.test.ts against fake hooks; these exercise the REAL wiring
// through `useOverlayLayer` and `window.history`.
describe('useOverlayLayer: Back-button integration (E481)', () => {
  afterEach(() => {
    // `history.length` only ever grows (see overlay-history.test.ts) — just
    // park the current entry on a clean, unflagged URL between tests.
    window.history.replaceState(null, '', '/clean');
  });

  it('a plain useOverlayLayer() (no dismiss) never touches window.history', () => {
    const lengthBefore = window.history.length;
    const hook = renderHook(() => useOverlayLayer());
    expect(window.history.length).toBe(lengthBefore);
    hook.unmount();
    expect(window.history.length).toBe(lengthBefore);
  });

  it('opting in pushes one entry; Back calls dismiss and leaves the route unchanged, without costing an extra press to leave', () => {
    const lengthBefore = window.history.length;
    const hrefBefore = window.location.href;
    const dismiss = vi.fn(() => true);
    const hook = renderHook(() => useOverlayLayer(true, dismiss));
    expect(window.history.length).toBe(lengthBefore + 1);

    window.history.back();

    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe(hrefBefore);
    hook.unmount();

    // The sole overlay accepted the close, so nothing was re-marked — a
    // SECOND Back (the app itself, or whatever the test harness sends next)
    // never re-intercepts here; dismiss stays called exactly once.
    window.history.back();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('Back resolves to the topmost PARTICIPATING layer, skipping one above it with no dismiss', () => {
    // A popover that never opted in (rare, but the stack allows it) sitting
    // on top of a sheet must not swallow the Back press meant for the sheet.
    const sheetDismiss = vi.fn(() => true);
    const sheet = renderHook(() => useOverlayLayer(true, sheetDismiss));
    const bystander = renderHook(() => useOverlayLayer()); // no dismiss
    expect(bystander.result.current.isTopmost()).toBe(true);

    window.history.back();

    expect(sheetDismiss).toHaveBeenCalledTimes(1);
    bystander.unmount();
    sheet.unmount();
  });

  it('nested: closing the inner layer re-arms Back for the outer one, synchronously — no microtask wait needed', () => {
    const outerDismiss = vi.fn(() => true);
    const outer = renderHook(() => useOverlayLayer(true, outerDismiss));
    const lengthAfterOuter = window.history.length;
    const innerDismiss = vi.fn(() => {
      inner.unmount();
      return true;
    });
    const inner = renderHook(() => useOverlayLayer(true, innerDismiss));
    // Nested open reuses the already-marked entry.
    expect(window.history.length).toBe(lengthAfterOuter);

    window.history.back();
    expect(innerDismiss).toHaveBeenCalledTimes(1);
    expect(outerDismiss).not.toHaveBeenCalled();

    // Second Back closes the outer one immediately — the re-mark happens
    // inside the SAME popstate handler that processed the first press,
    // before it even calls dismiss (see overlay-history.ts), not after the
    // inner unregisters.
    window.history.back();
    expect(outerDismiss).toHaveBeenCalledTimes(1);
    outer.unmount();
  });

  it('survives a StrictMode double-invoke without leaving an extra history entry or a spurious dismiss', () => {
    const lengthBefore = window.history.length;
    const dismiss = vi.fn(() => true);
    const hook = renderHook(() => useOverlayLayer(true, dismiss), { wrapper: StrictMode });
    // Exactly one entry, not two, despite the dev double mount/cleanup/mount.
    expect(window.history.length).toBe(lengthBefore + 1);
    expect(dismiss).not.toHaveBeenCalled();

    hook.unmount();
  });

  it('a topmost participant that refuses to close (e.g. Modal dismissable=false) keeps Back intercepted on the next press too', () => {
    // Mirrors Modal's `dismissableRef` guard — dismiss is called but refuses
    // (returns false), so nothing actually closes.
    const guardedDismiss = vi.fn(() => false);
    const hrefBefore = window.location.href;
    const hook = renderHook(() => useOverlayLayer(true, guardedDismiss));

    window.history.back();
    expect(guardedDismiss).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe(hrefBefore); // still open, still here

    // Still refusing — a second Back must not fall through to real page
    // navigation while the overlay sits there unclosed.
    window.history.back();
    expect(guardedDismiss).toHaveBeenCalledTimes(2);
    expect(window.location.href).toBe(hrefBefore);

    hook.unmount();
  });
});
