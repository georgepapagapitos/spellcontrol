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

  it('renders a header node and disabled items', () => {
    render(
      <OverflowMenu
        header={<div>In Binder X</div>}
        items={[
          { label: 'Move up', onClick: () => {}, disabled: true },
          { label: 'Edit', onClick: () => {} },
        ]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByText('In Binder X')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveProperty('disabled', true);
  });

  it('does not bubble trigger or item clicks to a clickable ancestor row', () => {
    const onRowClick = vi.fn();
    const onItem = vi.fn();
    render(
      <div role="button" tabIndex={0} onClick={onRowClick} onKeyDown={() => {}}>
        <OverflowMenu items={[{ label: 'Edit card', onClick: onItem }]} />
      </div>
    );
    const trigger = screen.getByRole('button', { name: 'More actions' });

    fireEvent.click(trigger);
    expect(onRowClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit card' }));
    expect(onItem).toHaveBeenCalledOnce();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  // ── Right-click (T162, STYLE_GUIDE § Verbs — Menus) ─────────────────────
  describe('right-click on its item', () => {
    const tile = (extra: Partial<React.ComponentProps<typeof OverflowMenu>> = {}) =>
      render(
        <div className="tile" data-testid="tile">
          <a href="/decks/abc" data-testid="own-link">
            <span data-testid="name">Atraxa</span>
          </a>
          <a href="/decks/other" data-testid="other-link">
            elsewhere
          </a>
          <OverflowMenu
            ariaLabel="Actions for Atraxa"
            contextHost=".tile"
            items={[
              { label: 'Rename', onClick: () => {} },
              { label: 'Delete deck', onClick: () => {}, danger: true },
            ]}
            {...extra}
          />
        </div>
      );

    it('opens the same menu at the pointer', () => {
      tile({ itemHref: '/decks/abc' });
      const notPrevented = fireEvent.contextMenu(screen.getByTestId('name'), {
        clientX: 140,
        clientY: 220,
      });
      expect(notPrevented).toBe(false);
      const menu = screen.getByRole('menu');
      expect(menu.style.left).toBe('140px');
      expect(menu.style.top).toBe('220px');
      expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    });

    it('marks the item while the menu is open, from a right-click or the ⋮ alike', () => {
      tile();
      const host = screen.getByTestId('tile');
      fireEvent.contextMenu(host, { clientX: 10, clientY: 10 });
      expect(host.hasAttribute('data-menu-open')).toBe(true);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(host.hasAttribute('data-menu-open')).toBe(false);

      fireEvent.click(screen.getByRole('button', { name: 'Actions for Atraxa' }));
      expect(host.hasAttribute('data-menu-open')).toBe(true);
    });

    it('gives focus back to the item on Escape, not to its ⋮', () => {
      tile({ itemHref: '/decks/abc' });
      fireEvent.contextMenu(screen.getByTestId('name'), { clientX: 10, clientY: 10 });
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(document.activeElement).toBe(screen.getByTestId('own-link'));
    });

    it('opens at the ⋮ for the Context Menu key or Shift+F10', () => {
      tile();
      fireEvent.contextMenu(screen.getByTestId('tile'), {
        button: -1,
        shiftKey: true,
        clientX: 300,
        clientY: 400,
      });
      const menu = screen.getByRole('menu');
      // Hung off the trigger, not at the coordinates the keyboard event carries.
      expect(menu.style.top).not.toBe('400px');
      expect(menu.style.left).not.toBe('300px');
    });

    it('lets Shift + right-click through to the browser', () => {
      tile();
      const notPrevented = fireEvent.contextMenu(screen.getByTestId('name'), { shiftKey: true });
      expect(notPrevented).toBe(true);
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('leaves a link that is not the item’s own to the browser', () => {
      tile({ itemHref: '/decks/abc' });
      expect(fireEvent.contextMenu(screen.getByTestId('other-link'))).toBe(true);
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('adds Open in new tab and Copy link for an item that is a page, above Delete', () => {
      tile({ itemHref: '/decks/abc', itemName: 'Atraxa' });
      expect(fireEvent.contextMenu(screen.getByTestId('name'))).toBe(false);
      const labels = screen.getAllByRole('menuitem').map((el) => el.textContent);
      expect(labels).toEqual(['Rename', 'Open in new tab', 'Copy link', 'Delete deck']);
    });

    it('lets an inner item with its own menu answer first', () => {
      render(
        <div className="outer" data-testid="outer">
          <OverflowMenu
            ariaLabel="Outer"
            contextHost=".outer"
            items={[{ label: 'Outer item', onClick: () => {} }]}
          />
          <div className="inner" data-testid="inner">
            <OverflowMenu
              ariaLabel="Inner"
              contextHost=".inner"
              items={[{ label: 'Inner item', onClick: () => {} }]}
            />
          </div>
        </div>
      );
      fireEvent.contextMenu(screen.getByTestId('inner'), { clientX: 5, clientY: 5 });
      expect(screen.getByRole('menuitem', { name: 'Inner item' })).toBeTruthy();
      expect(screen.queryByRole('menuitem', { name: 'Outer item' })).toBeNull();
    });
  });

  describe('inside a selection', () => {
    const selected = (
      selection: { title: string; items: { label: string; onClick: () => void }[] } | null
    ) =>
      render(
        <div className="tile" data-testid="tile">
          <span data-testid="name">Atraxa</span>
          <OverflowMenu
            ariaLabel="Actions for Atraxa"
            contextHost=".tile"
            items={[{ label: 'Rename', onClick: () => {} }]}
            selection={selection}
          />
        </div>
      );

    it('opens the selection’s actions, titled with the count, on a right-click', () => {
      const onDelete = vi.fn();
      selected({
        title: '3 decks selected',
        items: [{ label: 'Delete selected', onClick: onDelete }],
      });
      fireEvent.contextMenu(screen.getByTestId('name'), { clientX: 5, clientY: 5 });
      expect(screen.getByRole('menu', { name: '3 decks selected' })).toBeTruthy();
      expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete selected' }));
      expect(onDelete).toHaveBeenCalledOnce();
    });

    it('keeps the ⋮ on the item’s own menu', () => {
      selected({
        title: '3 decks selected',
        items: [{ label: 'Delete selected', onClick: () => {} }],
      });
      fireEvent.click(screen.getByRole('button', { name: 'Actions for Atraxa' }));
      expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
      expect(screen.queryByRole('menuitem', { name: 'Delete selected' })).toBeNull();
    });

    it('opens the item’s own menu when the item is not in a selection', () => {
      selected(null);
      fireEvent.contextMenu(screen.getByTestId('name'), { clientX: 5, clientY: 5 });
      expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    });
  });
});
