import { describe, expect, it } from 'vitest';
import { addToast, MAX_VISIBLE_TOASTS } from './toast-stack';
import type { Toast } from '../store/toasts';

function makeToast(over: Partial<Toast> = {}): Toast {
  return {
    id: over.id ?? `t_${Math.random().toString(36).slice(2, 8)}`,
    message: over.message ?? 'Saved',
    tone: over.tone ?? 'info',
    durationMs: over.durationMs ?? 5000,
    createdAt: over.createdAt ?? 1000,
    ...over,
  };
}

describe('addToast', () => {
  it('coalesces identical info toasts: increments repeat, keeps length 1, updates bumpedAt', () => {
    const first = makeToast({ id: 'a', message: 'Saved', tone: 'info', createdAt: 1000 });
    let list = addToast([], first);
    expect(list).toHaveLength(1);
    expect(list[0].repeat).toBeUndefined();

    const second = makeToast({ id: 'b', message: 'Saved', tone: 'info', createdAt: 2000 });
    list = addToast(list, second);
    expect(list).toHaveLength(1);
    expect(list[0].repeat).toBe(2);
    expect(list[0].bumpedAt).toBe(2000);
    expect(list[0].createdAt).toBe(2000);

    const third = makeToast({ id: 'c', message: 'Saved', tone: 'info', createdAt: 3000 });
    list = addToast(list, third);
    expect(list).toHaveLength(1);
    expect(list[0].repeat).toBe(3);
    expect(list[0].bumpedAt).toBe(3000);
  });

  it('preserves the original id on coalesce (incoming is discarded)', () => {
    const first = makeToast({ id: 'a', message: 'Saved' });
    const second = makeToast({ id: 'b', message: 'Saved' });
    const list = addToast(addToast([], first), second);
    expect(list[0].id).toBe('a');
  });

  it('does NOT coalesce when the incoming toast carries an action (Undo)', () => {
    const first = makeToast({ id: 'a', message: 'Removed card' });
    const undo = makeToast({
      id: 'b',
      message: 'Removed card',
      actionLabel: 'Undo',
      onAction: () => {},
    });
    const list = addToast(addToast([], first), undo);
    expect(list).toHaveLength(2);
    expect(list.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('does NOT coalesce when the existing toast carries an action', () => {
    const undo = makeToast({
      id: 'a',
      message: 'Removed card',
      actionLabel: 'Undo',
      onAction: () => {},
    });
    const plain = makeToast({ id: 'b', message: 'Removed card' });
    const list = addToast(addToast([], undo), plain);
    expect(list).toHaveLength(2);
  });

  it('does NOT coalesce different messages', () => {
    const a = makeToast({ id: 'a', message: 'Saved' });
    const b = makeToast({ id: 'b', message: 'Deleted' });
    const list = addToast(addToast([], a), b);
    expect(list).toHaveLength(2);
  });

  it('does NOT coalesce same message but different tones', () => {
    const a = makeToast({ id: 'a', message: 'Synced', tone: 'info' });
    const b = makeToast({ id: 'b', message: 'Synced', tone: 'error' });
    const list = addToast(addToast([], a), b);
    expect(list).toHaveLength(2);
  });

  it('drops the oldest when the cap is exceeded', () => {
    let list: Toast[] = [];
    for (let i = 0; i < MAX_VISIBLE_TOASTS + 2; i++) {
      list = addToast(list, makeToast({ id: `t${i}`, message: `msg ${i}` }));
    }
    expect(list).toHaveLength(MAX_VISIBLE_TOASTS);
    // First two (t0, t1) were shed; newest (t5) is last.
    expect(list[0].id).toBe('t2');
    expect(list[list.length - 1].id).toBe('t5');
  });

  it('keeps the newest toasts when capped', () => {
    let list: Toast[] = [];
    for (let i = 0; i < 10; i++) {
      list = addToast(list, makeToast({ id: `t${i}`, message: `msg ${i}` }), 3);
    }
    expect(list).toHaveLength(3);
    expect(list.map((t) => t.id)).toEqual(['t7', 't8', 't9']);
  });

  it('moves a coalesced toast to the end (newest position)', () => {
    const a = makeToast({ id: 'a', message: 'Saved' });
    const b = makeToast({ id: 'b', message: 'Deleted' });
    let list = addToast(addToast([], a), b);
    expect(list.map((t) => t.id)).toEqual(['a', 'b']);

    // Re-fire "Saved" — its entry should move from front to end.
    const aAgain = makeToast({ id: 'c', message: 'Saved', createdAt: 5000 });
    list = addToast(list, aAgain);
    expect(list.map((t) => t.id)).toEqual(['b', 'a']);
    expect(list[1].repeat).toBe(2);
    expect(list[1].bumpedAt).toBe(5000);
  });

  it('returns a new array (immutability)', () => {
    const list: Toast[] = [makeToast({ id: 'a', message: 'Saved' })];
    const next = addToast(list, makeToast({ id: 'b', message: 'Deleted' }));
    expect(next).not.toBe(list);
    expect(list).toHaveLength(1);
  });
});
