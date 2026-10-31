import { describe, it, expect, vi } from 'vitest';
import { buildBulkActions } from './deck-display-actions';

// A selection In the box moves out to a pile, never into the deck.
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

  it('offers the sideboard and Considering, not the mainboard', () => {
    expect(actions(true).map((a) => a.key)).toEqual(['sideboard', 'considering', 'remove']);
    expect(actions(false).map((a) => a.key)).toEqual(['considering', 'remove']);
  });

  it('moves the selection out of the box', () => {
    const onBulkMove = vi.fn();
    actions(true, onBulkMove)
      .find((a) => a.key === 'considering')!
      .run();
    expect(onBulkMove).toHaveBeenCalledWith(['a', 'b'], 'extras', 'considering');
  });
});
