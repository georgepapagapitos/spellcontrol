// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useMenuKeyboard } from './use-menu-keyboard';

interface HarnessProps {
  items?: { label: string; disabled?: boolean; selected?: boolean }[];
  itemSelector?: string;
  initialItemSelector?: string;
  role?: 'menuitem' | 'option';
  onItem?: (label: string) => void;
  ignoreSelector?: string;
}

function Harness({
  items = [{ label: 'One' }, { label: 'Two' }, { label: 'Three' }],
  itemSelector,
  initialItemSelector,
  role = 'menuitem',
  onItem,
  ignoreSelector,
}: HarnessProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { closeAndReturnFocus } = useMenuKeyboard({
    open,
    onClose: () => setOpen(false),
    panelRef,
    triggerRef,
    itemSelector,
    initialItemSelector,
    ignoreSelector,
  });
  return (
    <div>
      <button ref={triggerRef} type="button" onClick={() => setOpen((v) => !v)}>
        Trigger
      </button>
      {open && (
        <div ref={panelRef} role={role === 'option' ? 'listbox' : 'menu'}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role={role}
              disabled={item.disabled}
              aria-selected={role === 'option' ? item.selected === true : undefined}
              onClick={() => {
                closeAndReturnFocus();
                onItem?.(item.label);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <button type="button">Outside</button>
    </div>
  );
}

/**
 * A `dialog` panel: arbitrary controls rather than menuitems, so focus lands on
 * the first focusable and Tab stays inside instead of dismissing.
 */
function DialogHarness({ ignoreSelector }: { ignoreSelector?: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useMenuKeyboard({
    open,
    onClose: () => setOpen(false),
    panelRef,
    triggerRef,
    dialog: true,
    ignoreSelector,
  });
  return (
    <div>
      <button ref={triggerRef} type="button" onClick={() => setOpen((v) => !v)}>
        Trigger
      </button>
      {open && (
        <div ref={panelRef} role="dialog" aria-label="Filters">
          <button type="button">First chip</button>
          <button type="button">Last chip</button>
        </div>
      )}
      {/* Stands in for a SelectMenu that portaled out of the panel. */}
      <div className="portaled-child">
        <button type="button">Portaled option</button>
      </div>
      <button type="button">Outside</button>
    </div>
  );
}

const openMenu = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
};

/**
 * The scroll-dismiss listener attaches one frame after open (so the initial
 * focus move can't dismiss what just opened) — let that frame land.
 */
const settleScrollListener = async () => {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
};

describe('useMenuKeyboard', () => {
  it('focuses the first item when the menu opens', () => {
    render(<Harness />);
    openMenu();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'One' }));
  });

  it('focuses the initialItemSelector match (selected option) when provided', () => {
    render(
      <Harness
        role="option"
        itemSelector='[role="option"]'
        initialItemSelector='[role="option"][aria-selected="true"]'
        items={[{ label: 'One' }, { label: 'Two', selected: true }, { label: 'Three' }]}
      />
    );
    openMenu();
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Two' }));
  });

  it('falls back to the first item when initialItemSelector matches nothing', () => {
    render(
      <Harness
        role="option"
        itemSelector='[role="option"]'
        initialItemSelector='[role="option"][aria-selected="true"]'
        items={[{ label: 'One' }, { label: 'Two' }]}
      />
    );
    openMenu();
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'One' }));
  });

  it('moves focus with ArrowDown/ArrowUp, wrapping at both ends', () => {
    render(<Harness />);
    openMenu();
    const [one, two, three] = screen.getAllByRole('menuitem');

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(two);
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(three);
    // wrap bottom → top
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(one);
    // wrap top → bottom
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(three);
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(two);
  });

  it('jumps to the first/last item with Home/End', () => {
    render(<Harness />);
    openMenu();
    const items = screen.getAllByRole('menuitem');

    fireEvent.keyDown(document, { key: 'End' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(document, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('skips disabled items when navigating', () => {
    render(
      <Harness items={[{ label: 'One' }, { label: 'Two', disabled: true }, { label: 'Three' }]} />
    );
    openMenu();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'One' }));
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Three' }));
  });

  it('closes on Escape and returns focus to the trigger', () => {
    render(<Harness />);
    openMenu();
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Trigger' }));
  });

  it('closes on Tab and parks focus on the trigger', () => {
    render(<Harness />);
    openMenu();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Trigger' }));
  });

  it('closes on an outside pointerdown', () => {
    render(<Harness />);
    openMenu();
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not close on a pointerdown inside the panel or on the trigger', () => {
    render(<Harness />);
    openMenu();

    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Two' }));
    expect(screen.getByRole('menu')).toBeTruthy();

    // The trigger is excluded so its own click handler can toggle the menu
    // closed without a close-then-reopen flicker.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Trigger' }));
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('returns focus to the trigger when an item activation closes the menu', () => {
    const onItem = vi.fn();
    render(<Harness onItem={onItem} />);
    openMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Two' }));
    expect(onItem).toHaveBeenCalledWith('Two');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Trigger' }));
  });

  it('does nothing while closed and detaches listeners after closing', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Trigger' });

    // Closed: keyboard + pointer events are inert.
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();

    // Open, close, then make sure Escape doesn't re-steal focus.
    openMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
    screen.getByRole('button', { name: 'Outside' }).focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Outside' }));
  });

  it('ignores unrelated keys', () => {
    render(<Harness />);
    openMenu();
    const first = screen.getByRole('menuitem', { name: 'One' });
    fireEvent.keyDown(document, { key: 'a' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(document.activeElement).toBe(first);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  // Every panel on this hook is portaled to <body> and positioned `fixed` from
  // coordinates measured once, at open. A page scroll slides the trigger away
  // while the panel stays pinned to the screen, so an outside scroll must
  // dismiss it rather than leave a slab floating over unrelated content.
  describe('scroll dismissal', () => {
    it('closes when the page scrolls underneath the panel', async () => {
      render(<Harness />);
      openMenu();
      await settleScrollListener();

      fireEvent.scroll(document);
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('stays open when the scroll is inside the panel itself', async () => {
      render(<Harness />);
      openMenu();
      await settleScrollListener();

      fireEvent.scroll(screen.getByRole('menu'));
      expect(screen.getByRole('menu')).toBeTruthy();
    });

    it('stays open when the scroll is inside an ignoreSelector subtree', async () => {
      // SortPopover's case: its SelectMenu children portal out of the panel, so
      // scrolling that dropdown must not collapse the popover beneath it.
      render(<DialogHarness ignoreSelector=".portaled-child" />);
      openMenu();
      await settleScrollListener();

      fireEvent.scroll(document.querySelector('.portaled-child') as Element);
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('does not close on a scroll fired before the listener attaches', () => {
      render(<Harness />);
      openMenu();
      // No rAF flush — the opening frame's own focus scroll must be ignored.
      fireEvent.scroll(document);
      expect(screen.getByRole('menu')).toBeTruthy();
    });

    it('detaches the scroll listener once closed', async () => {
      render(<Harness />);
      openMenu();
      await settleScrollListener();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('menu')).toBeNull();

      // Would throw on a stale listener calling onClose against an unmounted panel.
      fireEvent.scroll(document);
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  describe('dialog panels', () => {
    it('focuses the first focusable control on open', () => {
      render(<DialogHarness />);
      openMenu();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First chip' }));
    });

    it('traps Tab inside the panel instead of dismissing it', () => {
      render(<DialogHarness />);
      openMenu();

      // A filter panel full of chips is unreachable if the first Tab closes it.
      screen.getByRole('button', { name: 'Last chip' }).focus();
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First chip' }));
    });

    it('still closes on Escape, returning focus to the trigger', () => {
      render(<DialogHarness />);
      openMenu();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Trigger' }));
    });

    it('closes when the page scrolls underneath it', async () => {
      render(<DialogHarness />);
      openMenu();
      await settleScrollListener();

      fireEvent.scroll(document);
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  // The overlay-layer stack is shared with Modal and useSheetExit. Registration
  // is gated on `open` because a popover component owns its trigger and so stays
  // mounted while closed — registering for the component's lifetime would leave
  // every mounted menu on the page sitting in the stack.
  it('only the topmost open layer answers Escape', () => {
    render(
      <div>
        <Harness />
        <DialogHarness />
      </div>
    );
    const [menuTrigger, dialogTrigger] = screen.getAllByRole('button', { name: 'Trigger' });

    fireEvent.click(menuTrigger);
    fireEvent.click(dialogTrigger);
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    // The dialog opened last, so it — and only it — answers the press.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
