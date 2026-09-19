// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { CardHoverPreview } from './CardHoverPreview';

function stubMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const SRCS: Record<string, string> = {
  sol: 'https://img/sol-ring.jpg',
  a: 'https://img/a.jpg',
  b: 'https://img/b.jpg',
  c: 'https://img/c.jpg',
};
const resolve = (id: string) => SRCS[id] ?? null;

function cardEl(id?: string) {
  const el = document.createElement('div');
  if (id) el.setAttribute('data-preview-id', id);
  el.setAttribute('aria-label', 'Sol Ring');
  el.tabIndex = 0;
  document.body.appendChild(el);
  return el;
}

describe('CardHoverPreview', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('shows the full face after a short hover on a fine pointer, and hides on leave', () => {
    stubMatchMedia(true);
    render(<CardHoverPreview suspended={false} resolve={resolve} />);
    const el = cardEl('sol');
    act(() => {
      el.dispatchEvent(new Event('pointerover', { bubbles: true }));
    });
    expect(document.querySelector('.playtest-hover-preview')).toBeNull(); // not yet
    act(() => {
      vi.advanceTimersByTime(250);
    });
    const img = document.querySelector<HTMLImageElement>('.playtest-hover-preview img');
    expect(img?.getAttribute('src')).toBe('https://img/sol-ring.jpg');
    act(() => {
      el.dispatchEvent(new Event('pointerout', { bubbles: true }));
    });
    expect(document.querySelector('.playtest-hover-preview')).toBeNull();
  });

  it('shows immediately on keyboard focus', () => {
    stubMatchMedia(true);
    render(<CardHoverPreview suspended={false} resolve={resolve} />);
    const el = cardEl('a');
    act(() => {
      el.dispatchEvent(new Event('focusin', { bubbles: true }));
      vi.advanceTimersByTime(0);
    });
    expect(document.querySelector('.playtest-hover-preview')).not.toBeNull();
  });

  it('never shows for a card without a preview id (face-down), an unknown id, while suspended, or on touch', () => {
    stubMatchMedia(true);
    const { rerender } = render(<CardHoverPreview suspended={false} resolve={resolve} />);
    const faceDown = cardEl(undefined);
    act(() => {
      faceDown.dispatchEvent(new Event('pointerover', { bubbles: true }));
      vi.advanceTimersByTime(500);
    });
    expect(document.querySelector('.playtest-hover-preview')).toBeNull();

    const unknown = cardEl('not-a-card');
    act(() => {
      unknown.dispatchEvent(new Event('pointerover', { bubbles: true }));
      vi.advanceTimersByTime(500);
    });
    expect(document.querySelector('.playtest-hover-preview')).toBeNull();

    const el = cardEl('b');
    rerender(<CardHoverPreview suspended resolve={resolve} />);
    act(() => {
      el.dispatchEvent(new Event('pointerover', { bubbles: true }));
      vi.advanceTimersByTime(500);
    });
    expect(document.querySelector('.playtest-hover-preview')).toBeNull();

    document.body.innerHTML = '';
    stubMatchMedia(false);
    render(<CardHoverPreview suspended={false} resolve={resolve} />);
    const touch = cardEl('c');
    act(() => {
      touch.dispatchEvent(new Event('pointerover', { bubbles: true }));
      vi.advanceTimersByTime(500);
    });
    expect(document.querySelector('.playtest-hover-preview')).toBeNull();
  });

  it('sits in one fixed slot at the right edge, and flips left only for a card under that slot', () => {
    stubMatchMedia(true);
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
    render(<CardHoverPreview suspended={false} resolve={resolve} />);
    const rect = (x: number) =>
      ({ left: x, right: x + 100, top: 400, bottom: 540, width: 100, height: 140 }) as DOMRect;

    const mid = cardEl('a');
    mid.getBoundingClientRect = () => rect(600);
    act(() => {
      mid.dispatchEvent(new Event('focusin', { bubbles: true }));
      vi.advanceTimersByTime(0);
    });
    const pane = () => document.querySelector<HTMLElement>('.playtest-hover-preview')!;
    // width = min(352, 24vw = 345.6) → right slot left edge = 1440 - 24 - 345.6
    expect(parseFloat(pane().style.left)).toBeCloseTo(1440 - 24 - 345.6, 1);
    expect(parseFloat(pane().style.top)).toBeCloseTo((900 - 345.6 * 1.4) / 2, 1);

    const farRight = cardEl('b');
    farRight.getBoundingClientRect = () => rect(1300);
    act(() => {
      farRight.dispatchEvent(new Event('focusin', { bubbles: true }));
      vi.advanceTimersByTime(0);
    });
    expect(parseFloat(pane().style.left)).toBe(24);
  });

  it('starts below a corner cluster it would otherwise cover', () => {
    stubMatchMedia(true);
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
    const corner = document.createElement('div');
    corner.className = 'playtest-corner';
    corner.getBoundingClientRect = () =>
      ({ left: 1300, right: 1428, top: 12, bottom: 280, width: 128, height: 268 }) as DOMRect;
    document.body.appendChild(corner);
    render(<CardHoverPreview suspended={false} resolve={resolve} />);
    const el = cardEl('a');
    el.getBoundingClientRect = () =>
      ({ left: 600, right: 700, top: 700, bottom: 840, width: 100, height: 140 }) as DOMRect;
    act(() => {
      el.dispatchEvent(new Event('focusin', { bubbles: true }));
      vi.advanceTimersByTime(0);
    });
    const pane = document.querySelector<HTMLElement>('.playtest-hover-preview')!;
    expect(parseFloat(pane.style.top)).toBe(280 + 12);
  });
});
