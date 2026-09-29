// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { useAnchoredPanel } from './use-anchored-panel';

function Probe() {
  const { open, toggle, triggerRef, panelRef, panelStyle } = useAnchoredPanel({ align: 'left' });
  return (
    <>
      <button ref={triggerRef} type="button" onClick={toggle}>
        open
      </button>
      {open &&
        panelStyle &&
        createPortal(
          <div ref={panelRef} role="dialog" aria-label="panel" style={panelStyle}>
            <button type="button">inside</button>
          </div>,
          document.body
        )}
    </>
  );
}

const innerWidth = window.innerWidth;
afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: innerWidth, configurable: true });
});

describe('useAnchoredPanel', () => {
  it('places the panel by its layout size, not the scaled box of its entrance animation', () => {
    // A 390px phone, a trigger mid-line, a 320px panel that is painted at
    // scale(0.98) on its first frame.
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    const rect = (left: number, width: number, top = 700, height = 22) =>
      ({
        left,
        width,
        right: left + width,
        top,
        height,
        bottom: top + height,
        x: left,
        y: top,
      }) as DOMRect;
    const trigger = () => screen.getByRole('button', { name: 'open' });
    render(<Probe />);
    trigger().getBoundingClientRect = () => rect(139, 73);
    const layout = Object.getOwnPropertyDescriptors(HTMLElement.prototype);
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 320,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 190,
    });
    const paint = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      return this.getAttribute('role') === 'dialog' ? rect(0, 313.6, 0, 186.2) : paint.call(this);
    };
    try {
      fireEvent.click(trigger());
      const panel = screen.getByRole('dialog', { name: 'panel' });
      // 390 − 8px edge pad − 320 = 62. The scaled 313.6 would have given 68.4,
      // leaving the real panel 2px from the screen edge.
      expect(panel.style.left).toBe('62px');
    } finally {
      Element.prototype.getBoundingClientRect = paint;
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', layout.offsetWidth);
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', layout.offsetHeight);
    }
  });
});
