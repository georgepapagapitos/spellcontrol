import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useToastsStore, toast } from './toasts';

beforeEach(() => {
  useToastsStore.setState({ toasts: [] });
});

describe('useToastsStore', () => {
  it('starts empty', () => {
    expect(useToastsStore.getState().toasts).toEqual([]);
  });

  it('push applies defaults and returns a prefixed id', () => {
    const id = useToastsStore.getState().push({ message: 'hello' });
    expect(id).toMatch(/^toast_/);
    const [t] = useToastsStore.getState().toasts;
    expect(t).toMatchObject({
      id,
      message: 'hello',
      tone: 'info',
      durationMs: 5000,
    });
    expect(t.actionLabel).toBeUndefined();
    expect(typeof t.createdAt).toBe('number');
  });

  it('push honors all explicit options', () => {
    const onAction = vi.fn();
    useToastsStore.getState().push({
      message: 'undo me',
      tone: 'success',
      actionLabel: 'Undo',
      onAction,
      durationMs: 0,
    });
    const [t] = useToastsStore.getState().toasts;
    expect(t).toMatchObject({
      message: 'undo me',
      tone: 'success',
      actionLabel: 'Undo',
      durationMs: 0,
    });
    t.onAction?.();
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('keeps insertion order and unique ids when pushing several', () => {
    const a = useToastsStore.getState().push({ message: 'a' });
    const b = useToastsStore.getState().push({ message: 'b' });
    expect(a).not.toBe(b);
    expect(useToastsStore.getState().toasts.map((t) => t.message)).toEqual(['a', 'b']);
  });

  it('dismiss removes only the matching toast', () => {
    const a = useToastsStore.getState().push({ message: 'a' });
    useToastsStore.getState().push({ message: 'b' });
    useToastsStore.getState().dismiss(a);
    expect(useToastsStore.getState().toasts.map((t) => t.message)).toEqual(['b']);
  });

  it('dismiss is a no-op for an unknown id', () => {
    useToastsStore.getState().push({ message: 'a' });
    useToastsStore.getState().dismiss('toast_nope');
    expect(useToastsStore.getState().toasts).toHaveLength(1);
  });

  it('clear empties the list', () => {
    useToastsStore.getState().push({ message: 'a' });
    useToastsStore.getState().push({ message: 'b' });
    useToastsStore.getState().clear();
    expect(useToastsStore.getState().toasts).toEqual([]);
  });

  it('toast.show / toast.dismiss drive the store imperatively', () => {
    const id = toast.show({ message: 'imperative' });
    expect(useToastsStore.getState().toasts).toHaveLength(1);
    toast.dismiss(id);
    expect(useToastsStore.getState().toasts).toEqual([]);
  });

  it('falls back to a timestamp id when crypto.randomUUID is unavailable', () => {
    const original = globalThis.crypto;
    // Force the non-crypto branch of newId().
    Object.defineProperty(globalThis, 'crypto', {
      value: {},
      configurable: true,
    });
    try {
      const id = useToastsStore.getState().push({ message: 'fallback' });
      expect(id).toMatch(/^toast_\d+_[a-z0-9]+$/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: original,
        configurable: true,
      });
    }
  });
});
