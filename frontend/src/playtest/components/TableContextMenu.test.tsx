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
});
