// @vitest-environment happy-dom
/**
 * B6-07: a battlefield permanent's context menu had no path to see the
 * card's full text. "View information" opens the shared CardPreview when the
 * caller can resolve a ScryfallCard for it (omitted otherwise).
 *
 * E346, then the EDHPlay pass (2026-09-23): the menu is EDHPlay's short
 * grouped list, with the steppers, pickers and text fields one submenu down.
 * The guards below pin that shape — the root order and its groups, the
 * submenus' contents, and a key printed on every row that has one. A future
 * "just one more row at the root" regresses the thing the user asked for, so
 * the root order is pinned exactly rather than capped.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CardContextMenu } from './CardContextMenu';
import type { ShortcutId } from '../lib/shortcuts';

function baseProps() {
  return {
    x: 0,
    y: 0,
    cardName: 'Sol Ring',
    stickers: [],
    counters: {},
    attachTargets: [],
    onAttach: vi.fn(),
    onClose: vi.fn(),
    onTap: vi.fn(),
    onAddCounter: vi.fn(),
    onRemoveCounter: vi.fn(),
    onAddSticker: vi.fn(),
    onRemoveSticker: vi.fn(),
    onFlip: vi.fn(),
    onTransform: vi.fn(),
    onTogglePhased: vi.fn(),
    onDuplicate: vi.fn(),
    onAdjustPT: vi.fn(),
    onPutOnStack: vi.fn(),
    onMoveTo: vi.fn(),
  };
}

const KEYS: Partial<Record<ShortcutId, string>> = {
  'tap-selection': 'T',
  counters: 'J',
  'face-down': 'Z',
  transform: 'F',
  clone: 'X',
  arrow: 'W',
  'stack-add': 'K',
  'to-graveyard': 'G',
  'counters-all-inc': 'Ctrl 1',
};
const keyFor = (id: ShortcutId) => KEYS[id];

/** The root menu's rows and lines, top to bottom, as `row` / `—`. */
function rootShape(): string[] {
  const root = screen.getByRole('menu', { name: 'Sol Ring' });
  return [...root.querySelectorAll('[data-menu-panel="0"] > [role]')].map((el) =>
    el.getAttribute('role') === 'separator' ? '—' : (el.querySelector('span')?.textContent ?? '')
  );
}

describe('CardContextMenu — preview (B6-07)', () => {
  it('calls onPreview when provided', () => {
    const onPreview = vi.fn();
    render(<CardContextMenu {...baseProps()} onPreview={onPreview} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'View information' }));
    expect(onPreview).toHaveBeenCalledOnce();
  });

  it('omits the row when no preview is available', () => {
    render(<CardContextMenu {...baseProps()} />);
    expect(screen.queryByRole('menuitem', { name: 'View information' })).toBeNull();
  });
});

describe('CardContextMenu — EDHPlay’s shape', () => {
  it('opens on EDHPlay’s grouped list, with ours last under More', () => {
    render(
      <CardContextMenu {...baseProps()} canTransform onDrawArrow={vi.fn()} onPreview={vi.fn()} />
    );
    expect(rootShape()).toEqual([
      'Tap',
      '—',
      'Counters',
      'Power / toughness',
      '—',
      'Move to',
      '—',
      'Flip',
      'Turn face down',
      '—',
      'Make a token copy',
      'Draw an arrow',
      'Add to the stack',
      '—',
      'View information',
      '—',
      'More',
    ]);
    // Nothing that takes typing or stepping sits on the root.
    expect(screen.queryByLabelText('Counter name')).toBeNull();
    expect(screen.queryByLabelText('Sticker text')).toBeNull();
  });

  it('puts Create token beside the token copy, only for a card that makes tokens', () => {
    const onCreateToken = vi.fn();
    render(
      <CardContextMenu
        {...baseProps()}
        tokens={[{ name: 'Treasure', typeLine: 'Token Artifact — Treasure' }]}
        onCreateToken={onCreateToken}
      />
    );
    const shape = rootShape();
    expect(shape.indexOf('Create token')).toBe(shape.indexOf('Make a token copy') + 1);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Create token/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Treasure' }));
    expect(onCreateToken).toHaveBeenCalledWith({
      name: 'Treasure',
      typeLine: 'Token Artifact — Treasure',
    });
  });

  it('offers Flip only on a two-faced card', () => {
    render(<CardContextMenu {...baseProps()} />);
    expect(screen.queryByRole('menuitem', { name: /^Flip/ })).toBeNull();
  });

  it('prints the live key on the rows that have one', () => {
    render(<CardContextMenu {...baseProps()} canTransform onDrawArrow={vi.fn()} keyFor={keyFor} />);
    const key = (name: RegExp) =>
      screen.getByRole('menuitem', { name }).querySelector('kbd')?.textContent;
    expect(key(/^Tap/)).toBe('T');
    expect(key(/^Counters/)).toBe('J');
    expect(key(/^Flip/)).toBe('F');
    expect(key(/^Turn face down/)).toBe('Z');
    expect(key(/token copy/)).toBe('X');
    expect(key(/^Draw an arrow/)).toBe('W');
    expect(key(/^Add to the stack/)).toBe('K');
  });

  it('opens Counters beside the menu and leaves the root where it was', () => {
    render(<CardContextMenu {...baseProps()} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Counters/ }));
    expect(screen.getByLabelText('Counter name')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^Tap/ })).toBeTruthy();
  });

  it('opens straight on Counters when the caller asks (the J key)', () => {
    render(<CardContextMenu {...baseProps()} initialPage="counters" />);
    expect(screen.getByLabelText('Counter name')).toBeTruthy();
  });

  it('keeps the bulk counter rows in place, off on a card with none', () => {
    const props = baseProps();
    const { unmount } = render(
      <CardContextMenu {...props} onAdjustAllCounters={vi.fn()} initialPage="counters" />
    );
    for (const name of [/^Add one to each/, /^Take one off each/, /^Double each/, /^Remove every/])
      expect((screen.getByRole('menuitem', { name }) as HTMLButtonElement).disabled).toBe(true);
    unmount();

    const onAdjustAllCounters = vi.fn();
    render(
      <CardContextMenu
        {...props}
        counters={{ '+1/+1': 2 }}
        onAdjustAllCounters={onAdjustAllCounters}
        keyFor={keyFor}
        initialPage="counters"
      />
    );
    expect(screen.getByRole('menuitem', { name: /^Add one to each/ }).textContent).toContain(
      'Ctrl 1'
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /^Double each/ }));
    expect(onAdjustAllCounters).toHaveBeenCalledWith('double');
  });

  it('removes every counter from EDHPlay’s reset row', () => {
    const onAdjustAllCounters = vi.fn();
    render(
      <CardContextMenu
        {...baseProps()}
        counters={{ charge: 3 }}
        onAdjustAllCounters={onAdjustAllCounters}
        initialPage="counters"
      />
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove every counter' }));
    expect(onAdjustAllCounters).toHaveBeenCalledWith('clear');
  });

  it('steps power from the power / toughness submenu', () => {
    const props = baseProps();
    render(<CardContextMenu {...props} pt={{ power: 1, toughness: 0 }} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Power \/ toughness/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Power up, currently \+1/ }));
    expect(props.onAdjustPT).toHaveBeenCalledWith(1, 0);
  });

  // "Set" is absolute and the card stores a modifier, so the step it sends is
  // the difference from what the card reads now, printed body included.
  it('sets power and toughness to the numbers typed, from the printed body', () => {
    const props = baseProps();
    render(
      <CardContextMenu
        {...props}
        printedPt={{ power: 2, toughness: 2 }}
        pt={{ power: 1, toughness: 1 }}
      />
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /^Power \/ toughness/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Set power \/ toughness/ }));
    expect((screen.getByLabelText('Power') as HTMLInputElement).value).toBe('3');
    fireEvent.change(screen.getByLabelText('Power'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Toughness'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set to 0/1' }));
    expect(props.onAdjustPT).toHaveBeenCalledWith(-3, -2);
  });

  it('offers no Set on a card with no printed number to set from', () => {
    render(<CardContextMenu {...baseProps()} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Power \/ toughness/ }));
    expect(screen.queryByRole('menuitem', { name: /^Set power/ })).toBeNull();
  });

  it('puts the card back at its printed size, and only when it is pumped', () => {
    const props = baseProps();
    const { unmount } = render(<CardContextMenu {...props} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Power \/ toughness/ }));
    const reset = screen.getByRole('menuitem', { name: 'Back to printed size' });
    expect((reset as HTMLButtonElement).disabled).toBe(true);
    unmount();

    render(<CardContextMenu {...props} pt={{ power: 2, toughness: -1 }} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Power \/ toughness/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Back to printed size' }));
    expect(props.onAdjustPT).toHaveBeenCalledWith(-2, 1);
  });

  it('moves the card from Move to, key and all', () => {
    const props = baseProps();
    render(<CardContextMenu {...props} keyFor={keyFor} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Move to/ }));
    const graveyard = screen.getByRole('menuitem', { name: /^Graveyard/ });
    expect(graveyard.textContent).toContain('G');
    fireEvent.click(graveyard);
    expect(props.onMoveTo).toHaveBeenCalledWith('graveyard', undefined);
  });

  it('keeps phasing, copying onto the stack, attaching and stickers under More', () => {
    const props = baseProps();
    render(<CardContextMenu {...props} attachTargets={[{ id: 'a', name: 'Bear' }]} />);
    expect(screen.queryByRole('menuitem', { name: 'Phase out' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: /^More/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Copy onto the stack/ }));
    expect(props.onPutOnStack).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Attach to/ }));
    expect(screen.getByLabelText('Attach Sol Ring to')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Stickers/ }));
    expect(screen.getByLabelText('Sticker text')).toBeTruthy();
  });

  it('offers the arrow only when the caller is at an online table', () => {
    const { unmount } = render(<CardContextMenu {...baseProps()} />);
    expect(screen.queryByRole('menuitem', { name: /^Draw an arrow/ })).toBeNull();
    unmount();

    const onDrawArrow = vi.fn();
    render(<CardContextMenu {...baseProps()} onDrawArrow={onDrawArrow} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Draw an arrow/ }));
    expect(onDrawArrow).toHaveBeenCalledOnce();
  });
});

/**
 * Top and bottom are the two ends of the library; this is everywhere between
 * them. The count says the RESULT ("under 3 cards") rather than an index,
 * because "3 from the top" reads as either the third card or the fourth
 * depending on who you ask — and a card buried in the wrong slot stays
 * invisible until it is drawn.
 */
describe('CardContextMenu — Library X from top', () => {
  function openMove(extra: Record<string, unknown> = {}) {
    const onMoveTo = vi.fn();
    render(<CardContextMenu {...baseProps()} onMoveTo={onMoveTo} {...extra} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Move to/ }));
    return { onMoveTo };
  }

  it('buries the card under the chosen number of cards', () => {
    const { onMoveTo } = openMove({ libraryCount: 40 });
    fireEvent.click(screen.getByRole('menuitem', { name: /^Library X from top/ }));

    // Opens at 1: the position the Top and Bottom rows do not already cover.
    expect(screen.getByRole('button', { name: 'Put it under 1 card' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'One more' }));
    fireEvent.click(screen.getByRole('button', { name: 'Put it under 2 cards' }));
    expect(onMoveTo).toHaveBeenCalledWith('library', 2);
  });

  it('cannot bury a card deeper than the library is', () => {
    openMove({ libraryCount: 2 });
    fireEvent.click(screen.getByRole('menuitem', { name: /^Library X from top/ }));
    const more = screen.getByRole('button', { name: 'One more' });
    fireEvent.click(more);
    expect(screen.getByRole('button', { name: 'Put it under 2 cards' })).toBeTruthy();
    expect((more as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers no such row without a library count to cap it', () => {
    openMove();
    expect(screen.queryByRole('menuitem', { name: /X from top/ })).toBeNull();
  });

  it('sits in EDHPlay’s order: the zones, both ends, then between them', () => {
    openMove({ libraryCount: 40 });
    const move = screen.getByRole('menu', { name: 'Move to' });
    expect(
      [...move.querySelectorAll('[role="menuitem"]')].map(
        (el) => el.querySelector('span')?.textContent
      )
    ).toEqual([
      'Hand',
      'Graveyard',
      'Exile',
      'Library top',
      'Library bottom',
      'Library X from top',
      'Command zone',
    ]);
  });
});
