// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { BinderDef, EnrichedCard } from '../types';
import { useCollectionStore } from '../store/collection';
import { BinderEditor } from './BinderEditor';

/**
 * The editor's "N cards land here" has to route the OTHER binders the way
 * their own pages do. It used to add oracle tags only when the draft used
 * them, so a tag-rule binder above the draft matched nothing in the preview
 * and its cards read as landing in the draft: a new "$1+" binder built from
 * the Uncategorized sheet said 30 land here out of a 27-card pile.
 *
 * The store here holds the raw cards and the layout chain returns them tagged,
 * which is what the app does once the tag snapshot loads.
 */
const counterspell = {
  copyId: 'c-counter',
  scryfallId: 'sf-counter',
  oracleId: 'o-counter',
  name: 'Counterspell',
  typeLine: 'Instant',
  colorIdentity: ['U'],
  rarity: 'common',
  purchasePrice: 2,
  setCode: 'tst',
  collectorNumber: '1',
} as unknown as EnrichedCard;
const orchard = {
  ...counterspell,
  copyId: 'c-orchard',
  scryfallId: 'sf-orchard',
  oracleId: 'o-orchard',
  name: 'Exotic Orchard',
  typeLine: 'Land',
  colorIdentity: [],
  collectorNumber: '2',
} as unknown as EnrichedCard;
const tagged = [{ ...counterspell, tags: ['counterspell'] }, orchard];

const counters: BinderDef = {
  id: 'b-counters',
  name: 'Counters',
  position: 0,
  filterGroups: [
    {
      filter: {
        oracleTagChips: { chips: [{ value: 'counterspell', negate: false }], joiners: [] },
      },
    },
  ],
  sorts: [],
  pocketSize: 9,
  doubleSided: false,
  fixedCapacity: null,
  color: '#888',
  createdAt: 0,
  updatedAt: 0,
};

vi.mock('../lib/scryfall-catalog', () => ({
  fetchTypeSuggestions: async () => [],
  fetchOracleSuggestions: async () => [],
}));
vi.mock('../lib/card-tags', async (importActual) => ({
  ...(await importActual<typeof import('../lib/card-tags')>()),
  useCardTagsReady: () => true,
  useCardTagsError: () => false,
  useCardsWithTags: (cards: EnrichedCard[]) => cards,
}));
vi.mock('../lib/use-binder-layout-inputs', () => ({
  useBinderLayoutInputs: () => ({
    cards: tagged,
    binders: [counters],
    allocatedCopyIds: new Set(),
    setMap: undefined,
  }),
}));

describe('the rules editor routes the other binders like their own pages', () => {
  it('counts what a tag-rule binder above takes before the draft', () => {
    useCollectionStore.setState({ cards: [counterspell, orchard], binders: [counters] });
    render(<BinderEditor />);
    act(() => {
      useCollectionStore.setState({
        editingBinder: 'new',
        editingBinderSeed: { name: 'Cards worth $1+', groups: [{ filter: { priceMin: 1 } }] },
      });
    });
    const line = screen.getByText(/lands? here/).closest('strong')?.textContent ?? '';
    expect(line).toMatch(/^1 card lands here/);
    expect(screen.getByText(/go(es)? to Counters, above/)).toBeTruthy();
  });
});
