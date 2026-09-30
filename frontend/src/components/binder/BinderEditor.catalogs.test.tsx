// @vitest-environment happy-dom
/**
 * <BinderEditor/> is mounted in the Layout on every signed-in route. Its
 * Scryfall catalog fetch (eleven requests: eight type catalogs, three oracle
 * ones) must wait for the editor to actually open — the nightly journey
 * caught the unguarded version as a 429 burst on every screen (2026-09-09).
 */
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCollectionStore } from '@/store/collection';
import { BinderEditor } from './BinderEditor';

const fetchTypeSuggestions = vi.hoisted(() => vi.fn(async () => ['Creature', 'Elf']));
const fetchOracleSuggestions = vi.hoisted(() => vi.fn(async () => ['draw a card']));
vi.mock('@/lib/cards/scryfall-catalog', () => ({ fetchTypeSuggestions, fetchOracleSuggestions }));

describe('BinderEditor catalog loading', () => {
  beforeEach(() => {
    fetchTypeSuggestions.mockClear();
    fetchOracleSuggestions.mockClear();
    useCollectionStore.setState({
      editingBinder: null,
      editingBinderSeed: null,
      binders: [],
      cards: [],
    });
  });

  it('fetches nothing while closed, and both catalogs once it opens', async () => {
    render(<BinderEditor />);
    expect(fetchTypeSuggestions).not.toHaveBeenCalled();
    expect(fetchOracleSuggestions).not.toHaveBeenCalled();

    const now = Date.now();
    await act(async () => {
      useCollectionStore.setState({
        binders: [
          {
            id: 'b1',
            name: 'Elves',
            position: 0,
            filterGroups: [{ filter: {} }],
            sorts: [],
            pocketSize: 9,
            doubleSided: false,
            fixedCapacity: null,
            color: '#888',
            createdAt: now,
            updatedAt: now,
          },
        ],
        editingBinder: 'b1',
      });
    });
    expect(fetchTypeSuggestions).toHaveBeenCalledTimes(1);
    expect(fetchOracleSuggestions).toHaveBeenCalledTimes(1);
  });
});
