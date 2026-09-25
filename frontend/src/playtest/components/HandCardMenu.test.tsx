// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HandCardMenu } from './HandCardMenu';

function renderMenu(overrides: Partial<Parameters<typeof HandCardMenu>[0]> = {}) {
  const props = {
    x: 0,
    y: 0,
    cardName: 'Brainstorm',
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
  // EDHPlay's hand menu has no Play row: the battlefield leads Move to, with
  // its A key. Face down stays on the root, as EDHPlay's Turn Face Down does.
  it('plays from Move to, tapped or not, and face down from the root', () => {
    const p = renderMenu();
    expect(screen.queryByRole('menuitem', { name: 'Play' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Play face down' }));
    expect(p.onPlay).toHaveBeenCalledWith({ faceDown: true });
    fireEvent.click(screen.getByRole('menuitem', { name: /^Move to/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Battlefield, tapped' }));
    expect(p.onPlay).toHaveBeenLastCalledWith({ tapped: true });
    fireEvent.click(screen.getByRole('menuitem', { name: /^Move to/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Battlefield$/ }));
    expect(p.onPlay).toHaveBeenLastCalledWith();
    expect(p.onClose).toHaveBeenCalledTimes(3);
  });

  it('moves out of hand from Move to, in EDHPlay’s order', () => {
    const p = renderMenu({ libraryCount: 30 });
    fireEvent.click(screen.getByRole('menuitem', { name: /^Move to/ }));
    expect(labels(screen.getByRole('menu', { name: 'Move to' }))).toEqual([
      'Battlefield',
      'Battlefield, tapped',
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

  // EDHPlay lists the tokens THIS card makes (Tireless Provisioner: Food,
  // Treasure). A card that makes none has no row, not an empty submenu.
  it('creates the tokens this card makes, and offers nothing for a card that makes none', () => {
    const onCreateToken = vi.fn();
    const food = { name: 'Food', typeLine: 'Token Artifact — Food' };
    const treasure = { name: 'Treasure', typeLine: 'Token Artifact — Treasure' };
    const { unmount } = render(
      <HandCardMenu
        x={0}
        y={0}
        cardName="Tireless Provisioner"
        onClose={vi.fn()}
        onPlay={vi.fn()}
        onMoveTo={vi.fn()}
        tokens={[food, treasure]}
        onCreateToken={onCreateToken}
      />
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /^Create token/ }));
    expect(labels(screen.getByRole('menu', { name: 'Create token' }))).toEqual([
      'Food',
      'Treasure',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Treasure' }));
    expect(onCreateToken).toHaveBeenCalledWith(treasure);
    unmount();

    renderMenu({ tokens: [], onCreateToken });
    expect(screen.queryByRole('menuitem', { name: /^Create token/ })).toBeNull();
  });

  it('tells two tokens with one name apart by their type line', () => {
    renderMenu({
      tokens: [
        { name: 'Soldier', typeLine: 'Token Creature — Soldier' },
        { name: 'Soldier', typeLine: 'Token Artifact Creature — Soldier' },
      ],
      onCreateToken: vi.fn(),
    });
    fireEvent.click(screen.getByRole('menuitem', { name: /^Create token/ }));
    expect(labels(screen.getByRole('menu', { name: 'Create token' }))).toEqual([
      'Soldier (Creature — Soldier)',
      'Soldier (Artifact Creature — Soldier)',
    ]);
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
