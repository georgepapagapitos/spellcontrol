// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OverflowMenu } from './OverflowMenu';

describe('OverflowMenu', () => {
  it('is collapsed until the trigger is clicked', () => {
    render(<OverflowMenu items={[{ label: 'Import deck', onClick: () => {} }]} />);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Import deck' })).toBeTruthy();
  });

  it('runs the item handler and closes on select', () => {
    const onClick = vi.fn();
    render(
      <OverflowMenu ariaLabel="More deck actions" items={[{ label: 'Add precon', onClick }]} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'More deck actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add precon' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape and on an outside pointerdown', () => {
    render(<OverflowMenu items={[{ label: 'Import deck', onClick: () => {} }]} />);
    const trigger = screen.getByRole('button', { name: 'More actions' });

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('moves focus to the first item on open and back to the trigger on close', () => {
    render(
      <OverflowMenu
        items={[
          { label: 'Import deck', onClick: () => {} },
          { label: 'Add precon', onClick: () => {} },
        ]}
      />
    );
    const trigger = screen.getByRole('button', { name: 'More actions' });

    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Import deck' }));

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Add precon' }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('returns focus to the trigger when an item is activated', () => {
    render(<OverflowMenu items={[{ label: 'Import deck', onClick: () => {} }]} />);
    const trigger = screen.getByRole('button', { name: 'More actions' });

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import deck' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
