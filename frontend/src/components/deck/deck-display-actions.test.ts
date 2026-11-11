import { describe, it, expect, vi } from 'vitest';
import { buildBulkActions } from './deck-display-actions';

// A selection In the box moves out to the deck or a pile.
describe('buildBulkActions for In the box', () => {
  const actions = (hasSideboard: boolean, onBulkMove = vi.fn()) =>
    buildBulkActions({
      selection: { zone: 'extras', keys: new Set(['a', 'b']) },
      hasSideboard,
      onBulkMove,
      onBulkRemove: vi.fn(),
      setSelection: vi.fn(),
      setConfirmBulkRemove: vi.fn(),
    });

  it('offers the sideboard, Considering and the mainboard', () => {
    expect(actions(true).map((a) => a.key)).toEqual([
      'sideboard',
      'considering',
      'mainboard',
      'remove',
    ]);
    expect(actions(false).map((a) => a.key)).toEqual(['considering', 'mainboard', 'remove']);
  });

  it('moves the selection into the deck', () => {
    const onBulkMove = vi.fn();
    actions(true, onBulkMove)
      .find((a) => a.key === 'mainboard')!
      .run();
    expect(onBulkMove).toHaveBeenCalledWith(['a', 'b'], 'extras', 'cards');
  });

  it('moves the selection out of the box', () => {
    const onBulkMove = vi.fn();
    actions(true, onBulkMove)
      .find((a) => a.key === 'considering')!
      .run();
    expect(onBulkMove).toHaveBeenCalledWith(['a', 'b'], 'extras', 'considering');
  });
});

// A deck or pile selection goes into the box only on a deck that has one.
describe('buildBulkActions into the box', () => {
  const actions = (
    zone: 'sideboard' | 'considering' | 'cards',
    hasBox: boolean,
    onBulkMove = vi.fn()
  ) =>
    buildBulkActions({
      selection: { zone, keys: new Set(['a']) },
      hasSideboard: true,
      hasBox,
      onBulkMove,
      onBulkRemove: vi.fn(),
      setSelection: vi.fn(),
      setConfirmBulkRemove: vi.fn(),
    });

  it.each(['sideboard', 'considering', 'cards'] as const)(
    'moves a %s selection into the box',
    (zone) => {
      const onBulkMove = vi.fn();
      actions(zone, true, onBulkMove)
        .find((a) => a.key === 'box')!
        .run();
      expect(onBulkMove).toHaveBeenCalledWith(['a'], zone, 'extras');
    }
  );

  it('is absent without a box', () => {
    expect(actions('sideboard', false).map((a) => a.key)).not.toContain('box');
    expect(actions('cards', false).map((a) => a.key)).not.toContain('box');
  });
});
