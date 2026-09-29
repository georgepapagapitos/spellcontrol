// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import type { MouseEvent } from 'react';
import { suppressNativeContextMenu } from './suppress-context-menu';

/** A React synthetic event is a thin wrapper over the DOM one for our purposes:
 *  a target and a preventDefault. Building it from real elements keeps the
 *  `closest()` walk honest — a hand-stubbed target would not have ancestors. */
function contextMenuOn(target: Element) {
  let prevented = false;
  return {
    event: { target, preventDefault: () => (prevented = true) } as unknown as MouseEvent,
    get prevented() {
      return prevented;
    },
  };
}

describe('suppressNativeContextMenu', () => {
  it('cancels the native menu on board chrome', () => {
    const badge = document.createElement('span');
    document.body.append(badge);
    const e = contextMenuOn(badge);
    suppressNativeContextMenu(e.event);
    expect(e.prevented).toBe(true);
  });

  it('leaves text fields their own menu, including a child of one', () => {
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const inside = document.createElement('span');
    editable.append(inside);
    document.body.append(input, area, editable);

    for (const target of [input, area, editable, inside]) {
      const e = contextMenuOn(target);
      suppressNativeContextMenu(e.event);
      expect(e.prevented).toBe(false);
    }
  });
});
