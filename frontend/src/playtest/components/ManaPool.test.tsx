// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ManaPool } from './ManaPool';
import { MANA_COLORS, type ManaColor } from '@/lib/playtest';

/**
 * The pip is one target doing two jobs, so each way in is its own guard: a
 * click that only adds, a right-click that only removes, and a keyboard path
 * that does both. Lose any one of them silently and the row still looks right
 * while half of it no longer works.
 */
function pool(overrides: Partial<Record<ManaColor, number>> = {}) {
  return MANA_COLORS.reduce(
    (acc, c) => ({ ...acc, [c]: overrides[c] ?? 0 }),
    {} as Record<ManaColor, number>
  );
}

function setup(overrides?: Partial<Record<ManaColor, number>>) {
  const onAdjust = vi.fn();
  const onEmpty = vi.fn();
  render(<ManaPool pool={pool(overrides)} onAdjust={onAdjust} onEmpty={onEmpty} />);
  return { onAdjust, onEmpty };
}

describe('ManaPool', () => {
  it('gives every color exactly one control, named with its current count', () => {
    setup({ W: 4 });
    expect(screen.getByRole('button', { name: 'White mana, 4 floating' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Blue mana, 0 floating' })).toBeTruthy();
    // Six colors plus Empty — no per-color +/- pair.
    expect(screen.getAllByRole('button')).toHaveLength(MANA_COLORS.length + 1);
  });

  it('adds on click and removes on right-click', () => {
    const { onAdjust } = setup({ R: 2 });
    const red = screen.getByRole('button', { name: 'Red mana, 2 floating' });

    fireEvent.click(red);
    expect(onAdjust).toHaveBeenCalledWith('R', 1);

    onAdjust.mockClear();
    fireEvent.contextMenu(red);
    expect(onAdjust).toHaveBeenCalledWith('R', -1);
  });

  it('never lets the OS menu eat the decrement', () => {
    setup();
    const green = screen.getByRole('button', { name: 'Green mana, 0 floating' });
    // `fireEvent` hands back false once a handler has called preventDefault.
    expect(fireEvent.contextMenu(green)).toBe(false);
  });

  it('adjusts both ways from the keyboard alone', () => {
    const { onAdjust } = setup();
    const white = screen.getByRole('button', { name: 'White mana, 0 floating' });

    for (const [key, delta] of [
      ['ArrowUp', 1],
      ['ArrowRight', 1],
      ['ArrowDown', -1],
      ['ArrowLeft', -1],
      ['-', -1],
      ['=', 1],
    ] as const) {
      onAdjust.mockClear();
      fireEvent.keyDown(white, { key });
      expect(onAdjust, key).toHaveBeenCalledWith('W', delta);
    }
  });

  it('leaves keys it does not own to the rest of the table', () => {
    const { onAdjust } = setup();
    const white = screen.getByRole('button', { name: 'White mana, 0 floating' });
    expect(fireEvent.keyDown(white, { key: 'd' })).toBe(true);
    expect(onAdjust).not.toHaveBeenCalled();
  });

  it('empties the pool on Empty, and offers it only when there is mana', () => {
    const { onEmpty } = setup({ B: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Empty' }));
    expect(onEmpty).toHaveBeenCalled();
  });

  it('disables Empty on an empty pool', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Empty' }).hasAttribute('disabled')).toBe(true);
  });
});
