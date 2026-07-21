import { describe, expect, it } from 'vitest';
import {
  describeGameEvent,
  formatGameEventSentence,
  type DescribableEvent,
} from './game-event-text';
import type { GameEvent } from './game-state';

// Behavior-preserving extraction from GameHistory.tsx's private describeRow —
// one case per GameEvent.kind, asserting the exact strings the original
// inline switch produced (see GameHistory.tsx git history pre-extraction).
const seatName = (seat: number | null | undefined): string | undefined => {
  if (seat == null) return undefined;
  const names: Record<number, string> = { 0: 'Alice', 1: 'Bob' };
  return names[seat] ?? `seat ${seat}`;
};

function row(kind: GameEvent['kind'], overrides: Partial<DescribableEvent> = {}): DescribableEvent {
  return { kind, targetSeat: null, actorSeat: null, ...overrides };
}

describe('describeGameEvent', () => {
  it('life', () => {
    expect(describeGameEvent(row('life', { targetSeat: 0, delta: 3 }), seatName)).toEqual({
      target: 'Alice',
      action: 'life',
      delta: 3,
    });
  });

  it('set-life', () => {
    expect(describeGameEvent(row('set-life', { targetSeat: 0, delta: 40 }), seatName)).toEqual({
      target: 'Alice',
      action: 'life set',
      delta: 40,
    });
  });

  it('poison', () => {
    expect(describeGameEvent(row('poison', { targetSeat: 1, delta: 2 }), seatName)).toEqual({
      target: 'Bob',
      action: 'poison',
      delta: 2,
    });
  });

  it('cmd-dmg', () => {
    expect(
      describeGameEvent(row('cmd-dmg', { targetSeat: 1, fromSeat: 0, delta: 5 }), seatName)
    ).toEqual({ target: 'Bob', action: 'cmd dmg', delta: 5, source: 'Alice' });
  });

  it('eliminate (manual)', () => {
    expect(describeGameEvent(row('eliminate', { targetSeat: 1 }), seatName)).toEqual({
      target: 'Bob',
      action: 'eliminated',
    });
  });

  it('eliminate (auto)', () => {
    expect(
      describeGameEvent(row('eliminate', { targetSeat: 1, message: 'auto' }), seatName)
    ).toEqual({ target: 'Bob', action: 'eliminated (auto)' });
  });

  it('revive', () => {
    expect(describeGameEvent(row('revive', { targetSeat: 1 }), seatName)).toEqual({
      target: 'Bob',
      action: 'revived',
    });
  });

  it('start', () => {
    expect(describeGameEvent(row('start'), seatName)).toEqual({ action: 'Game started' });
  });

  it('end (with a winner)', () => {
    expect(describeGameEvent(row('end', { targetSeat: 0 }), seatName)).toEqual({
      target: 'Alice',
      action: 'wins — game ended',
    });
  });

  it('end (no winner seat)', () => {
    expect(describeGameEvent(row('end'), seatName)).toEqual({ action: 'Game ended' });
  });

  it('reset', () => {
    expect(describeGameEvent(row('reset'), seatName)).toEqual({ action: 'Game reset' });
  });

  it('join (with message)', () => {
    expect(describeGameEvent(row('join', { message: 'Carol' }), seatName)).toEqual({
      action: 'Carol joined',
    });
  });

  it('join (falls back to seat name)', () => {
    expect(describeGameEvent(row('join', { targetSeat: 0 }), seatName)).toEqual({
      action: 'Alice joined',
    });
  });

  it('leave (with message)', () => {
    expect(describeGameEvent(row('leave', { message: 'Carol' }), seatName)).toEqual({
      action: 'Carol left',
    });
  });

  it('note', () => {
    expect(describeGameEvent(row('note', { message: 'gg' }), seatName)).toEqual({ action: 'gg' });
  });

  it('note (no message)', () => {
    expect(describeGameEvent(row('note'), seatName)).toEqual({ action: 'note' });
  });

  it('settings', () => {
    expect(describeGameEvent(row('settings'), seatName)).toEqual({ action: 'Settings changed' });
  });

  it('designation falls through to the default kind-as-action case', () => {
    // 'designation' has no dedicated case in the original switch — this
    // preserves that (pre-existing, out-of-scope-to-fix) behavior.
    expect(describeGameEvent(row('designation'), seatName)).toEqual({ action: 'designation' });
  });

  it('unknown kind falls back to the kind itself', () => {
    expect(describeGameEvent(row('turn'), seatName)).toEqual({ action: 'turn' });
  });

  it('resolves an unnamed seat to "seat N"', () => {
    expect(describeGameEvent(row('eliminate', { targetSeat: 4 }), seatName)).toEqual({
      target: 'seat 4',
      action: 'eliminated',
    });
  });
});

describe('formatGameEventSentence', () => {
  it('joins target, action, delta, and source in order', () => {
    expect(
      formatGameEventSentence({ target: 'Bob', action: 'cmd dmg', delta: 5, source: 'Alice' })
    ).toBe('Bob cmd dmg +5 from Alice');
  });

  it('omits parts that are absent', () => {
    expect(formatGameEventSentence({ action: 'Game started' })).toBe('Game started');
  });

  it('renders a negative delta without a leading plus', () => {
    expect(formatGameEventSentence({ target: 'Alice', action: 'life', delta: -3 })).toBe(
      'Alice life -3'
    );
  });
});
