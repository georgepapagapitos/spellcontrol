// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CardShareDialog } from './CardShareDialog';

const writeText = vi.fn(async () => {});

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});

function open(onClose = vi.fn()) {
  render(<CardShareDialog name="Sol Ring" imageUrl="https://img/sol-ring.jpg" onClose={onClose} />);
  return onClose;
}

describe('CardShareDialog', () => {
  it('copies the image link and closes', async () => {
    const onClose = open();
    fireEvent.click(screen.getByRole('button', { name: /Copy image link/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://img/sol-ring.jpg'));
    expect(onClose).toHaveBeenCalled();
  });

  it('layers above the card preview it opens over', () => {
    // Sibling of .card-preview-backdrop (--z-overlay) in the DOM, so a plain
    // --z-modal backdrop would render it behind the preview, uninteractable.
    open();
    expect(document.querySelector('.modal-backdrop--over-sheet')).not.toBeNull();
  });

  it('names the download after the card', () => {
    open();
    expect(screen.getByText('Downloads sol-ring.jpg')).toBeTruthy();
  });

  it('hides Copy image where the browser cannot write images to the clipboard', () => {
    // No ClipboardItem (older Firefox) — offering a dead action is worse than
    // not offering it.
    const original = globalThis.ClipboardItem;
    // @ts-expect-error — deleting an optional global for the test
    delete globalThis.ClipboardItem;
    open();
    expect(screen.queryByRole('button', { name: /Copy image$/ })).toBeNull();
    globalThis.ClipboardItem = original;
  });
});
