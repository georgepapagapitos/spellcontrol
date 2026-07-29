// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
