// @vitest-environment happy-dom
/**
 * T164 — the Breakdown drawer's Insights section (compact rows, hidden when
 * empty) and the flexible group-by/measure Breakdown card. ValueTrend is
 * mocked: it owns its own value-history IndexedDB store (a concurrent
 * session's file — see lib/value-history.ts) and isn't this file's concern.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EnrichedCard } from '../types';
import type { Deck } from '../store/decks';
import type { ScryfallCard } from '@/deck-builder/types';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { useCubeStore } from '../store/cube';
import { useCurrencyStore } from '../lib/currency';

vi.mock('./ValueTrend', () => ({ ValueTrend: () => null }));

import { StatsBar } from './StatsBar';

let seq = 0;
function mk(o: Partial<EnrichedCard> = {}): EnrichedCard {
  seq += 1;
  return {
    copyId: `copy-${seq}`,
    name: `Card ${seq}`,
    setCode: 'tst',
    setName: 'Test Set',
    collectorNumber: `${seq}`,
    rarity: 'common',
    scryfallId: `sf-${seq}`,
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    typeLine: 'Instant',
    colorIdentity: [],
    ...o,
  } as EnrichedCard;
}

function scryfallCard(overrides: Partial<ScryfallCard> & { name: string }): ScryfallCard {
  return {
    id: overrides.name,
    oracle_id: overrides.name,
    cmc: 1,
    type_line: 'Artifact',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test Set',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  } as ScryfallCard;
}

let deckSeq = 0;
function makeDeck(overrides: Partial<Deck> = {}): Deck {
  deckSeq += 1;
  return {
    id: `deck-${deckSeq}`,
    name: `Deck ${deckSeq}`,
    format: 'commander',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    considering: [],
    generationContext: null,
    color: '#888888',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Deck;
}

function renderDrawer(cards: EnrichedCard[], decks: Deck[] = []) {
  // StatsBar takes cards/binderDefs as props now (fed by CollectionPage's
  // useBinderLayoutInputs, decorated cards) rather than reading the store
  // itself — scryfallMisses is the one field it still reads directly.
  useCollectionStore.setState({ scryfallMisses: 0 });
  useDecksStore.setState({ decks });
  useCubeStore.setState({ saved: [] });
  const onClose = vi.fn();
  const onFilterJump = vi.fn();
  const { unmount } = render(
    <MemoryRouter>
      <StatsBar open cards={cards} binderDefs={[]} onClose={onClose} onFilterJump={onFilterJump} />
    </MemoryRouter>
  );
  return { onClose, onFilterJump, unmount };
}

beforeEach(() => {
  seq = 0;
  deckSeq = 0;
  useCurrencyStore.setState({ currency: 'USD' });
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('StatsBar — Insights section', () => {
  it('renders no Insights section when every insight has nothing to say', () => {
    renderDrawer([]);
    expect(screen.queryByText('Insights')).toBeNull();
  });

  it('shows the Spares row only once a card has a tradeable-surplus copy', () => {
    // Two unclaimed copies of the same name (no decks/cubes) → one spare.
    renderDrawer([
      mk({ name: 'Sol Ring', scryfallId: 'sf-sol', purchasePrice: 2 }),
      mk({ name: 'Sol Ring', scryfallId: 'sf-sol', purchasePrice: 1 }),
    ]);
    expect(screen.getByText('Insights')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Spares/ })).toBeTruthy();
  });

  it('tapping Spares applies the surplus filterJump', () => {
    const { onFilterJump } = renderDrawer([
      mk({ name: 'Sol Ring', scryfallId: 'sf-sol' }),
      mk({ name: 'Sol Ring', scryfallId: 'sf-sol' }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: /Spares/ }));
    expect(onFilterJump).toHaveBeenCalledWith({ kind: 'surplus' });
  });

  it('Idle cards leads with the idle value, is static, and carries a share bar', () => {
    const deck = makeDeck({
      cards: [
        {
          slotId: 's1',
          card: scryfallCard({ name: 'Bound Card' }),
          allocatedCopyId: 'bound-copy',
        },
      ],
    });
    renderDrawer(
      [
        mk({ name: 'Bound Card', copyId: 'bound-copy', purchasePrice: 3 }),
        mk({ name: 'Idle Card', purchasePrice: 8 }),
      ],
      [deck]
    );
    const row = screen.getByText('Idle cards').closest('.collection-insight-row');
    expect(row?.tagName).toBe('DIV'); // static, never a button/link
    expect(row?.textContent).toContain('$8 in 1 cards no deck uses');
    expect(row?.textContent).toContain('$3 in decks');
    expect(row?.querySelector('.meterbar')).toBeTruthy();
  });

  it('a shared-copies shortfall opens a sheet listing the wanting decks', () => {
    // Two decks want Sol Ring, only one copy is owned — a real shortfall
    // (shortfall = demand - owned = 2 - 1 = 1 > 0).
    const deckA = makeDeck({
      name: 'Deck A',
      cards: [{ slotId: 's1', card: scryfallCard({ name: 'Sol Ring' }), allocatedCopyId: null }],
    });
    const deckB = makeDeck({
      name: 'Deck B',
      cards: [{ slotId: 's1', card: scryfallCard({ name: 'Sol Ring' }), allocatedCopyId: null }],
    });
    renderDrawer([mk({ name: 'Sol Ring' })], [deckA, deckB]);
    fireEvent.click(screen.getByRole('button', { name: /wanted by more decks than you own/ }));
    expect(screen.getByRole('heading', { name: 'Shared copies' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Deck A' }).getAttribute('href')).toBe(
      `/decks/${deckA.id}`
    );
    expect(screen.getByRole('link', { name: 'Deck B' }).getAttribute('href')).toBe(
      `/decks/${deckB.id}`
    );
  });

  it('a single close-to-done deck links straight to that deck', () => {
    const deck = makeDeck({
      name: 'Krenko, Mob Boss',
      cards: [
        { slotId: 's1', card: scryfallCard({ name: 'Missing Card' }), allocatedCopyId: null },
      ],
    });
    renderDrawer([], [deck]);
    const row = screen.getByRole('link', { name: /close to done/ });
    expect(row.getAttribute('href')).toBe(`/decks/${deck.id}`);
  });
});

describe('StatsBar — grouped Breakdown card', () => {
  it('defaults to grouping by color', () => {
    renderDrawer([mk({ name: 'Plains', colorIdentity: ['W'] })]);
    expect(screen.getByText('White')).toBeTruthy();
  });

  it('switching group-by to Set shows set buckets instead', () => {
    renderDrawer([mk({ setCode: 'lea', setName: 'Alpha', colorIdentity: ['W'] })]);
    fireEvent.click(screen.getByRole('button', { name: /Group by/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Set' }));
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.queryByText('White')).toBeNull();
  });

  it('toggling the measure to Value switches the displayed number to money', () => {
    renderDrawer([mk({ colorIdentity: ['W'], purchasePrice: 12 })]);
    // Count measure: the row's count cell reads the raw count.
    expect(screen.getByText('White').closest('.breakdown-row-head')?.textContent).toContain('1');
    fireEvent.click(screen.getByRole('radio', { name: 'Value' }));
    expect(screen.getByText('$12')).toBeTruthy();
  });

  it('a color row applies its color filterJump in exact-match mode and closes', () => {
    const { onFilterJump } = renderDrawer([mk({ colorIdentity: ['W'] })]);
    fireEvent.click(screen.getByRole('button', { name: /White/ }));
    expect(onFilterJump).toHaveBeenCalledWith({ kind: 'color', key: 'W' });
  });

  it('persists the group-by/measure choice to localStorage and reloads it', () => {
    const first = renderDrawer([mk({ setCode: 'lea', setName: 'Alpha' })]);
    fireEvent.click(screen.getByRole('button', { name: /Group by/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Set' }));
    expect(localStorage.getItem('spellcontrol:collection-breakdown-group')).toBe('set');

    fireEvent.click(screen.getByRole('radio', { name: 'Value' }));
    expect(localStorage.getItem('spellcontrol:collection-breakdown-measure')).toBe('value');
    first.unmount();

    // A fresh mount picks the persisted choice back up.
    seq = 0;
    renderDrawer([mk({ setCode: 'lea', setName: 'Alpha', purchasePrice: 3 })]);
    expect(screen.getByText('$3')).toBeTruthy();
  });
});
