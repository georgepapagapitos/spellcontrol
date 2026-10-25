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
import { DeckSinceStrip } from './DeckSinceStrip';
import { useDeckSince } from './use-deck-since';
import { SESSION_GAP_MS } from '@/lib/deck/deck-since-store';
import { baselineLabel, buildSnapshot, diffSnapshots } from '@/lib/deck/deck-since';
import { makeDeck } from '@/lib/deck/deck-since.fixtures';

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
  it('shows nothing on first sight, then what an edit changed, then clears on dismiss', async () => {
    const first = makeDeck(['Sol Ring', 'Forest'], ATRAXA);
    const { result, rerender } = renderHook(({ deck }) => useDeckSince(deck), {
      initialProps: { deck: first },
    });
    await waitFor(() => expect(localStorage.getItem('deck-since-v1')).not.toBeNull());
    expect(result.current).toBeNull();

    rerender({ deck: makeDeck(['Sol Ring', 'Forest', 'Command Tower', 'Cultivate'], ATRAXA) });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(
      result.current?.since?.rows.map((r) => `${r.label} ${r.fromText} to ${r.toText}`)
    ).toEqual(['Lands 1 to 2']);
    expect(result.current?.since?.added.map((c) => c.name)).toEqual(['Command Tower', 'Cultivate']);

    act(() => result.current?.dismiss());
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('keeps the unseen edits across a quick return and rolls the baseline after a long gap', async () => {
    const base = makeDeck(['Sol Ring', 'Forest'], ATRAXA);
    const edited = makeDeck(['Sol Ring', 'Forest', 'Forest', 'Rhystic Study'], ATRAXA);
    const a = renderHook(({ deck }) => useDeckSince(deck), { initialProps: { deck: base } });
    await waitFor(() => expect(localStorage.getItem('deck-since-v1')).not.toBeNull());
    a.rerender({ deck: edited });
    await waitFor(() => expect(a.result.current).not.toBeNull());
    a.unmount();

    // Back within the gap: the same edits are still unseen.
    const b = renderHook(({ deck }) => useDeckSince(deck), { initialProps: { deck: edited } });
    await waitFor(() =>
      expect(b.result.current?.since?.added.map((c) => c.name)).toContain('Rhystic Study')
    );
    b.unmount();

    // Back after the gap: last session's end state is the baseline, so no change.
    const later = Date.now() + SESSION_GAP_MS + 60_000;
    const spy = vi.spyOn(Date, 'now').mockReturnValue(later);
    const c = renderHook(({ deck }) => useDeckSince(deck), { initialProps: { deck: edited } });
    await act(async () => {});
    expect(c.result.current).toBeNull();
    spy.mockRestore();
  });
});
