// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLockBodyScroll } from './use-lock-body-scroll';

describe('useLockBodyScroll', () => {
  it('locks body overflow while active and restores on unmount', () => {
    document.body.style.overflow = 'auto';
    document.body.style.overscrollBehavior = 'auto';
    const { unmount } = renderHook(() => useLockBodyScroll(true));
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.overscrollBehavior).toBe('contain');
    unmount();
    expect(document.body.style.overflow).toBe('auto');
    expect(document.body.style.overscrollBehavior).toBe('auto');
  });

  it('does nothing when inactive', () => {
    document.body.style.overflow = 'auto';
    renderHook(() => useLockBodyScroll(false));
    expect(document.body.style.overflow).toBe('auto');
  });

  it('responds to active flips', () => {
    document.body.style.overflow = 'auto';
    const { rerender } = renderHook(({ active }) => useLockBodyScroll(active), {
      initialProps: { active: false },
    });
    expect(document.body.style.overflow).toBe('auto');
    rerender({ active: true });
    expect(document.body.style.overflow).toBe('hidden');
    rerender({ active: false });
    expect(document.body.style.overflow).toBe('auto');
  });
});
