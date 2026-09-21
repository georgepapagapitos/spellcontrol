// @vitest-environment happy-dom
/**
 * The table's own right-click menu. It is the only place several board
 * actions are labelled with the key that fires them, so the shortcut text is
 * as load-bearing as the items themselves.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TableContextMenu, type TableMenuItem } from './TableContextMenu';

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
    render(<TableContextMenu x={10} y={10} variant="floating" items={items()} onClose={vi.fn()} />);

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
    render(<TableContextMenu x={0} y={0} variant="floating" items={list} onClose={onClose} />);

    fireEvent.click(screen.getByRole('menuitem', { name: /Draw/ }));

    expect(order).toEqual(['close', 'draw']);
  });

  it('renders a disabled item as non-interactive rather than hiding it', () => {
    const onClick = vi.fn();
    const list = items([{ onClick, disabled: true }]);
    render(<TableContextMenu x={0} y={0} variant="floating" items={list} onClose={vi.fn()} />);

    const draw = screen.getByRole('menuitem', { name: /Draw/ });
    expect((draw as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(draw);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('names itself for the menu role so the shell announces what opened', () => {
    render(<TableContextMenu x={0} y={0} variant="floating" items={items()} onClose={vi.fn()} />);
    expect(screen.getByRole('menu', { name: 'Table actions' })).toBeTruthy();
  });

  it('takes a title, so a pile menu says which pile it belongs to', () => {
    render(
      <TableContextMenu
        x={0}
        y={0}
        variant="floating"
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
    render(<TableContextMenu x={0} y={0} variant="floating" items={list} onClose={vi.fn()} />);
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
 * A row with `items` drills into a page instead of acting — the same shape
 * `CardContextMenu` uses, so a list of destinations doesn't have to be spent
 * as a dozen rows on the root.
 */
describe('TableContextMenu — submenu pages', () => {
  function nested(onMove = vi.fn()): TableMenuItem[] {
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

  it('opens a page, runs the row on it, and never fires the parent', () => {
    const onMove = vi.fn();
    const onClose = vi.fn();
    const list = nested(onMove);
    render(<TableContextMenu x={0} y={0} variant="floating" items={list} onClose={onClose} />);

    const parent = screen.getByRole('menuitem', { name: /Move all to/ });
    expect(parent.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(parent);
    // Drilling in is navigation, not an action: nothing ran and nothing closed.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('menuitem', { name: 'Shuffle' })).toBeNull();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Hand' }));
    expect(onMove).toHaveBeenCalled();
  });

  it('renames itself for the page and offers a way back to the root', () => {
    render(
      <TableContextMenu
        x={0}
        y={0}
        variant="floating"
        title="Graveyard"
        items={nested()}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /Move all to/ }));
    expect(screen.getByRole('menu', { name: 'Move all to' })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Back to Graveyard' }));
    expect(screen.getByRole('menu', { name: 'Graveyard' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Shuffle' })).toBeTruthy();
  });

  it('renders a page that is a control instead of a list of rows', () => {
    const list: TableMenuItem[] = [{ label: 'Draw several', content: <p>count goes here</p> }];
    render(<TableContextMenu x={0} y={0} variant="floating" items={list} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /Draw several/ }));
    expect(screen.getByText('count goes here')).toBeTruthy();
  });
});
