// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dismissedNames,
  isDismissedChange,
  useDismissedSuggestions,
  withoutDismissed,
  type DismissedSuggestion,
} from './dismissed-suggestions';
import { ATRAXA, hiddenOf, openDeck, pressUndo } from '@/components/deck/dismiss-test-helpers';
import { buildSuggestionRows } from './deck-suggestions';
import { cutLane } from './coach-cut-swaps';
import { resetSuggestionLabelsForTests, surfaceLabel } from '@/lib/util/suggestion-labels';
import type { GapAnalysisCard } from '@/deck-builder/types';

const sent = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('@/lib/util/analytics', async (orig) => ({
  ...(await orig<typeof import('@/lib/util/analytics')>()),
  track: () => {},
  sendBeaconPayload: (p: Record<string, unknown>) => sent.push(p),
  normalizePath: (p: string) => p,
}));

let deckId = '';
beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
  resetSuggestionLabelsForTests();
  deckId = openDeck();
});

const entry = (name: string, cut = false): DismissedSuggestion => ({
  name,
  cut: cut || undefined,
  surface: 'coach:all',
});

describe('the hidden list', () => {
  it('keys an add by the card coming in and a cut by the card leaving, case-insensitively', () => {
    const list = [entry('Sol Ring'), entry('Mind Stone', true)];
    expect([...dismissedNames(list)]).toEqual(['sol ring']);
    expect([...dismissedNames(list, true)]).toEqual(['mind stone']);
    expect(isDismissedChange(list, { name: 'SOL RING', type: 'add' })).toBe(true);
    expect(isDismissedChange(list, { name: 'Sol Ring', type: 'cut' })).toBe(false);
    expect(isDismissedChange(list, { name: 'Mind Stone', type: 'cut' })).toBe(true);
    expect(isDismissedChange(undefined, { name: 'Sol Ring', type: 'add' })).toBe(false);
  });

  it('drops a hidden substitute from the row that offers it and keeps the row', () => {
    interface Row {
      name: string;
      type: string;
      alternatives?: Row[];
    }
    const row: Row = {
      name: 'Cultivate',
      type: 'add',
      alternatives: [
        { name: 'Farseek', type: 'add' },
        { name: 'Rampant Growth', type: 'add' },
      ],
    };
    const [kept] = withoutDismissed([row], [entry('Farseek')]);
    expect(kept.alternatives?.map((a) => a.name)).toEqual(['Rampant Growth']);
    expect(withoutDismissed([row], [entry('Cultivate')])).toEqual([]);
  });
});

describe('useDismissedSuggestions', () => {
  it('stores the entry on the deck as plain JSON, so it syncs like any deck field', () => {
    const { result } = renderHook(() => useDismissedSuggestions());
    act(() =>
      result.current.dismiss({ name: 'Sol Ring', surface: 'swap', cardIn: 'Sol Ring', rank: 1 })
    );
    expect(hiddenOf(deckId)).toEqual([{ name: 'Sol Ring', surface: 'swap' }]);
    expect(result.current.inNames.has('sol ring')).toBe(true);
    expect(JSON.parse(JSON.stringify(hiddenOf(deckId)))).toEqual(hiddenOf(deckId));
  });

  it('hides a card once however many surfaces ask', () => {
    const { result } = renderHook(() => useDismissedSuggestions());
    act(() => result.current.dismiss({ name: 'Sol Ring', surface: 'swap' }));
    act(() => result.current.dismiss({ name: 'sol ring', surface: 'similar' }));
    expect(hiddenOf(deckId)).toHaveLength(1);
    expect(sent.filter((p) => p.action === 'dismiss')).toHaveLength(1);
  });

  it('restoring from the list labels an undo on the surface that took the dismissal', () => {
    const { result } = renderHook(() => useDismissedSuggestions());
    act(() => result.current.dismiss({ name: 'Sol Ring', surface: 'similar', cardIn: 'Sol Ring' }));
    act(() => result.current.restore(result.current.list[0]));
    expect(hiddenOf(deckId)).toBeUndefined();
    expect(sent.filter((p) => p.action === 'undo')).toEqual([
      expect.objectContaining({ surface: 'similar', cardIn: 'Sol Ring', cmdr: ATRAXA }),
    ]);
    // The toast's Undo after the list already restored it labels nothing twice.
    act(() => pressUndo());
    expect(sent.filter((p) => p.action === 'undo')).toHaveLength(1);
  });

  it('caps the labels of a bulk restore', () => {
    const { result } = renderHook(() => useDismissedSuggestions());
    for (let i = 0; i < 8; i++) {
      act(() => result.current.dismiss({ name: `Card ${i}`, surface: 'swap' }));
    }
    act(() => result.current.restoreAll());
    expect(hiddenOf(deckId)).toBeUndefined();
    expect(sent.filter((p) => p.action === 'undo')).toHaveLength(5);
  });

  it('does nothing without an open deck', () => {
    resetSuggestionLabelsForTests();
    const { result } = renderHook(() => useDismissedSuggestions());
    expect(result.current.canDismiss).toBe(false);
    act(() => result.current.dismiss({ name: 'Sol Ring', surface: 'swap' }));
    expect(hiddenOf(deckId)).toBeUndefined();
  });
});

describe('where Coach reads the list', () => {
  const gap = (name: string) => ({ name, inclusion: 50 }) as GapAnalysisCard;

  it('the Add panel leaves a hidden card out of every group and its counts', () => {
    const rows = buildSuggestionRows([gap('Cultivate'), gap('Farseek')], [], {
      ownershipFor: () => 'owned',
      query: '',
      inDeck: new Set(),
      show: { owned: true, inOtherDeck: true, inCube: true, unowned: true },
      dismissed: new Set(['cultivate']),
    });
    expect(rows.staples.map((r) => r.name)).toEqual(['Farseek']);
    expect(rows.counts.owned).toBe(1);
  });

  it('a Cuts-lane replacement the player hid reads as withheld, like one already in the deck', () => {
    const cut = { change: { id: 'cut:a', type: 'cut', name: 'Old Card' }, score: 1, tier: 1 };
    const swap = { id: 'swap:a', type: 'swap', name: 'Cultivate', inName: 'Old Card' };
    const state = {
      status: 'ready',
      outcomes: new Map([['cut:a', { status: 'swap', change: swap }]]),
    };
    const lane = (names: string[]) =>
      cutLane([cut] as never, state as never, new Set(names)).rows.map((r) => r.change.name);
    expect(lane([])).toEqual(['Cultivate']);
    expect(lane(['cultivate'])).toEqual([]);
  });
});

describe('admin names', () => {
  it('names a surface for people and passes an unknown id through', () => {
    expect(surfaceLabel('coach:all')).toBe('Coach, all lanes');
    expect(surfaceLabel('hidden-gems')).toBe('Add panel, hidden gems');
    expect(surfaceLabel('brand-new')).toBe('brand-new');
  });
});
