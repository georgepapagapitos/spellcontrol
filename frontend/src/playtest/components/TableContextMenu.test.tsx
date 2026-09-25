// @vitest-environment happy-dom
/**
 * The table's own right-click menu. It is the only place several board
 * actions are labelled with the key that fires them, so the shortcut text is
 * as load-bearing as the items themselves.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  SEPARATOR,
  TableContextMenu,
  type MenuEntry,
  type TableMenuItem,
} from './TableContextMenu';

function items(overrides: Partial<TableMenuItem>[] = []): TableMenuItem[] {
  const base: TableMenuItem[] = [
    { label: 'Draw', shortcut: 'D', onClick: vi.fn() },
    { label: 'Next turn', shortcut: 'N', onClick: vi.fn() },
    { label: 'Untap all', shortcut: 'U', onClick: vi.fn() },
    { label: 'Roll dice', onClick: vi.fn() },
  ];
  return base.map((item, i) => ({ ...item, ...overrides[i] }));
}

describe('TableContextMenu', () => {
  it('renders every item as a menuitem with its shortcut beside it', () => {
    render(<TableContextMenu x={10} y={10} items={items()} onClose={vi.fn()} />);

    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems.map((el) => el.textContent)).toEqual([
      'DrawD',
      'Next turnN',
      'Untap allU',
      'Roll dice',
    ]);
    // Shortcuts are <kbd>, not text in the label — that's what right-aligns
    // them and keeps the label readable to a screen reader.
    expect(menuItems[0].querySelector('kbd')?.textContent).toBe('D');
    expect(menuItems[3].querySelector('kbd')).toBeNull();
  });

  it('closes before running the action, so the board is live when it lands', () => {
    const order: string[] = [];
    const onClose = vi.fn(() => order.push('close'));
    const list = items([{ onClick: () => order.push('draw') }]);
    render(<TableContextMenu x={0} y={0} items={list} onClose={onClose} />);

    fireEvent.click(screen.getByRole('menuitem', { name: /Draw/ }));

    expect(order).toEqual(['close', 'draw']);
  });

  it('renders a disabled item as non-interactive rather than hiding it', () => {
    const onClick = vi.fn();
    const list = items([{ onClick, disabled: true }]);
    render(<TableContextMenu x={0} y={0} items={list} onClose={vi.fn()} />);

    const draw = screen.getByRole('menuitem', { name: /Draw/ });
    expect((draw as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(draw);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('names itself for the menu role so the shell announces what opened', () => {
    render(<TableContextMenu x={0} y={0} items={items()} onClose={vi.fn()} />);
    expect(screen.getByRole('menu', { name: 'Table actions' })).toBeTruthy();
  });

  it('takes a title, so a pile menu says which pile it belongs to', () => {
    render(
      <TableContextMenu
        x={0}
        y={0}

        title="Library"
        items={items()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole('menu', { name: 'Library' })).toBeTruthy();
  });

  it('reports a toggle row’s state rather than renaming it each way', () => {
    const list: TableMenuItem[] = [
      { label: 'Play with the top card revealed', pressed: true, onClick: vi.fn() },
      { label: 'Reveal the library to the table', pressed: false, onClick: vi.fn() },
      { label: 'Shuffle', onClick: vi.fn() },
    ];
    render(<TableContextMenu x={0} y={0} items={list} onClose={vi.fn()} />);
    // A toggle in a menu is a menuitemcheckbox, not a pressed button — the
    // role is what tells a screen reader this row has an on and an off.
    expect(
      screen
        .getByRole('menuitemcheckbox', { name: /top card revealed/ })
        .getAttribute('aria-checked')
    ).toBe('true');
    expect(
      screen.getByRole('menuitemcheckbox', { name: /to the table/ }).getAttribute('aria-checked')
    ).toBe('false');
    // A plain action is not a toggle and must not claim to be one.
    expect(screen.getByRole('menuitem', { name: 'Shuffle' })).toBeTruthy();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Shuffle' })).toBeNull();
  });
});

/**
 * A row with `items` opens a submenu. With a pointer it flies out BESIDE the
 * menu, EDHPlay's way, and the root stays in view; in the bottom sheet the
 * same tree drills down a page at a time.
 */
describe('TableContextMenu — submenus', () => {
  function nested(onMove = vi.fn()): MenuEntry[] {
    return [
      { label: 'Shuffle', onClick: vi.fn() },
      {
        label: 'Move all to',
        items: [
          { label: 'Hand', onClick: onMove },
          { label: 'Graveyard', onClick: vi.fn() },
        ],
      },
    ];
  }

  it('flies a submenu out beside the menu, runs its row, and never fires the parent', () => {
    const onMove = vi.fn();
    const onClose = vi.fn();
    render(<TableContextMenu x={0} y={0} items={nested(onMove)} onClose={onClose} />);

    const parent = screen.getByRole('menuitem', { name: /Move all to/ });
    expect(parent.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(parent);
    // Opening is navigation, not an action: nothing ran and nothing closed,
    // and the menu it came from is still there beside it.
    expect(onClose).not.toHaveBeenCalled();
    expect(parent.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'Move all to' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Shuffle' })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Hand' }));
    expect(onMove).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('opens on hover and closes when the pointer rests on a sibling row', () => {
    vi.useFakeTimers();
    try {
      render(<TableContextMenu x={0} y={0} items={nested()} onClose={vi.fn()} />);
      fireEvent.pointerEnter(screen.getByRole('menuitem', { name: /Move all to/ }), {
        pointerType: 'mouse',
      });
      act(() => void vi.advanceTimersByTime(200));
      expect(screen.getByRole('menu', { name: 'Move all to' })).toBeTruthy();

      fireEvent.pointerEnter(screen.getByRole('menuitem', { name: 'Shuffle' }), {
        pointerType: 'mouse',
      });
      act(() => void vi.advanceTimersByTime(200));
      expect(screen.queryByRole('menu', { name: 'Move all to' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens with → and backs out with ←, handing focus each way', () => {
    render(<TableContextMenu x={0} y={0} items={nested()} onClose={vi.fn()} />);
    const parent = screen.getByRole('menuitem', { name: /Move all to/ });
    fireEvent.keyDown(parent, { key: 'ArrowRight' });
    const hand = screen.getByRole('menuitem', { name: 'Hand' });
    expect(document.activeElement).toBe(hand);

    fireEvent.keyDown(hand, { key: 'ArrowLeft' });
    expect(screen.queryByRole('menu', { name: 'Move all to' })).toBeNull();
    expect(document.activeElement).toBe(parent);
  });

  it('walks its rows with ↑ and ↓, wrapping at the ends', () => {
    render(<TableContextMenu x={0} y={0} items={items()} onClose={vi.fn()} />);
    const rows = screen.getAllByRole('menuitem');
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[rows.length - 1]);
    fireEvent.keyDown(rows[rows.length - 1], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[0]);
  });

  it('opens with a submenu already open when asked for one by id', () => {
    const list: MenuEntry[] = [
      { label: 'Tap', onClick: vi.fn() },
      { id: 'counters', label: 'Counters', content: <p>steppers</p> },
    ];
    render(
      <TableContextMenu
        x={0}
        y={0}

        items={list}
        openId="counters"
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('steppers')).toBeTruthy();
  });

  it('renders a submenu that is a control instead of a list of rows', () => {
    const list: MenuEntry[] = [{ label: 'Draw several', content: <p>count goes here</p> }];
    render(<TableContextMenu x={0} y={0} items={list} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /Draw several/ }));
    expect(screen.getByText('count goes here')).toBeTruthy();
  });
});

/**
 * EDHPlay draws a line between groups of rows. Conditional rows come and go
 * from a caller's list, and a line must never end up first, last or doubled.
 */
describe('TableContextMenu — separators', () => {
  it('draws a line between groups and none at either end or twice in a row', () => {
    const list: MenuEntry[] = [
      SEPARATOR,
      { label: 'Tap', onClick: vi.fn() },
      SEPARATOR,
      SEPARATOR,
      { label: 'Flip', onClick: vi.fn() },
      SEPARATOR,
    ];
    render(<TableContextMenu x={0} y={0} items={list} onClose={vi.fn()} />);
    const menu = screen.getByRole('menu');
    const kinds = [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((el) =>
      el.getAttribute('role')
    );
    expect(kinds).toEqual(['menuitem', 'separator', 'menuitem']);
  });
});
