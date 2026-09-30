// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAGOVER_SILENCE_MS, hasLinkPayload, readLinkPayload, useLinkDrop } from './use-link-drop';

const PAGE = 'https://scryfall.com/card/cmm/396/sol-ring';

/** A drag event carrying a fake DataTransfer (happy-dom's DragEvent can't be
 *  given one), dispatched on `target`. Returns the event for inspection. */
function drag(
  type: string,
  data: Record<string, string> | null,
  target: EventTarget = window,
  extra: Record<string, unknown> = {}
): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const dataTransfer = data && {
    types: Object.keys(data),
    getData: (t: string) => data[t] ?? '',
    dropEffect: 'none',
  };
  Object.defineProperty(e, 'dataTransfer', { value: dataTransfer });
  for (const [k, v] of Object.entries(extra)) Object.defineProperty(e, k, { value: v });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

const LINK = { 'text/uri-list': PAGE, 'text/html': `<a href="${PAGE}">Sol Ring</a>` };

describe('hasLinkPayload / readLinkPayload', () => {
  it('counts uri-list or html as a link, and a bare file as not one', () => {
    expect(hasLinkPayload(['text/uri-list'])).toBe(true);
    expect(hasLinkPayload(['text/html', 'text/plain'])).toBe(true);
    expect(hasLinkPayload(['text/uri-list', 'text/html', 'Files'])).toBe(true);
    expect(hasLinkPayload(['Files'])).toBe(false);
    expect(hasLinkPayload(['text/plain'])).toBe(false);
    expect(hasLinkPayload([])).toBe(false);
  });

  it('joins every text flavour that is present', () => {
    const data = { 'text/uri-list': 'a', 'text/plain': 'c' } as Record<string, string>;
    const dt = { getData: (t: string) => data[t] ?? '' } as unknown as DataTransfer;
    expect(readLinkPayload(dt)).toBe('a\nc');
  });
});

describe('useLinkDrop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows on an external link drag, survives crossing children, and hides on leaving', () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useLinkDrop(onDrop));
    expect(result.current).toBe(false);

    const enter = drag('dragenter', LINK, document.body);
    expect(enter.defaultPrevented).toBe(true);
    expect(result.current).toBe(true);

    // Moving onto a child: enter on the child fires before leave on the parent.
    drag('dragenter', LINK, document.body);
    drag('dragleave', LINK, document.body);
    expect(result.current).toBe(true);

    drag('dragleave', LINK, document.body);
    expect(result.current).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('accepts the drop, hands over the text, and clears', () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useLinkDrop(onDrop));
    drag('dragenter', LINK);
    const over = drag('dragover', LINK);
    expect(over.defaultPrevented).toBe(true);
    const drop = drag('drop', LINK);
    expect(drop.defaultPrevented).toBe(true);
    expect(result.current).toBe(false);
    expect(onDrop).toHaveBeenCalledWith(`${PAGE}\n<a href="${PAGE}">Sol Ring</a>`);
  });

  it('always calls the latest callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useLinkDrop(cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });
    drag('dragenter', LINK);
    drag('drop', LINK);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('ignores a desktop file drag and leaves its drop alone', () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useLinkDrop(onDrop));
    const enter = drag('dragenter', { Files: '' });
    expect(enter.defaultPrevented).toBe(false);
    expect(result.current).toBe(false);
    const drop = drag('drop', { Files: '' });
    expect(drop.defaultPrevented).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('ignores a drag that started inside the page until it ends', () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useLinkDrop(onDrop));
    drag('dragstart', LINK, document.body);
    const enter = drag('dragenter', LINK);
    expect(enter.defaultPrevented).toBe(false);
    expect(result.current).toBe(false);
    drag('drop', LINK);
    expect(onDrop).not.toHaveBeenCalled();

    drag('dragend', LINK, document.body);
    drag('dragenter', LINK);
    expect(result.current).toBe(true);
  });

  it('leaves a drop another target already handled', () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useLinkDrop(onDrop));
    const stop = (e: Event) => e.preventDefault();
    document.body.addEventListener('drop', stop);
    drag('dragenter', LINK);
    drag('drop', LINK, document.body);
    document.body.removeEventListener('drop', stop);
    expect(result.current).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('clears on dragend, Escape, a buttonless pointer move and dragover silence', () => {
    const { result } = renderHook(() => useLinkDrop(vi.fn()));

    drag('dragenter', LINK);
    drag('dragend', null);
    expect(result.current).toBe(false);

    drag('dragenter', LINK);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current).toBe(false);

    drag('dragenter', LINK);
    drag('pointermove', null, window, { buttons: 1 });
    expect(result.current).toBe(true);
    drag('pointermove', null, window, { buttons: 0 });
    expect(result.current).toBe(false);

    // A still pointer still gets dragover on the spec's slowest beat (550ms).
    drag('dragenter', LINK);
    drag('dragover', LINK);
    act(() => {
      vi.advanceTimersByTime(550);
    });
    expect(result.current).toBe(true);
    drag('dragover', LINK);
    act(() => {
      vi.advanceTimersByTime(DRAGOVER_SILENCE_MS - 1);
    });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(result.current).toBe(false);
  });

  it('comes back on dragover when the enter was missed or the watchdog fired mid-drag', () => {
    const { result } = renderHook(() => useLinkDrop(vi.fn()));

    // No dragenter at all (a real browser run showed a drag after a cancelled
    // one arriving without one): the first dragover shows it.
    drag('dragover', LINK);
    expect(result.current).toBe(true);

    // The drag paused past the watchdog, then moved again.
    act(() => {
      vi.advanceTimersByTime(DRAGOVER_SILENCE_MS + 1);
    });
    expect(result.current).toBe(false);
    drag('dragover', LINK);
    expect(result.current).toBe(true);

    // And one leave still clears it, since the restored depth is one.
    drag('dragleave', LINK);
    expect(result.current).toBe(false);
  });

  it('does nothing while disabled, and drops a stale drag when it turns off', () => {
    const onDrop = vi.fn();
    const { result, rerender } = renderHook(({ disabled }) => useLinkDrop(onDrop, { disabled }), {
      initialProps: { disabled: false },
    });
    drag('dragenter', LINK);
    expect(result.current).toBe(true);
    rerender({ disabled: true });
    expect(result.current).toBe(false);
    const enter = drag('dragenter', LINK);
    expect(enter.defaultPrevented).toBe(false);
    drag('drop', LINK);
    expect(onDrop).not.toHaveBeenCalled();
    rerender({ disabled: false });
    expect(result.current).toBe(false);
  });

  it('removes its listeners on unmount', () => {
    const onDrop = vi.fn();
    const { unmount } = renderHook(() => useLinkDrop(onDrop));
    unmount();
    const enter = drag('dragenter', LINK);
    expect(enter.defaultPrevented).toBe(false);
    drag('drop', LINK);
    expect(onDrop).not.toHaveBeenCalled();
  });
});
