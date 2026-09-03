// @vitest-environment happy-dom
import { createRef } from 'react';
import { act, fireEvent, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isNativePlatform } = vi.hoisted(() => ({ isNativePlatform: vi.fn(() => false) }));
vi.mock('./platform', () => ({ isNativePlatform }));

const { addListener, remove } = vi.hoisted(() => ({
  addListener: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@capacitor/app', () => ({ App: { addListener } }));

import { useOverlayDismiss } from './use-overlay-dismiss';

/** Invoke the most recently registered Capacitor `backButton` handler. */
function pressBack() {
  const calls = addListener.mock.calls.filter((c) => c[0] === 'backButton');
  const handler = calls[calls.length - 1]?.[1] as (() => void) | undefined;
  act(() => handler?.());
}

beforeEach(() => {
  addListener.mockReset();
  addListener.mockImplementation(async () => ({ remove }));
  isNativePlatform.mockReturnValue(false);
  document.body.innerHTML = '';
});

describe('useOverlayDismiss — Escape', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn();
    renderHook(() => useOverlayDismiss(onClose));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores other keys', () => {
    const onClose = vi.fn();
    renderHook(() => useOverlayDismiss(onClose));
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  // The game menu can open the custom layout editor on top of itself; one
  // Escape must close the editor and leave the menu open, not both.
  it('only the topmost overlay answers one press', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    const outer = renderHook(() => useOverlayDismiss(outerClose));
    const inner = renderHook(() => useOverlayDismiss(innerClose));

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();

    inner.unmount();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(outerClose).toHaveBeenCalledTimes(1);
    outer.unmount();
  });

  it('stops listening once unmounted', () => {
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useOverlayDismiss(onClose));
    unmount();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('useOverlayDismiss — Android hardware back', () => {
  it('closes instead of letting the WebView navigate', async () => {
    isNativePlatform.mockReturnValue(true);
    const onClose = vi.fn();
    renderHook(() => useOverlayDismiss(onClose));
    await act(async () => {});
    expect(addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
    pressBack();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('registers nothing on web, where there is no hardware back', async () => {
    renderHook(() => useOverlayDismiss(vi.fn()));
    await act(async () => {});
    expect(addListener).not.toHaveBeenCalled();
  });

  it('removes its listener on unmount', async () => {
    isNativePlatform.mockReturnValue(true);
    const { unmount } = renderHook(() => useOverlayDismiss(vi.fn()));
    await act(async () => {});
    unmount();
    await act(async () => {});
    expect(remove).toHaveBeenCalled();
  });
});

describe('useOverlayDismiss — focus', () => {
  it('moves focus into the panel and restores it on close', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open';
    document.body.appendChild(trigger);
    trigger.focus();

    const panel = document.createElement('div');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    const close = document.createElement('button');
    close.textContent = 'Close';
    panel.appendChild(close);
    document.body.appendChild(panel);
    const ref = createRef<HTMLElement>();
    ref.current = panel;

    const { unmount } = renderHook(() => useOverlayDismiss(vi.fn(), ref));
    expect(document.activeElement).toBe(close);

    unmount();
    expect(document.activeElement).toBe(trigger);
  });
});
