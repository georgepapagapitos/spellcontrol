import { describe, expect, it } from 'vitest';
import type { BattlefieldCard } from '@/lib/playtest';
import { clampGroupDelta, planGroupDrag } from './group-drag';

function bf(id: string, x: number, y: number, attachedTo?: string): BattlefieldCard {
  return {
    card: { id, name: id, scryfallId: id },
    tapped: false,
    faceDown: false,
    counters: {},
    stickers: [],
    x,
    y,
    ...(attachedTo ? { attachedTo } : {}),
  };
}

const ids = (plan: { moves: { cardId: string }[] }) => plan.moves.map((m) => m.cardId).sort();

describe('clampGroupDelta', () => {
  it('keeps the formation intact when the group hits an edge', () => {
    // Three cards in a row, 0.1 apart. Dragging 0.5 left would put the
    // leading one at -0.4; the group can only go as far as that card can.
    const row = [bf('a', 0.2, 0.5), bf('b', 0.3, 0.5), bf('c', 0.4, 0.5)];
    expect(clampGroupDelta(row, -0.5, 0).dx).toBeCloseTo(-0.2);
    expect(clampGroupDelta(row, 0.9, 0).dx).toBeCloseTo(0.6);
  });

  it('leaves a delta that fits alone', () => {
    const row = [bf('a', 0.2, 0.2), bf('b', 0.4, 0.4)];
    expect(clampGroupDelta(row, 0.1, -0.1)).toEqual({ dx: 0.1, dy: -0.1 });
  });

  it('is zero for an empty group', () => {
    expect(clampGroupDelta([], 0.3, 0.3)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('planGroupDrag', () => {
  const board = [bf('a', 0.1, 0.1), bf('b', 0.2, 0.2), bf('c', 0.3, 0.3)];

  it('moves the whole selection by one delta when a selected card is grabbed', () => {
    const plan = planGroupDrag(board, 'a', new Set(['a', 'b']), 0.1, 0.1);
    expect(ids(plan)).toEqual(['a', 'b']);
    expect(plan.moves).toEqual([
      { cardId: 'a', x: 0.2, y: 0.2 },
      { cardId: 'b', x: expect.closeTo(0.3), y: expect.closeTo(0.3) },
    ]);
  });

  it('every card keeps its spacing when the drag is clamped', () => {
    const plan = planGroupDrag(board, 'a', new Set(['a', 'b', 'c']), -0.9, 0);
    const xs = plan.moves.map((m) => m.x);
    expect(xs[0]).toBeCloseTo(0);
    expect(xs[1] - xs[0]).toBeCloseTo(0.1);
    expect(xs[2] - xs[1]).toBeCloseTo(0.1);
  });

  it('moves only the grabbed card when it is outside the selection', () => {
    const plan = planGroupDrag(board, 'c', new Set(['a', 'b']), 0.1, 0);
    expect(ids(plan)).toEqual(['c']);
  });

  it('moves only the grabbed card when it is the whole selection', () => {
    expect(ids(planGroupDrag(board, 'a', new Set(['a']), 0.1, 0))).toEqual(['a']);
  });

  it('leaves an attachment to its host rather than moving it twice', () => {
    // `MOVE_BF_POSITION` carries attachments with their host, so dispatching
    // for the Equipment as well would double its delta.
    const withAura = [...board, bf('aura', 0.1, 0.1, 'a')];
    const plan = planGroupDrag(withAura, 'a', new Set(['a', 'aura']), 0.1, 0);
    expect(ids(plan)).toEqual(['a']);
    // It still moves, so the preview has to include it.
    expect([...plan.ids].sort()).toEqual(['a', 'aura']);
  });

  it('carries an unselected attachment of a selected host in the preview', () => {
    const withAura = [...board, bf('aura', 0.1, 0.1, 'a')];
    expect([...planGroupDrag(withAura, 'a', new Set(['a', 'b']), 0, 0).ids].sort()).toEqual([
      'a',
      'aura',
      'b',
    ]);
  });

  it('ignores a selected card that is no longer on the battlefield', () => {
    const plan = planGroupDrag(board, 'a', new Set(['a', 'gone']), 0.1, 0);
    expect(ids(plan)).toEqual(['a']);
  });

  it('is empty when the grabbed card is gone', () => {
    expect(planGroupDrag(board, 'gone', new Set(), 0.1, 0).moves).toEqual([]);
  });
});
