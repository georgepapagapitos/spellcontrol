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

const labels = (menu: HTMLElement) =>
  [...menu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')].map(
    (el) => el.querySelector('span')?.textContent
  );

describe('HandCardMenu', () => {
  it('offers the three ways to play and closes after acting', () => {
    const p = renderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Play tapped' }));
    expect(p.onPlay).toHaveBeenCalledWith({ tapped: true });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Play face down' }));
    expect(p.onPlay).toHaveBeenCalledWith({ faceDown: true });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Play' }));
    expect(p.onPlay).toHaveBeenLastCalledWith();
    expect(p.onClose).toHaveBeenCalledTimes(3);
  });

  it('moves out of hand from Move to: every zone but the hand, then the command zone', () => {
    const p = renderMenu({ libraryCount: 30 });
    fireEvent.click(screen.getByRole('menuitem', { name: /^Move to/ }));
    expect(labels(screen.getByRole('menu', { name: 'Move to' }))).toEqual([
      'Graveyard',
      'Exile',
      'Library top',
      'Library bottom',
      'Library X from top',
      'Command zone',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Library top' }));
    expect(p.onMoveTo).toHaveBeenLastCalledWith('library', 0);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Move to/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Graveyard' }));
    expect(p.onMoveTo).toHaveBeenLastCalledWith('graveyard', undefined);
  });

  it('reveals to Everyone from a Reveal submenu, and says when it is on', () => {
    const onToggleReveal = vi.fn();
    renderMenu({ onToggleReveal, revealed: true });
    fireEvent.click(screen.getByRole('menuitem', { name: /^Reveal/ }));
    const everyone = screen.getByRole('menuitemcheckbox', { name: 'Everyone' });
    expect(everyone.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(everyone);
    expect(onToggleReveal).toHaveBeenCalled();
  });

  it('shows Preview only when the card resolves, and names the card as the menu', () => {
    renderMenu();
    expect(screen.queryByRole('menuitem', { name: 'View information' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Brainstorm' })).toBeTruthy();
    const onPreview = vi.fn();
    renderMenu({ onPreview, cardName: 'Ponder' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'View information' }));
    expect(onPreview).toHaveBeenCalled();
  });

  it('renders as a titled dialog sheet on narrow viewports', () => {
    renderMenu({ variant: 'sheet' });
    expect(screen.getByRole('dialog', { name: 'Brainstorm' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});

/**
 * A commander in the command zone: EDHPlay's list for it, where the
 * battlefield leads Move to (that is casting it) and none of the hand's own
 * rows appear.
 */
describe('HandCardMenu — a commander', () => {
  it('leads Move to with the battlefield, which casts it', () => {
    const p = renderMenu({ zone: 'command', cardName: 'Atraxa' });
    expect(screen.queryByRole('menuitem', { name: 'Play' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Play face down' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Move to/ }));
    const move = labels(screen.getByRole('menu', { name: 'Move to' }));
    expect(move[0]).toBe('Battlefield');
    expect(move).toContain('Hand');
    expect(move).not.toContain('Command zone');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Battlefield' }));
    expect(p.onPlay).toHaveBeenCalledWith();
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
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move it left' }));
    expect(onMove).toHaveBeenLastCalledWith(-1);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move it right' }));
    expect(onMove).toHaveBeenLastCalledWith(1);
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });

  it('offers nothing at the end it cannot move towards', () => {
    renderMenu({ onMove: vi.fn(), canMoveEarlier: false, canMoveLater: true });
    expect(screen.queryByRole('menuitem', { name: 'Move it left' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Move it right' })).toBeTruthy();
  });
});
