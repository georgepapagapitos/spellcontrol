// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  isKeyboardContextMenu,
  itemFocusTarget,
  keepsBrowserMenu,
  markMenuTarget,
} from './context-menu';

function contextMenuOn(target: Element, init: MouseEventInit = {}): MouseEvent {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, ...init });
  Object.defineProperty(e, 'target', { value: target });
  return e;
}

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

describe('isKeyboardContextMenu', () => {
  it('reads Chromium’s button -1 as the keyboard', () => {
    expect(isKeyboardContextMenu(new MouseEvent('contextmenu', { button: -1 }))).toBe(true);
  });

  it('reads an empty pointerType as the keyboard', () => {
    const e = new MouseEvent('contextmenu', { button: 0 });
    Object.defineProperty(e, 'pointerType', { value: '' });
    expect(isKeyboardContextMenu(e)).toBe(true);
  });

  it('reads a right button as a pointer', () => {
    expect(isKeyboardContextMenu(new MouseEvent('contextmenu', { button: 2 }))).toBe(false);
  });
});

describe('keepsBrowserMenu', () => {
  it('opens ours on an item’s plain body', () => {
    const host = mount('<div class="item"><span class="name">Sol Ring</span></div>');
    expect(keepsBrowserMenu(contextMenuOn(host.querySelector('.name')!))).toBe(false);
  });

  it('lets Shift + right-click through to the browser', () => {
    const host = mount('<div class="item"><span class="name">Sol Ring</span></div>');
    expect(keepsBrowserMenu(contextMenuOn(host.querySelector('.name')!, { shiftKey: true }))).toBe(
      true
    );
  });

  it('keeps Shift+F10 as ours: it is the keyboard shortcut for this menu', () => {
    const host = mount('<div class="item"><button>Sol Ring</button></div>');
    const e = contextMenuOn(host.querySelector('button')!, { shiftKey: true, button: -1 });
    expect(keepsBrowserMenu(e)).toBe(false);
  });

  it('leaves fields to the browser', () => {
    const host = mount('<div class="item"><input value="4" /><textarea></textarea></div>');
    expect(keepsBrowserMenu(contextMenuOn(host.querySelector('input')!))).toBe(true);
    expect(keepsBrowserMenu(contextMenuOn(host.querySelector('textarea')!))).toBe(true);
  });

  it('leaves a link that is not the item’s own to the browser', () => {
    const host = mount('<div class="item"><a href="/decks/other">In a deck</a></div>');
    expect(keepsBrowserMenu(contextMenuOn(host.querySelector('a')!), '/decks/mine')).toBe(true);
    expect(keepsBrowserMenu(contextMenuOn(host.querySelector('a')!))).toBe(true);
  });

  it('takes the item’s own link, whose menu carries Open in new tab and Copy link', () => {
    const host = mount('<div class="item"><a href="/decks/mine"><span>Mine</span></a></div>');
    expect(keepsBrowserMenu(contextMenuOn(host.querySelector('span')!), '/decks/mine')).toBe(false);
  });

  it('leaves selected text under the pointer to the browser', () => {
    const host = mount('<div class="item"><p class="text">Destroy target artifact.</p></div>');
    const text = host.querySelector('.text')!;
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()!.addRange(range);
    expect(keepsBrowserMenu(contextMenuOn(text))).toBe(true);
  });
});

describe('markMenuTarget', () => {
  it('marks the item while its menu is open and clears it after', () => {
    const el = mount('<div></div>');
    const clear = markMenuTarget(el);
    expect(el.hasAttribute('data-menu-open')).toBe(true);
    clear();
    expect(el.hasAttribute('data-menu-open')).toBe(false);
  });

  it('is a no-op without an element', () => {
    expect(() => markMenuTarget(null)()).not.toThrow();
  });
});

describe('itemFocusTarget', () => {
  it('hands focus back to the item’s own control, not the ⋮', () => {
    const host = mount('<div class="item"><a href="/x"><span class="t">Deck</span></a></div>');
    expect(itemFocusTarget(host.querySelector('.t'), host)).toBe(host.querySelector('a'));
  });

  it('falls back to a focusable host', () => {
    const host = mount('<span class="t">Row</span>');
    host.tabIndex = 0;
    expect(itemFocusTarget(host.querySelector('.t'), host)).toBe(host);
  });
});
