// @vitest-environment happy-dom
/**
 * Collection readiness (the % of a commander's staples you own) against an
 * empty collection read "0%" on every top-commander tile and "0 of 100 staples
 * owned" on the picked commander, and cost one EDHREC fetch per tile to say it.
 * With nothing owned there is nothing to measure, so none of it runs.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let collectionCards: { name: string; type_line?: string }[] = [];
// Stable references: a fresh array per selector call re-runs every effect keyed
// on it, forever.
const noHistory: unknown[] = [];
const collectionState = () => ({ cards: collectionCards, importHistory: noHistory });

const fetchCommanderData = vi.fn(async () => ({
  cardlists: { allNonLand: [{ name: 'Sol Ring' }, { name: 'Goblin Bombardment' }] },
}));
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchTopCommanders: vi.fn(async () => [
    {
      rank: 1,
      name: 'Krenko, Mob Boss',
      sanitized: 'krenko-mob-boss',
      colorIdentity: ['R'],
      numDecks: 100,
    },
    {
      rank: 2,
      name: 'Atraxa, Praetors’ Voice',
      sanitized: 'atraxa',
      colorIdentity: ['W', 'U', 'B', 'G'],
      numDecks: 90,
    },
  ]),
  fetchAllCommanderNames: vi.fn(async () => []),
  fetchCommandersIncludingColors: vi.fn(async () => []),
  fetchCommanderData: (...a: unknown[]) => fetchCommanderData(...(a as [])),
  fetchPlaystyleCommanders: vi.fn(async () => []),
}));
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  searchCommanders: vi.fn(async () => []),
  searchPdhCommanders: vi.fn(async () => []),
  getRandomPdhCommander: vi.fn(async () => null),
  getCardByName: vi.fn(async () => null),
  getOwnedPrinting: vi.fn(() => null),
}));
vi.mock('../../lib/aggregates-client', () => ({
  getCommanderStatsBatch: vi.fn(async () => new Map()),
}));
vi.mock('../../store/collection', () => ({
  useCollectionStore: (sel: (s: ReturnType<typeof collectionState>) => unknown) =>
    sel(collectionState()),
}));

import { CommanderSearch } from './CommanderSearch';

const noCards: { name: string }[] = [];
const someCards = [{ name: 'Sol Ring' }];

describe('CommanderSearch readiness', () => {
  beforeEach(() => {
    fetchCommanderData.mockClear();
    localStorage.clear();
  });

  it('measures nothing and shows no % when the collection is empty', async () => {
    collectionCards = noCards;
    render(<CommanderSearch value={null} onSelect={vi.fn()} />);
    await screen.findByText('Krenko, Mob Boss');
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchCommanderData).not.toHaveBeenCalled();
    expect(document.querySelector('.commander-search-item-readiness')).toBeNull();
  });

  it('still scores the top commanders against a real collection', async () => {
    collectionCards = someCards;
    render(<CommanderSearch value={null} onSelect={vi.fn()} />);
    await screen.findByText('Krenko, Mob Boss');
    await waitFor(() => expect(fetchCommanderData).toHaveBeenCalled());
  });
});
