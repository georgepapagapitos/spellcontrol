// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HandCardMenu } from './HandCardMenu';

function renderMenu(overrides: Partial<Parameters<typeof HandCardMenu>[0]> = {}) {
  const props = {
    x: 0,
    y: 0,
    cardName: 'Brainstorm',
    variant: 'floating' as const,
    onClose: vi.fn(),
    onPlay: vi.fn(),
    onMoveTo: vi.fn(),
    ...overrides,
  };
  render(<HandCardMenu {...props} />);
  return props;
}

describe('HandCardMenu', () => {
  it('offers the three ways to play and closes after acting', () => {
    const p = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Play tapped' }));
    expect(p.onPlay).toHaveBeenCalledWith({ tapped: true });
    fireEvent.click(screen.getByRole('button', { name: 'Play face down' }));
    expect(p.onPlay).toHaveBeenCalledWith({ faceDown: true });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(p.onPlay).toHaveBeenLastCalledWith();
    expect(p.onClose).toHaveBeenCalledTimes(3);
  });

  it('moves out of hand: discard, exile, top / bottom of library, command zone', () => {
    const p = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(p.onMoveTo).toHaveBeenLastCalledWith('graveyard');
    fireEvent.click(screen.getByRole('button', { name: 'Top of library' }));
    expect(p.onMoveTo).toHaveBeenLastCalledWith('library', 0);
    fireEvent.click(screen.getByRole('button', { name: 'Bottom of library' }));
    expect(p.onMoveTo).toHaveBeenLastCalledWith('library');
    fireEvent.click(screen.getByRole('button', { name: 'Exile' }));
    expect(p.onMoveTo).toHaveBeenLastCalledWith('exile');
    fireEvent.click(screen.getByRole('button', { name: 'Command zone' }));
    expect(p.onMoveTo).toHaveBeenLastCalledWith('command');
  });

  it('shows Preview only when the card resolves, and names the card as the menu', () => {
    renderMenu();
    expect(screen.queryByRole('button', { name: 'View information' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Brainstorm' })).toBeTruthy();
    const onPreview = vi.fn();
    renderMenu({ onPreview, cardName: 'Ponder' });
    fireEvent.click(screen.getByRole('button', { name: 'View information' }));
    expect(onPreview).toHaveBeenCalled();
  });

  it('renders as a titled dialog sheet on narrow viewports', () => {
    renderMenu({ variant: 'sheet' });
    expect(screen.getByRole('dialog', { name: 'Brainstorm' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});

/**
 * E348: arranging the hand is a drag, so it needs a path for a keyboard and
 * for a screen reader. These rows are it — and they disappear at the ends,
 * where the move would do nothing.
 */
describe('HandCardMenu — arranging the hand (E348)', () => {
  it('moves the card a place in either direction', () => {
    const onMove = vi.fn();
    const p = renderMenu({ onMove, canMoveEarlier: true, canMoveLater: true });
    fireEvent.click(screen.getByRole('button', { name: 'Move it left' }));
    expect(onMove).toHaveBeenLastCalledWith(-1);
    fireEvent.click(screen.getByRole('button', { name: 'Move it right' }));
    expect(onMove).toHaveBeenLastCalledWith(1);
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });

  it('offers nothing at the end it cannot move towards', () => {
    renderMenu({ onMove: vi.fn(), canMoveEarlier: false, canMoveLater: true });
    expect(screen.queryByRole('button', { name: 'Move it left' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Move it right' })).toBeTruthy();
  });

  it('says nothing about arranging when the caller does not offer it', () => {
    renderMenu();
    expect(screen.queryByText('Arrange')).toBeNull();
  });
});
