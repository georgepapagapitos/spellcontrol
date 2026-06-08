import { describe, it, expect } from 'vitest';
import {
  MAX_DEPTH,
  emptyHistory,
  pushCommand,
  undo,
  redo,
  invalidate,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  type Command,
  type History,
} from './deck-history-core';

// Snapshot type is just a string here — the core is generic and never inspects
// it; the store binds S = Deck.
type S = string;
const cmd = (deckId: string, label: string, before: S, after: S): Command<S> => ({
  deckId,
  label,
  before,
  after,
});

function build(...cmds: Command<S>[]): History<S> {
  return cmds.reduce((h, c) => pushCommand(h, c), emptyHistory<S>());
}

describe('deck-history-core', () => {
  it('starts empty — nothing to undo or redo', () => {
    const h = emptyHistory<S>();
    expect(canUndo(h, 'd1')).toBe(false);
    expect(canRedo(h, 'd1')).toBe(false);
    expect(undo(h, 'd1')).toBeNull();
    expect(redo(h, 'd1')).toBeNull();
    expect(undoLabel(h, 'd1')).toBeNull();
    expect(redoLabel(h, 'd1')).toBeNull();
  });

  it('pushCommand makes the deck undoable and exposes the label', () => {
    const h = build(cmd('d1', 'add Sol Ring', 'A', 'B'));
    expect(canUndo(h, 'd1')).toBe(true);
    expect(canRedo(h, 'd1')).toBe(false);
    expect(undoLabel(h, 'd1')).toBe('add Sol Ring');
  });

  it('undo returns the most recent command and its before-snapshot', () => {
    const h = build(cmd('d1', 'first', 'A', 'B'), cmd('d1', 'second', 'B', 'C'));
    const r = undo(h, 'd1')!;
    expect(r.command.label).toBe('second');
    expect(r.command.before).toBe('B'); // caller restores this
    expect(canUndo(r.history, 'd1')).toBe(true); // 'first' still there
    expect(canRedo(r.history, 'd1')).toBe(true);
    expect(redoLabel(r.history, 'd1')).toBe('second');
  });

  it('undo then redo round-trips in LIFO/FIFO order', () => {
    let h = build(cmd('d1', 'c1', 'A', 'B'), cmd('d1', 'c2', 'B', 'C'), cmd('d1', 'c3', 'C', 'D'));

    // Undo c3, then c2.
    let u = undo(h, 'd1')!;
    expect(u.command.label).toBe('c3');
    h = u.history;
    u = undo(h, 'd1')!;
    expect(u.command.label).toBe('c2');
    h = u.history;

    // Redo should reapply c2 first (reverse of undo), then c3.
    let r = redo(h, 'd1')!;
    expect(r.command.label).toBe('c2');
    expect(r.command.after).toBe('C');
    h = r.history;
    r = redo(h, 'd1')!;
    expect(r.command.label).toBe('c3');
    expect(r.command.after).toBe('D');
    h = r.history;
    expect(canRedo(h, 'd1')).toBe(false);
    expect(canUndo(h, 'd1')).toBe(true);
  });

  it('a new command after undo clears the redo branch', () => {
    let h = build(cmd('d1', 'c1', 'A', 'B'), cmd('d1', 'c2', 'B', 'C'));
    h = undo(h, 'd1')!.history; // future now has c2
    expect(canRedo(h, 'd1')).toBe(true);
    h = pushCommand(h, cmd('d1', 'c3', 'B', 'X')); // branch
    expect(canRedo(h, 'd1')).toBe(false);
    expect(undoLabel(h, 'd1')).toBe('c3');
  });

  it('caps depth per deck, dropping the oldest', () => {
    let h = emptyHistory<S>();
    for (let i = 0; i < MAX_DEPTH + 5; i++) {
      h = pushCommand(h, cmd('d1', `c${i}`, String(i), String(i + 1)));
    }
    // Undo as far as possible and count.
    let depth = 0;
    while (canUndo(h, 'd1')) {
      h = undo(h, 'd1')!.history;
      depth++;
    }
    expect(depth).toBe(MAX_DEPTH);
  });

  it('keeps per-deck stacks independent', () => {
    const h = build(cmd('d1', 'a', 'A', 'B'), cmd('d2', 'x', 'X', 'Y'));
    expect(canUndo(h, 'd1')).toBe(true);
    expect(canUndo(h, 'd2')).toBe(true);
    const r = undo(h, 'd1')!;
    expect(canUndo(r.history, 'd2')).toBe(true); // d2 untouched
    expect(undo(r.history, 'd2')!.command.label).toBe('x');
  });

  it('invalidate drops only the named decks and returns the same ref when no-op', () => {
    const h = build(cmd('d1', 'a', 'A', 'B'), cmd('d2', 'x', 'X', 'Y'));
    const after = invalidate(h, ['d1']);
    expect(canUndo(after, 'd1')).toBe(false);
    expect(canUndo(after, 'd2')).toBe(true);
    // No-op invalidation returns the identical reference (cheap subscriber guard).
    expect(invalidate(after, ['nope'])).toBe(after);
    expect(invalidate(emptyHistory<S>(), ['anything'])).not.toBeNull();
  });

  it('does not mutate the input history (immutability)', () => {
    const h0 = build(cmd('d1', 'a', 'A', 'B'));
    const snapshot = JSON.stringify(h0);
    pushCommand(h0, cmd('d1', 'b', 'B', 'C'));
    undo(h0, 'd1');
    invalidate(h0, ['d1']);
    expect(JSON.stringify(h0)).toBe(snapshot);
  });
});
