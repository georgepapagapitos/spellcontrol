// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeckTagManager } from './DeckTagManager';

describe('DeckTagManager', () => {
  it('renames a tag in place: click the name, edit, Enter saves', async () => {
    const onRename = vi.fn();
    render(
      <DeckTagManager
        tags={[{ tag: 'combo', count: 3 }]}
        onRename={onRename}
        onRemove={vi.fn()}
        onDone={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Rename "combo"' }));
    const input = screen.getByLabelText('Rename tag "combo"');
    fireEvent.change(input, { target: { value: 'win con' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onRename).toHaveBeenCalledWith('combo', 'win con'));
  });

  it('Escape reverts without renaming', () => {
    const onRename = vi.fn();
    render(
      <DeckTagManager
        tags={[{ tag: 'combo', count: 3 }]}
        onRename={onRename}
        onRemove={vi.fn()}
        onDone={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Rename "combo"' }));
    const input = screen.getByLabelText('Rename tag "combo"');
    fireEvent.change(input, { target: { value: 'discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Rename "combo"' }).textContent).toContain('combo');
  });

  it('with no onRename renders a plain, non-interactive name', () => {
    render(
      <DeckTagManager tags={[{ tag: 'combo', count: 3 }]} onRemove={vi.fn()} onDone={vi.fn()} />
    );
    expect(screen.queryByRole('button', { name: /rename/i })).toBeNull();
    expect(screen.getByText('combo')).toBeTruthy();
  });

  it('remove stays a separate action from rename', () => {
    const onRemove = vi.fn();
    render(
      <DeckTagManager
        tags={[{ tag: 'combo', count: 3 }]}
        onRename={vi.fn()}
        onRemove={onRemove}
        onDone={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove "combo" from every card' }));
    expect(onRemove).toHaveBeenCalledWith('combo');
  });
});
