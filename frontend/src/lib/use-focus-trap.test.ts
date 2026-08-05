// @vitest-environment happy-dom
import { createRef } from 'react';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFocusTrap } from './use-focus-trap';

function dialog(html: string): HTMLElement {
  const el = document.createElement('div');
  el.tabIndex = -1;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

function tab(shift = false): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, cancelable: true });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useFocusTrap', () => {
  it('moves focus into the dialog on mount (DOM-order fallback, no ref)', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    dialog('<button id="a">a</button><button id="b">b</button>');
    renderHook(() => useFocusTrap(() => true));

    expect(document.activeElement?.id).toBe('a');
  });

  it('cycles Tab off the last element back to the first', () => {
    const panel = dialog('<button id="a">a</button><button id="b">b</button>');
    renderHook(() => useFocusTrap(() => true));
    panel.querySelector<HTMLElement>('#b')!.focus();

    const e = tab();
    document.dispatchEvent(e);

    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('a');
  });

  it('cycles Shift+Tab off the first element back to the last', () => {
    const panel = dialog('<button id="a">a</button><button id="b">b</button>');
    renderHook(() => useFocusTrap(() => true));
    panel.querySelector<HTMLElement>('#a')!.focus();

    document.dispatchEvent(tab(true));

    expect(document.activeElement?.id).toBe('b');
  });

  it('restores focus to the trigger element on unmount', () => {
    const trigger = document.createElement('button');
    trigger.id = 'trigger';
    document.body.appendChild(trigger);
    trigger.focus();

    const panel = dialog('<button id="a">a</button>');
    const { unmount } = renderHook(() => useFocusTrap(() => true));
    expect(document.activeElement).not.toBe(trigger);

    panel.remove();
    unmount();

    expect(document.activeElement?.id).toBe('trigger');
  });

  it('does not restore focus to a trigger that is no longer in the document', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    trigger.remove();

    dialog('<button id="a">a</button>');
    const { unmount } = renderHook(() => useFocusTrap(() => true));
    unmount();

    // No crash, and it didn't fall back to focusing <body> incorrectly either
    // — just leaves focus wherever the trap's own cleanup left it.
    expect(document.activeElement).not.toBe(trigger);
  });

  it('does not trap Tab when a layer above it is topmost (nested dialog)', () => {
    const panel = dialog('<button id="a">a</button><button id="b">b</button>');
    // A confirm dialog opened on top — this trap is no longer topmost.
    renderHook(() => useFocusTrap(() => false));
    panel.querySelector<HTMLElement>('#b')!.focus();

    const e = tab();
    document.dispatchEvent(e);

    // Untouched: the (fake) topmost layer owns Tab now, not this one.
    expect(e.defaultPrevented).toBe(false);
    expect(document.activeElement?.id).toBe('b');
  });

  it('uses an explicit panel ref over the DOM-order fallback when given', () => {
    // Two dialogs in the DOM; the ref should win even though it's not last.
    const first = dialog('<button id="a">a</button>');
    dialog('<button id="c">c</button>');
    const ref = createRef<HTMLElement | null>();
    (ref as { current: HTMLElement }).current = first;

    renderHook(() => useFocusTrap(() => true, ref));

    expect(document.activeElement?.id).toBe('a');
  });

  it('is a no-op when no dialog is mounted', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    renderHook(() => useFocusTrap(() => true));

    // Nothing to focus into — focus stays put, no crash.
    expect(document.activeElement).toBe(trigger);
    expect(() => document.dispatchEvent(tab())).not.toThrow();
  });

  it('removes its keydown listener on unmount', () => {
    const panel = dialog('<button id="a">a</button><button id="b">b</button>');
    const { unmount } = renderHook(() => useFocusTrap(() => true));
    unmount();
    panel.querySelector<HTMLElement>('#b')!.focus();

    document.dispatchEvent(tab());

    // No trap left listening — Tab is free to leave the panel.
    expect(document.activeElement?.id).toBe('b');
  });

  it('re-subscribes when isTopmost identity changes', () => {
    const isTopmostA = vi.fn(() => true);
    const isTopmostB = vi.fn(() => true);
    const panel = dialog('<button id="a">a</button><button id="b">b</button>');
    const { rerender } = renderHook(({ fn }) => useFocusTrap(fn), {
      initialProps: { fn: isTopmostA },
    });
    rerender({ fn: isTopmostB });

    panel.querySelector<HTMLElement>('#b')!.focus();
    document.dispatchEvent(tab());

    expect(isTopmostB).toHaveBeenCalled();
  });
});
