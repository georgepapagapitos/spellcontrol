// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StackPanel, type StackPanelItem } from './StackPanel';

function item(over: Partial<StackPanelItem> & { id: string; name: string }): StackPanelItem {
  return { isToken: false, seat: 0, mine: true, ...over };
}

function renderPanel(items: StackPanelItem[]) {
  const onDrawArrow = vi.fn();
  const onCopy = vi.fn();
  const onResolve = vi.fn();
  render(
    <StackPanel items={items} onDrawArrow={onDrawArrow} onCopy={onCopy} onResolve={onResolve} />
  );
  return { onDrawArrow, onCopy, onResolve };
}

describe('StackPanel', () => {
  it('renders nothing on an empty stack — the normal state of a table', () => {
    const { container } = render(
      <StackPanel items={[]} onDrawArrow={vi.fn()} onCopy={vi.fn()} onResolve={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('counts the stack in its heading', () => {
    renderPanel([
      item({ id: 'a', name: 'Elrond' }),
      item({ id: 'b', name: 'Elvish Piper' }),
      item({ id: 'c', name: 'Sol Ring' }),
    ]);
    expect(screen.getByText('Stack (3)')).toBeTruthy();
  });

  // The last one put on is the top, and the only one anybody is about to
  // act on — so it is the one that opens out and carries the actions.
  it('acts on the TOP of the stack, which is the last entry', () => {
    const { onResolve, onCopy, onDrawArrow } = renderPanel([
      item({ id: 'bottom', name: 'Elrond' }),
      item({ id: 'top', name: 'Sol Ring' }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: /Resolve/ }));
    expect(onResolve).toHaveBeenCalledWith('top');
    fireEvent.click(screen.getByRole('button', { name: /Create copy/ }));
    expect(onCopy).toHaveBeenCalledWith('top');
    fireEvent.click(screen.getByRole('button', { name: /Draw arrow/ }));
    expect(onDrawArrow).toHaveBeenCalledWith('top');
  });

  it('prints the live key beside each action, so a rebound key never lies', () => {
    render(
      <StackPanel
        items={[item({ id: 'a', name: 'Sol Ring' })]}
        onDrawArrow={vi.fn()}
        onCopy={vi.fn()}
        onResolve={vi.fn()}
        copyKey="Shift K"
        resolveKey="R"
        arrowKey="W"
      />
    );
    expect(screen.getByRole('button', { name: 'Create copy (Shift K)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resolve (R)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Draw arrow (W)' })).toBeTruthy();
  });

  // You cannot resolve somebody else's spell, at this table or a real one.
  it('offers no actions when the top of the stack is not yours', () => {
    renderPanel([item({ id: 'x', name: 'Counterspell', mine: false, seatName: 'Maya', seat: 1 })]);
    expect(screen.queryByRole('button', { name: /Resolve/ })).toBeNull();
    expect(screen.getByText('Maya')).toBeTruthy();
  });

  it('names every seat, so a four-player stack is readable', () => {
    renderPanel([
      item({ id: 'a', name: 'Elrond', mine: false, seatName: 'Maya', seat: 1 }),
      item({ id: 'b', name: 'Sol Ring', seatName: 'You' }),
    ]);
    expect(screen.getByText('Maya')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
  });

  it('can be put away, and comes back when a new stack forms', () => {
    const { rerender } = render(
      <StackPanel
        items={[item({ id: 'a', name: 'Sol Ring' })]}
        onDrawArrow={vi.fn()}
        onCopy={vi.fn()}
        onResolve={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hide the stack panel' }));
    expect(screen.queryByText('Stack (1)')).toBeNull();

    // Still closed while that same stack is up…
    rerender(
      <StackPanel
        items={[item({ id: 'a', name: 'Sol Ring' }), item({ id: 'b', name: 'Elrond' })]}
        onDrawArrow={vi.fn()}
        onCopy={vi.fn()}
        onResolve={vi.fn()}
      />
    );
    expect(screen.queryByText('Stack (2)')).toBeNull();

    // …but a stack that empties and refills is a new thing to look at.
    rerender(<StackPanel items={[]} onDrawArrow={vi.fn()} onCopy={vi.fn()} onResolve={vi.fn()} />);
    rerender(
      <StackPanel
        items={[item({ id: 'c', name: 'Counterspell' })]}
        onDrawArrow={vi.fn()}
        onCopy={vi.fn()}
        onResolve={vi.fn()}
      />
    );
    expect(screen.getByText('Stack (1)')).toBeTruthy();
  });
});
