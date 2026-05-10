// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ConfirmDialog renders a Modal that uses createPortal + useLockBodyScroll —
// the hook's logic is independent of the dialog markup, so stub it out and
// drive resolution through onConfirm / onCancel directly.
vi.mock('../components/ConfirmDialog', () => ({
  ConfirmDialog: (props: { onConfirm: () => void; onCancel: () => void; title: string }) => (
    <div data-testid="confirm" data-title={props.title}>
      <button data-testid="ok" onClick={props.onConfirm}>
        ok
      </button>
      <button data-testid="cancel" onClick={props.onCancel}>
        cancel
      </button>
    </div>
  ),
}));

import { useConfirm } from './use-confirm';

describe('useConfirm', () => {
  it('starts with no dialog rendered', () => {
    const { result } = renderHook(() => useConfirm());
    expect(result.current.dialog).toBeNull();
  });

  it('resolves true when the user confirms', async () => {
    const { result } = renderHook(() => useConfirm());
    let promise!: Promise<boolean>;
    act(() => {
      promise = result.current.confirm({ title: 'T', body: 'B' });
    });
    expect(result.current.dialog).not.toBeNull();
    // Pull onConfirm from the rendered dialog props
    const dialogEl = result.current.dialog as { props: { onConfirm: () => void } };
    act(() => {
      dialogEl.props.onConfirm();
    });
    await expect(promise).resolves.toBe(true);
    expect(result.current.dialog).toBeNull();
  });

  it('resolves false when the user cancels', async () => {
    const { result } = renderHook(() => useConfirm());
    let promise!: Promise<boolean>;
    act(() => {
      promise = result.current.confirm({ title: 'T', body: 'B', danger: true });
    });
    const dialogEl = result.current.dialog as { props: { onCancel: () => void } };
    act(() => {
      dialogEl.props.onCancel();
    });
    await expect(promise).resolves.toBe(false);
  });
});
