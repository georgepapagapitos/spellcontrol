// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { CardHoverPreview } from './CardHoverPreview';

/** `finePointer` answers the hover query; `upright` the upright-phone one. */
function stubMatchMedia(finePointer: boolean, upright = false) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('orientation: portrait') ? upright : finePointer,
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
/** A two-faced card: the face showing, and the other one. */
const DFC = { src: 'https://img/delver.jpg', back: 'https://img/aberration.jpg' };
const resolve = (id: string) => (id === 'dfc' ? DFC : SRCS[id] ? { src: SRCS[id] } : null);

function cardEl(id?: string, isToken = false) {
  const el = document.createElement('div');
  if (id) el.setAttribute('data-preview-id', id);
  if (isToken) el.setAttribute('data-token', '');
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

  // User feedback 2026-09-23: "it should appear immediately". No timer is
  // advanced here on purpose: the face is up the moment the pointer lands.
  it('shows the full face the instant the pointer lands on a card, and hides on leave', () => {
    stubMatchMedia(true);
    render(<CardHoverPreview suspended={false} resolve={resolve} />);
    const el = cardEl('sol');
    act(() => {
      el.dispatchEvent(new Event('pointerover', { bubbles: true }));
    });
    const img = document.querySelector<HTMLImageElement>('.playtest-hover-preview img');
    expect(img?.getAttribute('src')).toBe('https://img/sol-ring.jpg');
    act(() => {
      el.dispatchEvent(new Event('pointerout', { bubbles: true }));
    });
    expect(document.querySelector('.playtest-hover-preview')).toBeNull();
  });

  // EDHPlay's preview reads the body the board does (2026-09-24): the art
  // prints 2/2, the plates say what a pumped bear is now.
  it('carries the card’s live body and counters onto the enlarged face', () => {
    stubMatchMedia(true);
    render(
      <CardHoverPreview
        suspended={false}
        resolve={() => ({
          src: SRCS.a,
          pt: { power: '3', toughness: '3', modified: true },
          counters: { '+1/+1': 1 },
        })}
      />
    );
    const el = cardEl('a');
    act(() => {
      el.dispatchEvent(new Event('pointerover', { bubbles: true }));
    });
    const face = document.querySelector('.playtest-hover-preview__face');
    const box = face?.querySelector('.playtest-card__pt');
    expect(box?.getAttribute('aria-label')).toBe('3 by 3');
    expect(box?.className).toContain('is-modified');
    expect(face?.querySelector('.ms-counter-plus')).toBeTruthy();
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

  // Touch has no hover (user, 2026-09-25, EDHPlay's phone table): a tapped
  // hand card is pinned in the same slot, another hand card swaps it, and a
  // tap anywhere off the hand puts it away.
  it('shows a tapped card on touch until a tap lands off the hand', () => {
    stubMatchMedia(false);
    const hand = document.createElement('div');
    hand.className = 'playtest-hand';
    document.body.appendChild(hand);
    const a = cardEl('a');
    const b = cardEl('b');
    hand.append(a, b);
    const onUnpin = vi.fn();
    const { rerender } = render(
      <CardHoverPreview suspended={false} resolve={resolve} pinned="a" onUnpin={onUnpin} />
    );
    const src = () =>
      document.querySelector('.playtest-hover-preview img')?.getAttribute('src') ?? null;
    expect(src()).toBe(SRCS.a);

    act(() => {
      b.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(onUnpin).not.toHaveBeenCalled();
    rerender(<CardHoverPreview suspended={false} resolve={resolve} pinned="b" onUnpin={onUnpin} />);
    expect(src()).toBe(SRCS.b);

    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(onUnpin).toHaveBeenCalledTimes(1);
  });

  // The tap that opened the hand menu now shows the card (#2282), so the
  // tapped card says where the menu went, until the board has seen one open.
  it('says a hold opens the menu under a tapped card, never under a hovered one', () => {
    stubMatchMedia(false);
    cardEl('a');
    const hint = () => document.querySelector('.playtest-hover-preview__hint')?.textContent;
    const { rerender } = render(
      <CardHoverPreview suspended={false} resolve={resolve} pinned="a" holdHint />
    );
    expect(hint()).toBe('Hold a card for its menu.');
    rerender(<CardHoverPreview suspended={false} resolve={resolve} pinned="a" />);
    expect(hint()).toBeUndefined();

    document.body.innerHTML = '';
    stubMatchMedia(true);
    render(<CardHoverPreview suspended={false} resolve={resolve} holdHint />);
    const el = cardEl('b');
    act(() => {
      el.dispatchEvent(new Event('pointerover', { bubbles: true }));
    });
    expect(document.querySelector('.playtest-hover-preview')).not.toBeNull();
    expect(hint()).toBeUndefined();
  });

  // A quarter of a 390px phone is 94px, barely bigger than the card tapped.
  it('shows a tapped card at reading width in the middle of an upright phone', () => {
    stubMatchMedia(false, true);
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
    cardEl('a');
    render(<CardHoverPreview suspended={false} resolve={resolve} pinned="a" />);
    const pane = document.querySelector<HTMLElement>('.playtest-hover-preview')!;
    expect(parseFloat(pane.style.width)).toBeCloseTo(390 * 0.72, 1);
    // Centred between the margins, nothing on this bare page to avoid.
    expect(parseFloat(pane.style.left)).toBeCloseTo((12 + 378 - 390 * 0.72) / 2, 1);
  });

  it('shows nothing for a pinned card that has left the hand, or while suspended', () => {
    stubMatchMedia(false);
    const { rerender } = render(
      <CardHoverPreview suspended={false} resolve={resolve} pinned="a" />
    );
    expect(document.querySelector('.playtest-hover-preview')).toBeNull();
    cardEl('a');
    rerender(<CardHoverPreview suspended resolve={resolve} pinned="a" />);
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

  // EDHPlay shows both faces of a two-faced card, and the face that is not
  // showing is exactly the one the table cannot read. The pane is two faces
  // wide, and still flips left for a card under it.
  it('shows both faces of a two-faced card side by side, in a slot two wide', () => {
    stubMatchMedia(true);
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
    render(<CardHoverPreview suspended={false} resolve={resolve} />);
    const el = cardEl('dfc');
    el.getBoundingClientRect = () =>
      ({ left: 300, right: 400, top: 400, bottom: 540, width: 100, height: 140 }) as DOMRect;
    act(() => {
      el.dispatchEvent(new Event('focusin', { bubbles: true }));
      vi.advanceTimersByTime(0);
    });
    const pane = document.querySelector<HTMLElement>('.playtest-hover-preview')!;
    expect([...pane.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual([
      DFC.src,
      DFC.back,
    ]);
    const paneWidth = 345.6 * 2 + 8;
    expect(parseFloat(pane.style.width)).toBeCloseTo(paneWidth, 1);
    expect(parseFloat(pane.style.left)).toBeCloseTo(1440 - 24 - paneWidth, 1);

    // A single-faced card keeps the one-face slot.
    const one = cardEl('a');
    act(() => {
      one.dispatchEvent(new Event('focusin', { bubbles: true }));
      vi.advanceTimersByTime(0);
    });
    expect(document.querySelectorAll('.playtest-hover-preview img').length).toBe(1);
  });

  // The enlarged face is the art of the card the token copied, so this is
  // the one surface where the difference would otherwise disappear.
  it('marks a token, and leaves a real card unmarked', () => {
    stubMatchMedia(true);
    const { rerender } = render(<CardHoverPreview suspended={false} resolve={resolve} />);
    const token = cardEl('a', true);
    act(() => {
      token.dispatchEvent(new Event('focusin', { bubbles: true }));
      vi.advanceTimersByTime(0);
    });
    expect(document.querySelector('.playtest-hover-preview__token')?.textContent).toBe('Token');

    rerender(<CardHoverPreview suspended={false} resolve={resolve} />);
    const real = cardEl('b');
    act(() => {
      real.dispatchEvent(new Event('focusin', { bubbles: true }));
      vi.advanceTimersByTime(0);
    });
    expect(document.querySelector('.playtest-hover-preview__token')).toBeNull();
  });
});
