// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { PlaytestState } from '@/lib/playtest';
import { useBoardSelection } from './use-board-selection';

const bf = (id: string, tapped = false) => ({ card: { id, name: id }, tapped, x: 0, y: 0 });
const state = {
  battlefield: [bf('a'), bf('b', true), bf('c')],
} as unknown as PlaytestState;

function setup(overrides: Partial<Parameters<typeof useBoardSelection>[0]> = {}) {
  const dispatch = vi.fn();
  const finishArrow = vi.fn();
  const ping = vi.fn();
  const hook = renderHook(() =>
    useBoardSelection({
      state,
      dispatch,
      onlineTable: null,
      arrowFrom: null,
      finishArrow,
      ping,
      ...overrides,
    })
  );
  return { ...hook, dispatch, finishArrow, ping };
}

const click = (extra: object = {}) => ({ type: 'click', ...extra }) as React.MouseEvent;

describe('useBoardSelection', () => {
  it('rings a plain click but leaves the selection alone', () => {
    const { result, ping } = setup();
    act(() => result.current.handleCardClick('a', click()));
    expect(ping).toHaveBeenCalledWith('a');
    expect(result.current.selected.size).toBe(0);
  });

  it('toggles a card in and out with a modifier click', () => {
    const { result } = setup();
    act(() => result.current.handleCardClick('a', click({ metaKey: true })));
    expect([...result.current.selected]).toEqual(['a']);
    act(() => result.current.handleCardClick('a', click({ ctrlKey: true })));
    expect(result.current.selected.size).toBe(0);
  });

  it('selects on a plain click while select mode is on, and drops the selection leaving it', () => {
    const { result } = setup();
    act(() => result.current.toggleSelectMode());
    expect(result.current.selectMode).toBe(true);
    act(() => result.current.handleCardClick('c', click()));
    expect([...result.current.selected]).toEqual(['c']);
    act(() => result.current.toggleSelectMode());
    expect(result.current.selectMode).toBe(false);
    expect(result.current.selected.size).toBe(0);
  });

  it('lands an arrow instead of tapping or selecting while one is armed', () => {
    const { result, finishArrow, ping } = setup({
      arrowFrom: { seat: 0, cardId: 'a' },
      onlineTable: { mySeat: 2 } as never,
    });
    act(() => result.current.handleCardClick('b', click({ metaKey: true })));
    expect(finishArrow).toHaveBeenCalledWith(2, 'b');
    expect(ping).not.toHaveBeenCalled();
    expect(result.current.selected.size).toBe(0);
  });

  it('replaces the selection with a marquee, or adds to it when additive', () => {
    const { result } = setup();
    act(() => result.current.selectArea(['a', 'b'], false));
    expect([...result.current.selected]).toEqual(['a', 'b']);
    act(() => result.current.selectArea(['c'], true));
    expect([...result.current.selected]).toEqual(['a', 'b', 'c']);
    act(() => result.current.selectArea(['c'], false));
    expect([...result.current.selected]).toEqual(['c']);
  });

  it('taps every selected card when any is untapped, untaps them when all are tapped', () => {
    const { result, dispatch } = setup();
    act(() => result.current.selectArea(['a', 'b'], false));
    act(() => result.current.tapSelection());
    // b is already tapped, so only a needs a TAP.
    expect(dispatch.mock.calls).toEqual([[{ type: 'TAP', cardId: 'a', tapped: true }]]);
    dispatch.mockClear();
    act(() => result.current.selectArea(['b'], false));
    act(() => result.current.tapSelection());
    expect(dispatch.mock.calls).toEqual([[{ type: 'TAP', cardId: 'b', tapped: false }]]);
  });

  it('moves every selected card to a zone and clears the selection', () => {
    const { result, dispatch } = setup();
    act(() => result.current.selectArea(['a', 'c'], false));
    act(() => result.current.moveSelection('graveyard'));
    expect(dispatch.mock.calls.map(([a]) => a)).toEqual([
      { type: 'MOVE_TO_ZONE', cardId: 'a', to: 'graveyard', toIndex: undefined },
      { type: 'MOVE_TO_ZONE', cardId: 'c', to: 'graveyard', toIndex: undefined },
    ]);
    expect(result.current.selected.size).toBe(0);
  });

  it('keeps the same set identity when clearing an empty selection', () => {
    const { result } = setup();
    const before = result.current.selected;
    act(() => result.current.clearSelection());
    expect(result.current.selected).toBe(before);
  });
});
