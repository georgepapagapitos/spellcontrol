// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

// Modal brings createPortal + body-scroll-lock; the haptic wiring under test
// lives entirely on the confirm button, so render children passthrough.
vi.mock('./Modal', () => ({
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { hapticsMock } = vi.hoisted(() => ({
  hapticsMock: {
    tap: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    lethal: vi.fn(),
    eliminate: vi.fn(),
  },
}));
vi.mock('../lib/haptics', () => ({ haptics: hapticsMock }));

import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog haptics', () => {
  beforeEach(() => {
    hapticsMock.warning.mockClear();
  });

  it('fires the warning cue on a danger confirm press', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="Delete deck?"
        body="Gone forever."
        confirmLabel="Delete"
        danger
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(hapticsMock.warning).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('stays silent on a benign confirm press', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="Reset cache?"
        body="Your data is kept."
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(hapticsMock.warning).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('stays silent on cancel, even for danger dialogs', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Delete deck?"
        body="Gone forever."
        danger
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(hapticsMock.warning).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
