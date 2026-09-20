// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShortcutsSheet } from './ShortcutsSheet';
import type { ShortcutOverrides } from '../lib/shortcuts';

function renderSheet(overrides: ShortcutOverrides = {}) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(<ShortcutsSheet overrides={overrides} onChange={onChange} onClose={onClose} />);
  return { onChange, onClose };
}

describe('ShortcutsSheet', () => {
  it('lists every shortcut with its key, in named groups', () => {
    renderSheet();
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    expect(screen.getByText('Your turn')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Draw a card: D. Change' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pass turn \(online\): Space/ })).toBeTruthy();
  });

  it('rebinds on the next key press and says so', () => {
    const { onChange } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Draw a card: D. Change' }));
    expect(screen.getByRole('button', { name: /Draw a card: press a key/ })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'y' });
    expect(onChange).toHaveBeenCalledWith({ draw: 'y' });
    expect(screen.getByRole('status').textContent).toBe('Y is now Draw a card.');
  });

  it('Esc cancels a rebind without closing the sheet', () => {
    const { onChange, onClose } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Draw a card: D. Change' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Draw a card: D. Change' })).toBeTruthy();
  });

  it('names the shortcut that a taken key moves off', () => {
    const { onChange } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle library: S. Change' }));
    fireEvent.keyDown(window, { key: 'd' });
    expect(onChange).toHaveBeenCalledWith({ shuffle: 'd', draw: '' });
    expect(screen.getByRole('status').textContent).toBe(
      'D is now Shuffle library. Draw a card is off.'
    );
  });

  it('Backspace turns an optional shortcut off, and refuses on a required one', () => {
    const { onChange } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /Look at player 1/ }));
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith({ 'focus-1': '' });

    onChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Draw a card: D. Change' }));
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toMatch(/always needs a key/);
  });

  it('shows an override and resets everything in one tap', () => {
    const { onChange } = renderSheet({ draw: 'j' });
    expect(screen.getByRole('button', { name: 'Draw a card: J. Change' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(onChange).toHaveBeenCalledWith({});
  });
});
