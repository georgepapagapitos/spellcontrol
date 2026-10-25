// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardsByNames: async (names: string[]) => new Map(names.map((n) => [n, realCard(n)])),
}));

import { DeckSinceStrip } from './DeckSinceStrip';
import { useDeckSince } from './use-deck-since';
import { SESSION_GAP_MS } from '@/lib/deck/deck-since-store';
import { baselineLabel, buildSnapshot, diffSnapshots } from '@/lib/deck/deck-since';
import { makeDeck, realCard } from '@/lib/deck/deck-since.fixtures';

const ATRAXA = 'Atraxa, Praetors’ Voice';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function since() {
  const base = buildSnapshot(makeDeck(['Sol Ring', 'Forest'], ATRAXA), false, {}, 0);
  const now = buildSnapshot(
    makeDeck(['Sol Ring', 'Forest', 'Forest', 'Command Tower', 'Cultivate'], ATRAXA),
    false,
    {},
    1
  );
  return diffSnapshots(base, now, (n) => (n === 'Cultivate' ? ['ramp'] : []));
}

describe('DeckSinceStrip', () => {
  it('reads as one line, collapsed, with the baseline named', () => {
    render(<DeckSinceStrip since={since()} baselineAt={Date.now()} onDismiss={() => {}} />);
    expect(screen.getByText('Since earlier today')).toBeTruthy();
    expect(screen.getByText('Lands 1 to 3')).toBeTruthy();
    const details = document.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
  });

  it('lists the added cards with the role each fills once opened', () => {
    render(<DeckSinceStrip since={since()} baselineAt={Date.now()} onDismiss={() => {}} />);
    (document.querySelector('details') as HTMLDetailsElement).open = true;
    const added = screen.getByRole('heading', { name: 'Added (3)' });
    expect(added).toBeTruthy();
    expect(screen.getByLabelText('Added: Cultivate, ramp')).toBeTruthy();
    expect(screen.getByLabelText('Added: Forest')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Removed/ })).toBeNull();
  });

  it('marks the changes seen from a control outside the summary', () => {
    const onDismiss = vi.fn();
    render(<DeckSinceStrip since={since()} baselineAt={Date.now()} onDismiss={onDismiss} />);
    const btn = screen.getByRole('button', { name: 'Mark changes as seen' });
    expect(btn.closest('summary')).toBeNull();
    fireEvent.click(btn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('baselineLabel', () => {
  const now = new Date(2026, 9, 25, 15, 0).getTime();
  it('names today, yesterday, then the date', () => {
    expect(baselineLabel(new Date(2026, 9, 25, 9, 0).getTime(), now)).toBe('earlier today');
    expect(baselineLabel(new Date(2026, 9, 24, 23, 0).getTime(), now)).toBe('yesterday');
    expect(baselineLabel(new Date(2026, 9, 20, 9, 0).getTime(), now)).toMatch(/20/);
  });
});

describe('useDeckSince', () => {
  const KEY = 'deck-since-v2';
  const start = ['Sol Ring', 'Forest', 'Command Tower'];

  it('shows nothing on first sight, then what an edit changed, then clears on dismiss', async () => {
    const { result, rerender } = renderHook(({ deck }) => useDeckSince(deck), {
      initialProps: { deck: makeDeck(start, ATRAXA) },
    });
    await waitFor(() => expect(localStorage.getItem(KEY)).not.toBeNull());
    expect(result.current).toBeNull();

    // Cut a land and add a ramp spell: the cut card is looked up by name.
    rerender({ deck: makeDeck(['Sol Ring', 'Forest', 'Cultivate'], ATRAXA) });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(
      result.current?.since.rows.map((r) => `${r.label} ${r.fromText} to ${r.toText}`)
    ).toEqual(['Lands 2 to 1']);
    expect(result.current?.since.added.map((c) => c.name)).toEqual(['Cultivate']);
    expect(result.current?.since.removed.map((c) => c.name)).toEqual(['Command Tower']);

    act(() => result.current?.dismiss());
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('keeps the unseen edits across a quick return and rolls the baseline after a long gap', async () => {
    const edited = makeDeck(['Sol Ring', 'Forest'], ATRAXA);
    const a = renderHook(({ deck }) => useDeckSince(deck), {
      initialProps: { deck: makeDeck(start, ATRAXA) },
    });
    await waitFor(() => expect(localStorage.getItem(KEY)).not.toBeNull());
    a.rerender({ deck: edited });
    await waitFor(() => expect(a.result.current).not.toBeNull());
    a.unmount();

    const b = renderHook(({ deck }) => useDeckSince(deck), { initialProps: { deck: edited } });
    await waitFor(() =>
      expect(b.result.current?.since.removed.map((c) => c.name)).toContain('Command Tower')
    );
    b.unmount();

    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + SESSION_GAP_MS + 60_000);
    const c = renderHook(({ deck }) => useDeckSince(deck), { initialProps: { deck: edited } });
    await act(async () => {});
    expect(c.result.current).toBeNull();
    spy.mockRestore();
  });

  it('shows no strip when only the classifiers moved: same cards, different stored numbers', async () => {
    const deck = makeDeck(start, ATRAXA);
    const cards = { [ATRAXA]: 1, 'Sol Ring': 1, Forest: 1, 'Command Tower': 1 };
    const old = {
      at: Date.now() - 1000,
      cards,
      commanders: [ATRAXA],
      metrics: { bracket: 1, clockTurn: 12 },
    };
    localStorage.setItem(KEY, JSON.stringify({ [deck.id]: { baseline: old, latest: old } }));
    const { result } = renderHook(() => useDeckSince(deck));
    await act(async () => {});
    expect(result.current).toBeNull();
  });
});
