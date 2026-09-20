// @vitest-environment happy-dom
/**
 * B6-07: a battlefield permanent's context menu had no path to see the
 * card's full text. "Preview card" opens the shared CardPreview when the
 * caller can resolve a ScryfallCard for it (omitted otherwise).
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CardContextMenu } from './CardContextMenu';

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

describe('CardContextMenu — preview (B6-07)', () => {
  it('calls onPreview when provided', () => {
    const onPreview = vi.fn();
    render(<CardContextMenu {...baseProps()} onPreview={onPreview} />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview card' }));
    expect(onPreview).toHaveBeenCalledOnce();
  });

  it('omits the button when no preview is available', () => {
    render(<CardContextMenu {...baseProps()} />);
    expect(screen.queryByRole('button', { name: 'Preview card' })).toBeNull();
  });
});
