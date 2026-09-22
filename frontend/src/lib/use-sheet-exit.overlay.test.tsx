// @vitest-environment happy-dom
import { createRef } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Separate file from use-sheet-exit.test.ts so this setup doesn't change the
// one the motion/exit tests there rely on.
import { useSheetExit } from './use-sheet-exit';

beforeEach(() => {
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
