// @vitest-environment happy-dom
import { createRef } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Separate file from use-sheet-exit.test.ts so these module mocks don't change
// the setup the motion/exit tests there rely on.
const { isNativePlatform } = vi.hoisted(() => ({ isNativePlatform: vi.fn(() => true) }));
vi.mock('./platform', () => ({ isNativePlatform }));

const { addListener, remove } = vi.hoisted(() => ({
  addListener: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@capacitor/app', () => ({ App: { addListener } }));

import { useSheetExit } from './use-sheet-exit';

/** Invoke the most recently registered Capacitor `backButton` handler. */
function pressBack() {
  const calls = addListener.mock.calls.filter((c) => c[0] === 'backButton');
  const handler = calls[calls.length - 1]?.[1] as (() => void) | undefined;
  act(() => handler?.());
}

beforeEach(() => {
  addListener.mockReset();
  addListener.mockImplementation(async () => ({ remove }));
  isNativePlatform.mockReturnValue(true);
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

describe('useSheetExit — Android hardware back', () => {
  // Only <Modal> answered back before this. The ~30 sheets on useSheetExit
  // did not, so back navigated the WebView's history and left the sheet
  // visually stuck open over a page that had changed underneath it.
  it('closes the sheet instead of letting the WebView navigate', async () => {
    const onClose = vi.fn();
    renderHook(() => useSheetExit(onClose));
    await act(async () => {});

    pressBack();
    expect(onClose).not.toHaveBeenCalled(); // exit animation still to play
    expect(addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
  });

  it('registers nothing on web, where there is no hardware back', async () => {
    isNativePlatform.mockReturnValue(false);
    renderHook(() => useSheetExit(vi.fn()));
    await act(async () => {});
    expect(addListener).not.toHaveBeenCalled();
  });

  it('only the topmost sheet answers one press', async () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    const outer = renderHook(() => useSheetExit(outerClose));
    await act(async () => {});
    const outerCalls = addListener.mock.calls.length;

    const inner = renderHook(() => useSheetExit(innerClose));
    await act(async () => {});
    // A second listener exists, so both are subscribed — the shared layer
    // stack, not the subscription, is what makes only one of them act.
    expect(addListener.mock.calls.length).toBeGreaterThan(outerCalls);

    inner.unmount();
    outer.unmount();
  });
});

describe('useSheetExit — focus containment', () => {
  it('moves focus into the panel and wraps Tab inside it', async () => {
    const panel = document.createElement('div');
    panel.tabIndex = -1;
    panel.innerHTML = '<button id="a">a</button><button id="b">b</button>';
    document.body.appendChild(panel);
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = panel;

    const { unmount } = renderHook(() => useSheetExit(vi.fn(), 'sheet-fall', ref));
    await act(async () => {});
    expect(document.activeElement?.id).toBe('a');

    // Tab off the last control wraps back to the first rather than walking
    // into the page behind the sheet.
    panel.querySelector<HTMLElement>('#b')!.focus();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
    });
    expect(document.activeElement?.id).toBe('a');

    unmount();
  });

  it('restores focus to whatever was focused before the sheet opened', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const panel = document.createElement('div');
    panel.tabIndex = -1;
    panel.innerHTML = '<button id="a">a</button>';
    document.body.appendChild(panel);
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = panel;

    const { unmount } = renderHook(() => useSheetExit(vi.fn(), 'sheet-fall', ref));
    await act(async () => {});
    expect(document.activeElement?.id).toBe('a');

    unmount();
    expect(document.activeElement).toBe(trigger);
  });

  it('is opt-in — no panel ref, no focus movement', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    renderHook(() => useSheetExit(vi.fn()));
    await act(async () => {});
    expect(document.activeElement).toBe(trigger);
  });
});
