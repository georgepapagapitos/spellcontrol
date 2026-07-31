// @vitest-environment happy-dom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ComboMatch, ComboMatchResponse } from '../types/combos';

const useDeckCombos = vi.fn();

vi.mock('../lib/use-deck-combos', () => ({
  useDeckCombos: (args: unknown) => useDeckCombos(args),
}));
vi.mock('../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('../lib/sync', () => ({ getSyncState: () => 'ready', onSyncedChange: () => () => {} }));
vi.mock('../components/shared/BrandMark', () => ({ BrandMark: () => null }));
vi.mock('../components/CardPreview', () => ({ CardPreview: () => null }));

// One commander-eligible legend (UB) so the host-commander line has something
// to find, plus a plain creature that must not qualify.
const cards = [
  {
    oracleId: 'o1',
    name: 'Kess, Dissident Mage',
    typeLine: 'Legendary Creature — Human Wizard',
    oracleText: '',
    legalities: { commander: 'legal' },
    colorIdentity: ['U', 'B'],
    purchasePrice: 0,
  },
  {
    oracleId: 'o2',
    name: 'Llanowar Elves',
    typeLine: 'Creature — Elf Druid',
    colorIdentity: ['G'],
    purchasePrice: 0,
  },
];
vi.mock('../store/collection', () => ({
  useCollectionStore: (sel: (s: unknown) => unknown) =>
    sel({ cards, binders: [], hydrating: false }),
}));
vi.mock('../store/auth', () => ({
  useAuth: (sel: (s: unknown) => unknown) => sel({ status: 'guest' }),
}));

import { CollectionCombosPage } from './CollectionCombosPage';

/** The host-commander asides link and navigate, so a Router is required. */
function renderPage() {
  return render(
    <MemoryRouter>
      <CollectionCombosPage />
    </MemoryRouter>
  );
}

function combo(id: string, name: string, missing: string[] = []): ComboMatch {
  return {
    combo: {
      id,
      identity: 'ub',
      produces: ['Infinite mana'],
      prerequisites: null,
      description: null,
      manaNeeded: null,
      popularity: 0,
      cardCount: 2,
      bracket: null,
      bracketTag: null,
      cards: [
        { oracleId: 'o1', cardName: name, quantity: 1 },
        { oracleId: 'ox', cardName: 'Partner Piece', quantity: 1 },
      ],
    },
    presentOracleIds: ['o1'],
    missingOracleIds: missing,
  };
}

function setResult(over: Partial<ComboMatchResponse>) {
  useDeckCombos.mockReturnValue({
    data: { inDeck: [], oneAway: [], almostInCollection: [], ...over },
    loading: false,
    error: null,
  });
}

describe('CollectionCombosPage', () => {
  beforeEach(() => {
    useDeckCombos.mockReset();
    setResult({});
  });

  it('sends no deck, so the matcher buckets against the collection', () => {
    renderPage();
    expect(useDeckCombos).toHaveBeenCalledWith(
      expect.objectContaining({ deckOracleIds: [], format: 'commander' })
    );
  });

  it('relabels the matcher\'s inDeck bucket as "Complete"', () => {
    setResult({ inDeck: [combo('c1', 'Owned Combo')] });
    renderPage();

    expect(screen.getByText('1 complete · 0 one away')).toBeTruthy();
    expect(screen.getByText(/Owned Combo/)).toBeTruthy();
    // Complete rows have no add CTA on this surface — there's no deck to add to.
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull();
  });

  it('shows almostInCollection under the one-away tab, counted in pieces owned', () => {
    setResult({ almostInCollection: [combo('c2', 'Near Miss', ['ox'])] });
    renderPage();

    expect(screen.getByText('0 complete · 1 one away')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /One card away/ }));

    expect(screen.getByText(/Near Miss/)).toBeTruthy();
    // Scope-specific copy: the deck panel says "in deck" here.
    expect(screen.getByLabelText('1 of 2 pieces in collection')).toBeTruthy();
  });

  it('names the commanders you own that could host a complete combo', () => {
    setResult({ inDeck: [combo('c1', 'Owned Combo')] });
    renderPage();

    // Kess is UB and the combo is 'ub' — Llanowar Elves (G, not legendary)
    // must not appear.
    expect(screen.getByText(/1 commander you own can run this/)).toBeTruthy();
    expect(screen.getByText(/Kess, Dissident Mage/)).toBeTruthy();
    expect(screen.queryByText(/Llanowar Elves/)).toBeNull();
  });

  it('filters the list by a card-name search', async () => {
    setResult({
      inDeck: [combo('c1', 'Owned Combo'), combo('c2', 'Other Combo')],
    });
    render(<CollectionCombosPage />);
    expect(screen.getByText(/Owned Combo/)).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: /Search combos/ }), {
      target: { value: 'Other' },
    });

    // The search is debounced, so the drop takes a beat.
    await waitFor(() => expect(screen.queryByText(/Owned Combo/)).toBeNull());
    expect(screen.getByText(/Other Combo/)).toBeTruthy();
  });

  it('says the filters hid the rows rather than claiming there are none', async () => {
    setResult({ inDeck: [combo('c1', 'Owned Combo')] });
    render(<CollectionCombosPage />);

    fireEvent.change(screen.getByRole('textbox', { name: /Search combos/ }), {
      target: { value: 'zzzz-no-such-card' },
    });

    await waitFor(() =>
      expect(screen.getByText('No combos match your search and filters.')).toBeTruthy()
    );
    // …and offers a way out.
    expect(screen.getByRole('button', { name: 'Clear search and filters' })).toBeTruthy();
  });

  it('hides the search row entirely when there is nothing to search', () => {
    setResult({});
    render(<CollectionCombosPage />);
    expect(screen.queryByRole('textbox', { name: /Search combos/ })).toBeNull();
  });

  it('prompts for cards when the collection has no combo-matchable ids', () => {
    setResult({});
    renderPage();
    expect(screen.getByText('No combos you can build outright yet.')).toBeTruthy();
  });
});
