// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InlineRename } from './InlineRename';

describe('InlineRename', () => {
  it('rests as a named button and opens an input pre-filled and selected on click', () => {
    render(
      <InlineRename
        value="My deck"
        onCommit={vi.fn()}
        label="Deck name"
        renameLabel="Rename deck"
      />
    );
    const btn = screen.getByRole('button', { name: 'Rename deck' });
    expect(btn.textContent).toBe('My deck');
    fireEvent.click(btn);
    const input = screen.getByLabelText('Deck name') as HTMLInputElement;
    expect(input.value).toBe('My deck');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('My deck'.length);
  });

  it('Enter saves a changed, non-empty value', async () => {
    const onCommit = vi.fn();
    render(
      <InlineRename
        value="My deck"
        onCommit={onCommit}
        label="Deck name"
        renameLabel="Rename deck"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rename deck' }));
    const input = screen.getByLabelText('Deck name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'New name' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith('New name'));
    // Back to resting, once the commit settles (a loaded run lags a tick).
    await waitFor(() => expect(screen.queryByLabelText('Deck name')).toBeNull());
  });

  it('blur saves a changed, non-empty value', async () => {
    const onCommit = vi.fn();
    render(
      <div>
        <InlineRename
          value="My deck"
          onCommit={onCommit}
          label="Deck name"
          renameLabel="Rename deck"
        />
        <button>elsewhere</button>
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rename deck' }));
    const input = screen.getByLabelText('Deck name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'New name' } });
    fireEvent.blur(input, { relatedTarget: screen.getByText('elsewhere') });
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith('New name'));
  });

  it('Escape reverts the draft and returns focus to the name', async () => {
    const onCommit = vi.fn();
    render(
      <InlineRename
        value="My deck"
        onCommit={onCommit}
        label="Deck name"
        renameLabel="Rename deck"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rename deck' }));
    const input = screen.getByLabelText('Deck name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCommit).not.toHaveBeenCalled();
    const btn = await screen.findByRole('button', { name: 'Rename deck' });
    expect(btn.textContent).toBe('My deck');
    await waitFor(() => expect(document.activeElement).toBe(btn));
  });

  it('an empty value reverts without saving', async () => {
    const onCommit = vi.fn();
    render(
      <InlineRename
        value="My deck"
        onCommit={onCommit}
        label="Deck name"
        renameLabel="Rename deck"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rename deck' }));
    const input = screen.getByLabelText('Deck name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Rename deck' }).textContent).toBe('My deck');
  });

  it('an unchanged value reverts without saving', () => {
    const onCommit = vi.fn();
    render(
      <InlineRename
        value="My deck"
        onCommit={onCommit}
        label="Deck name"
        renameLabel="Rename deck"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rename deck' }));
    const input = screen.getByLabelText('Deck name') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('trims surrounding whitespace before committing', async () => {
    const onCommit = vi.fn();
    render(
      <InlineRename
        value="My deck"
        onCommit={onCommit}
        label="Deck name"
        renameLabel="Rename deck"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rename deck' }));
    const input = screen.getByLabelText('Deck name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  New name  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith('New name'));
  });

  it('respects maxLength', () => {
    render(
      <InlineRename
        value="My deck"
        onCommit={vi.fn()}
        label="Deck name"
        renameLabel="Rename deck"
        maxLength={10}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rename deck' }));
    const input = screen.getByLabelText('Deck name') as HTMLInputElement;
    expect(input.maxLength).toBe(10);
  });

  it('stays open and lets the caller surface a failed commit', async () => {
    const onCommit = vi.fn().mockRejectedValue(new Error('network'));
    render(
      <InlineRename
        value="My deck"
        onCommit={onCommit}
        label="Deck name"
        renameLabel="Rename deck"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rename deck' }));
    const input = screen.getByLabelText('Deck name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'New name' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    // Still editing: the input is still there for a retry or an Escape.
    expect(screen.getByLabelText('Deck name')).not.toBeNull();
  });

  it('renders extra editing-only content (e.g. a companion color picker)', () => {
    render(
      <InlineRename value="My deck" onCommit={vi.fn()} label="Deck name" renameLabel="Rename deck">
        <span>Color picker</span>
      </InlineRename>
    );
    expect(screen.queryByText('Color picker')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rename deck' }));
    expect(screen.getByText('Color picker')).not.toBeNull();
  });

  it('a doneLabel renders an explicit save trigger that commits', async () => {
    const onCommit = vi.fn();
    render(
      <InlineRename
        value="My deck"
        onCommit={onCommit}
        label="Deck name"
        renameLabel="Rename deck"
        doneLabel="Done"
      >
        <span>Color picker</span>
      </InlineRename>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rename deck' }));
    const input = screen.getByLabelText('Deck name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'New name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith('New name'));
  });

  it('supports controlled editing so a caller (a menu item) can open it', () => {
    const onEditingChange = vi.fn();
    const { rerender } = render(
      <InlineRename
        value="My deck"
        onCommit={vi.fn()}
        label="Deck name"
        renameLabel="Rename deck"
        editing={false}
        onEditingChange={onEditingChange}
      />
    );
    expect(screen.queryByLabelText('Deck name')).toBeNull();
    rerender(
      <InlineRename
        value="My deck"
        onCommit={vi.fn()}
        label="Deck name"
        renameLabel="Rename deck"
        editing
        onEditingChange={onEditingChange}
      />
    );
    expect(screen.getByLabelText('Deck name')).not.toBeNull();
  });
});
