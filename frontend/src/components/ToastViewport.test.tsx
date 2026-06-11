// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastViewport } from './ToastViewport';
import { useToastsStore } from '../store/toasts';

/** Stub window.matchMedia so the reduced-motion branch is controllable. */
function setReducedMotion(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduce') ? reduced : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function push(input: Parameters<ReturnType<typeof useToastsStore.getState>['push']>[0]): string {
  let id = '';
  act(() => {
    id = useToastsStore.getState().push(input);
  });
  return id;
}

/** Dispatch the end of the `toast-leave` keyframe on a toast <li>. */
function endLeave(el: Element) {
  const ev = new Event('animationend', { bubbles: true }) as Event & { animationName: string };
  ev.animationName = 'toast-leave';
  act(() => {
    el.dispatchEvent(ev);
  });
}

function toastElements(): HTMLElement[] {
  return screen.queryAllByRole('status');
}

beforeEach(() => {
  setReducedMotion(false);
  useToastsStore.setState({ toasts: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ToastViewport', () => {
  it('renders pushed toasts', () => {
    render(<ToastViewport />);
    push({ message: 'saved' });
    push({ message: 'synced', tone: 'success' });

    expect(screen.getByText('saved')).toBeDefined();
    expect(screen.getByText('synced').closest('li')?.className).toContain('toast-success');
    expect(toastElements()).toHaveLength(2);
  });

  it('manual ✕: keeps the toast as a leaving ghost until toast-leave ends', () => {
    render(<ToastViewport />);
    push({ message: 'bye' });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    // Store row is gone, but the ghost is still rendered, marked leaving.
    expect(useToastsStore.getState().toasts).toHaveLength(0);
    const ghost = screen.getByText('bye').closest('li')!;
    expect(ghost.className).toContain('is-leaving');

    endLeave(ghost);
    expect(toastElements()).toHaveLength(0);
  });

  it('only the leave keyframe unmounts — the enter slide-in ending is ignored', () => {
    render(<ToastViewport />);
    push({ message: 'stay' });

    const el = screen.getByText('stay').closest('li')!;
    const ev = new Event('animationend', { bubbles: true }) as Event & { animationName: string };
    ev.animationName = 'toast-slide-in';
    act(() => {
      el.dispatchEvent(ev);
    });
    expect(toastElements()).toHaveLength(1);
  });

  it('timeout expiry dismisses through the same leave path', () => {
    vi.useFakeTimers();
    render(<ToastViewport />);
    push({ message: 'auto', durationMs: 5000 });

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    const ghost = screen.getByText('auto').closest('li')!;
    expect(ghost.className).toContain('is-leaving');
    expect(useToastsStore.getState().toasts).toHaveLength(0);

    endLeave(ghost);
    expect(toastElements()).toHaveLength(0);
  });

  it('a leaving ghost does not re-arm its auto-dismiss timer', () => {
    vi.useFakeTimers();
    render(<ToastViewport />);
    push({ message: 'auto', durationMs: 5000 });

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // The expiry consumed the only timer; the ghost must not re-arm one.
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    // Still exactly one ghost, patiently waiting on its leave animation.
    const ghosts = toastElements();
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].className).toContain('is-leaving');
  });

  it('reduced motion: dismissal removes the toast immediately', () => {
    setReducedMotion(true);
    render(<ToastViewport />);
    push({ message: 'instant' });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(toastElements()).toHaveLength(0);
  });

  it('cap eviction plays the leave animation on the evicted toast', () => {
    render(<ToastViewport />);
    for (const m of ['t1', 't2', 't3', 't4', 't5']) push({ message: m });

    // Store keeps the newest 4; the evicted oldest lingers as a ghost.
    expect(useToastsStore.getState().toasts).toHaveLength(4);
    expect(toastElements()).toHaveLength(5);
    const ghost = screen.getByText('t1').closest('li')!;
    expect(ghost.className).toContain('is-leaving');

    endLeave(ghost);
    expect(toastElements()).toHaveLength(4);
  });

  it('the action button works while live, then goes inert once the leave starts', () => {
    const onAction = vi.fn();
    render(<ToastViewport />);
    push({ message: 'undoable', actionLabel: 'Undo', onAction, durationMs: 0 });

    const undo = screen.getByRole('button', { name: 'Undo' });
    fireEvent.click(undo);
    expect(onAction).toHaveBeenCalledTimes(1);

    // The click dismissed it — the ghost's buttons are guard-disabled, so a
    // second activation (keyboard focus survives pointer-events) is a no-op.
    const ghost = screen.getByText('undoable').closest('li')!;
    expect(ghost.className).toContain('is-leaving');
    fireEvent.click(undo);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onAction).toHaveBeenCalledTimes(1);

    endLeave(ghost);
    expect(toastElements()).toHaveLength(0);
  });

  it('dismissing an id that is already leaving neither double-fires nor wedges', () => {
    render(<ToastViewport />);
    const id = push({ message: 'twice' });

    act(() => useToastsStore.getState().dismiss(id));
    act(() => useToastsStore.getState().dismiss(id));
    expect(toastElements()).toHaveLength(1);

    const ghost = screen.getByText('twice').closest('li')!;
    endLeave(ghost);
    endLeave(ghost);
    expect(toastElements()).toHaveLength(0);

    // The viewport still works afterward.
    push({ message: 'after' });
    expect(toastElements()).toHaveLength(1);
  });

  it('rapid-fire toasts stack, dismiss concurrently, and clear cleanly', () => {
    render(<ToastViewport />);
    const ids = ['a', 'b', 'c'].map((m) => push({ message: m }));

    act(() => {
      for (const id of ids) useToastsStore.getState().dismiss(id);
    });
    const ghosts = toastElements();
    expect(ghosts).toHaveLength(3);
    expect(ghosts.every((el) => el.className.includes('is-leaving'))).toBe(true);

    // A new toast arriving mid-exit renders live alongside the ghosts.
    push({ message: 'fresh' });
    expect(toastElements()).toHaveLength(4);
    expect(screen.getByText('fresh').closest('li')!.className).not.toContain('is-leaving');

    for (const g of ghosts) endLeave(g);
    expect(toastElements()).toHaveLength(1);
    expect(useToastsStore.getState().toasts).toHaveLength(1);
  });

  it('coalesced repeats keep a single toast with a ×n badge', () => {
    render(<ToastViewport />);
    push({ message: 'same' });
    push({ message: 'same' });

    expect(toastElements()).toHaveLength(1);
    expect(screen.getByLabelText('2 times').textContent).toBe('×2');
  });
});
