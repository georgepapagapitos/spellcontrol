// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBinderLayoutInputs } from './use-binder-layout-inputs';
import { useCollectionStore } from '@/store/collection';
import { getSetMap, useSetMap } from '@/lib/api';
import type { BinderDef, EnrichedCard } from '@/types/index';

// Every binder surface (deck badges, card locations, Collection, the binder
// pages) lays out the collection with `materializeBinders`, memoized on the
// identity of these inputs. Built per hook instance, each surface got its own
// `allocatedCopyIds` and decorated `cards`, so the memo missed for every one of
// them, and a set map that started undefined on each mount made every surface
// lay the whole collection out twice: 14 layouts on one walk through Home,
// Collection, Binders, a binder, Decks and a deck, about 200 ms each at 4x CPU
// on a 9.7k-card collection (E1049). The same inputs must give the same
// references to every caller, from its first render.

afterEach(() => vi.unstubAllGlobals());

const card = (copyId: string, name: string) =>
  ({
    copyId,
    name,
    scryfallId: `sf-${name}`,
    setCode: 'tst',
    collectorNumber: '1',
  }) as unknown as EnrichedCard;

describe('useBinderLayoutInputs shares its derived inputs', () => {
  it('gives two instances the same cards and allocated ids', () => {
    useCollectionStore.setState({
      cards: [card('a', 'Sol Ring'), card('b', 'Sol Ring'), card('c', 'Arcane Signet')],
      // A spare-copies rule turns the decoration on, so `cards` is a derived array.
      binders: [
        {
          id: 'spares',
          name: 'Spares',
          filterGroups: [{ filter: { spareCopies: true } }],
          sorts: [],
        } as unknown as BinderDef,
      ],
    });
    const one = renderHook(() => useBinderLayoutInputs()).result.current;
    const two = renderHook(() => useBinderLayoutInputs()).result.current;
    expect(two.allocatedCopyIds).toBe(one.allocatedCopyIds);
    expect(two.cards).toBe(one.cards);
  });

  it('a mount after the set map loaded has it on its first render', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ sets: { TST: { code: 'tst' } } })))
    );
    await getSetMap();
    const renders: unknown[] = [];
    renderHook(() => {
      const map = useSetMap();
      renders.push(map);
      return map;
    });
    expect(renders[0]).toBeDefined();
  });
});
