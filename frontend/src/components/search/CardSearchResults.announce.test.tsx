// @vitest-environment happy-dom
/**
 * E1008: the collection add-cards list (CardSearchResults, driven by
 * AddCardSearchPanel's input) speaks the same way as the deck's add-cards
 * panel. A settled result set says its count and the highlighted top row once,
 * a list of one is the "only result", the ends are reachable in one press,
 * and an arrow press inside the settle window wins over the count.
 */
import 'fake-indexeddb/auto';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { CardSearchResultsHandle } from '@/lib/search/use-results-keys';
import { useCollectionStore } from '@/store/collection';
import { CardSearchResults } from './CardSearchResults';

const card = (id: string, name: string): ScryfallCard =>
  ({
    id,
    name,
    set: 'ltr',
    set_name: 'The Lord of the Rings',
    collector_number: '1',
    finishes: ['nonfoil'],
    prices: {},
  }) as unknown as ScryfallCard;

const SOL = card('a', 'Sol Ring');
const ASH = card('b', 'Ash Barrens');
const TOMB = card('c', 'Ancient Tomb');

const live = () => document.querySelector('[aria-live="polite"]');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every non-empty text the live region shows, in order. */
function recordLive(): string[] {
  const seen: string[] = [];
  const node = live();
  if (!node) throw new Error('no live region');
  new MutationObserver(() => {
    const text = node.textContent ?? '';
    if (text) seen.push(text);
  }).observe(node, { childList: true, characterData: true, subtree: true });
  return seen;
}

function setup(results: ScryfallCard[], resultsFor?: string) {
  const ref = { current: null as CardSearchResultsHandle | null };
  const view = render(<CardSearchResults ref={ref} results={results} resultsFor={resultsFor} />);
  const rerender = (next: ScryfallCard[], nextFor?: string) =>
    view.rerender(<CardSearchResults ref={ref} results={next} resultsFor={nextFor} />);
  return { ref, rerender };
}

describe('CardSearchResults settled announcement (E1008)', () => {
  beforeEach(() => {
    useCollectionStore.setState({ cards: [] as never });
  });

  it('a settled set is spoken once: the count, then the top row', async () => {
    // An empty, unsearched list first, the way a host's first search lands.
    const { rerender } = setup([]);
    const seen = recordLive();
    rerender([SOL, ASH, TOMB], 'sol');
    await waitFor(() => expect(seen).toHaveLength(1), { timeout: 2000 });
    await wait(700);
    expect(seen).toEqual(['3 results. Sol Ring, 1 of 3. Enter adds it.']);
  });

  it('says "No results." when a settled query matched nothing, and nothing while it is pending', async () => {
    const { rerender } = setup([SOL, ASH], 'so');
    await waitFor(() => expect(live()?.textContent).toMatch(/^2 results\./), { timeout: 2000 });
    const seen = recordLive();
    rerender([SOL, ASH], undefined);
    await wait(800);
    expect(seen).toEqual([]);
    rerender([], 'zzz');
    await waitFor(() => expect(seen).toEqual(['No results.']), { timeout: 2000 });
  });

  it('a host with no keyboard wiring (no resultsFor) hears nothing on a refill', async () => {
    setup([SOL, ASH]);
    await wait(800);
    expect(live()?.textContent).toBe('');
  });

  it('a list of one is the only result, on the refill and on either arrow', async () => {
    const { ref } = setup([SOL], 'sol ring');
    await waitFor(() => expect(live()?.textContent).toBe('Sol Ring, only result. Enter adds it.'), {
      timeout: 2000,
    });
    const seen = recordLive();
    act(() => ref.current?.moveActive(1));
    await waitFor(() => expect(seen).toHaveLength(1));
    act(() => ref.current?.moveActive(-1));
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen).toEqual([
      'Sol Ring, only result. Enter adds it.',
      'Sol Ring, only result. Enter adds it.',
    ]);
  });

  it('jumps to the last and first rows', async () => {
    const { ref } = setup([SOL, ASH, TOMB]);
    await act(async () => {});
    const seen = recordLive();
    act(() => ref.current?.moveActive('last'));
    await waitFor(() => expect(seen).toHaveLength(1));
    act(() => ref.current?.moveActive('first'));
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen).toEqual([
      'Ancient Tomb, 3 of 3. Enter adds it.',
      'Sol Ring, 1 of 3. Enter adds it.',
    ]);
  });

  it('an arrow press inside the settle window wins: the count is dropped', async () => {
    const { ref } = setup([SOL, ASH, TOMB], 'a');
    await act(async () => {});
    const seen = recordLive();
    act(() => ref.current?.moveActive(1));
    await wait(900);
    expect(seen).toEqual(['Ash Barrens, 2 of 3. Enter adds it.']);
  });
});
