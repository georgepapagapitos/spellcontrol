// @vitest-environment happy-dom
/**
 * B6-07: a battlefield permanent's context menu had no path to see the
 * card's full text. "View information" opens the shared CardPreview when the
 * caller can resolve a ScryfallCard for it (omitted otherwise).
 *
 * E346: the menu is a short action list with drill-down pages, not one
 * scrolling panel. The guards below pin the shape the restructure bought —
 * the root list stays short, the steppers/pickers/text fields live one page
 * down, every page comes back, and a row that has a key prints it. A future
 * "just one more row at the root" regresses the thing the user asked for, so
 * ROOT_MAX_ROWS fails rather than drifting.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CardContextMenu } from './CardContextMenu';
import type { ShortcutId } from '../lib/shortcuts';

/** The root list is the whole point of E346: one glance, no scrolling. */
const ROOT_MAX_ROWS = 11;

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
  clone: 'X',
  'stack-add': 'K',
  'to-graveyard': 'G',
};
const keyFor = (id: ShortcutId) => KEYS[id];

describe('CardContextMenu — preview (B6-07)', () => {
  it('calls onPreview when provided', () => {
    const onPreview = vi.fn();
    render(<CardContextMenu {...baseProps()} onPreview={onPreview} />);
    fireEvent.click(screen.getByRole('button', { name: 'View information' }));
    expect(onPreview).toHaveBeenCalledOnce();
  });

  it('omits the button when no preview is available', () => {
    render(<CardContextMenu {...baseProps()} />);
    expect(screen.queryByRole('button', { name: 'View information' })).toBeNull();
  });
});

describe('CardContextMenu — submenu shape (E346)', () => {
  it('opens on a short root list, with no stepper or text field in sight', () => {
    render(<CardContextMenu {...baseProps()} onPreview={vi.fn()} />);
    expect(screen.getAllByRole('button').length).toBeLessThanOrEqual(ROOT_MAX_ROWS);
    expect(screen.queryByLabelText('Counter name')).toBeNull();
    expect(screen.queryByLabelText('Sticker text')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('prints the live key on the rows that have one', () => {
    render(<CardContextMenu {...baseProps()} keyFor={keyFor} />);
    expect(screen.getByRole('button', { name: /^Tap/ }).textContent).toContain('T');
    expect(screen.getByRole('button', { name: /^Counters/ }).textContent).toContain('J');
    expect(screen.getByRole('button', { name: /token copy/ }).textContent).toContain('X');
  });

  it('drills into Counters and back out again', () => {
    render(<CardContextMenu {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Counters/ }));
    expect(screen.getByLabelText('Counter name')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Sol Ring' }));
    expect(screen.queryByLabelText('Counter name')).toBeNull();
    expect(screen.getByRole('button', { name: /^Tap/ })).toBeTruthy();
  });

  it('steps power from the power/toughness page', () => {
    const props = baseProps();
    render(<CardContextMenu {...props} pt={{ power: 1, toughness: 0 }} />);
    fireEvent.click(screen.getByRole('button', { name: /^Power \/ toughness/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Power up, currently \+1/ }));
    expect(props.onAdjustPT).toHaveBeenCalledWith(1, 0);
  });

  it('moves the card from the Move to page, key and all', () => {
    const props = baseProps();
    render(<CardContextMenu {...props} keyFor={keyFor} />);
    fireEvent.click(screen.getByRole('button', { name: /^Move to/ }));
    const graveyard = screen.getByRole('button', { name: /^Graveyard/ });
    expect(graveyard.textContent).toContain('G');
    fireEvent.click(graveyard);
    expect(props.onMoveTo).toHaveBeenCalledWith('graveyard', undefined);
  });

  it('keeps the rarely-wanted actions on the More page', () => {
    const props = baseProps();
    render(<CardContextMenu {...props} canTransform attachTargets={[{ id: 'a', name: 'Bear' }]} />);
    expect(screen.queryByRole('button', { name: 'Transform' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^More/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Transform' }));
    expect(props.onTransform).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Sticker text')).toBeTruthy();
    expect(screen.getByLabelText('Attach Sol Ring to')).toBeTruthy();
  });

  it('opens straight on a page when the caller asks for one (the J key)', () => {
    render(<CardContextMenu {...baseProps()} initialPage="counters" />);
    expect(screen.getByLabelText('Counter name')).toBeTruthy();
  });

  it('offers the bulk counter steps only on a card that has counters', () => {
    const props = baseProps();
    const { unmount } = render(
      <CardContextMenu {...props} onAdjustAllCounters={vi.fn()} initialPage="counters" />
    );
    expect(screen.queryByRole('button', { name: 'Add one to each' })).toBeNull();
    unmount();

    const onAdjustAllCounters = vi.fn();
    render(
      <CardContextMenu
        {...props}
        counters={{ '+1/+1': 2 }}
        onAdjustAllCounters={onAdjustAllCounters}
        initialPage="counters"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Double each' }));
    expect(onAdjustAllCounters).toHaveBeenCalledWith('double');
  });

  it('offers the arrow only when the caller is at an online table', () => {
    const { unmount } = render(<CardContextMenu {...baseProps()} />);
    expect(screen.queryByRole('button', { name: /^Draw an arrow/ })).toBeNull();
    unmount();

    const onDrawArrow = vi.fn();
    render(<CardContextMenu {...baseProps()} onDrawArrow={onDrawArrow} />);
    fireEvent.click(screen.getByRole('button', { name: /^Draw an arrow/ }));
    expect(onDrawArrow).toHaveBeenCalledOnce();
  });
});
