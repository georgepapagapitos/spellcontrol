// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useMenuKeyboard } from './use-menu-keyboard';

interface HarnessProps {
  items?: { label: string; disabled?: boolean; selected?: boolean }[];
  itemSelector?: string;
  initialItemSelector?: string;
  role?: 'menuitem' | 'option';
  onItem?: (label: string) => void;
}

function Harness({
  items = [{ label: 'One' }, { label: 'Two' }, { label: 'Three' }],
  itemSelector,
  initialItemSelector,
  role = 'menuitem',
  onItem,
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

const openMenu = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
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
});
