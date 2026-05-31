// @vitest-environment happy-dom
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCardCarousel, type CarouselEntry } from './useCardCarousel';
import { useCollectionStore } from '@/store/collection';
import { scryfallToEnrichedCard } from '@/lib/scryfall-to-enriched';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard, Finish } from '@/types';

// The hook resolves name-only entries through the scryfall client; mock it so the
// test stays offline and deterministic.
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardByName: vi.fn(),
}));

// Capture the cards CardPreview is handed so we can assert the finish the hook
// resolved without depending on the real (DOM-heavy) preview component.
const previewCards = vi.fn<(cards: EnrichedCard[]) => void>();
vi.mock('@/components/CardPreview', () => ({
  CardPreview: ({ cards }: { cards: EnrichedCard[] }) => {
    previewCards(cards);
    return null;
  },
}));

function scry(name: string, oracleId: string): ScryfallCard {
  return {
    id: `print-${name}`,
    oracle_id: oracleId,
    name,
    set: 'tst',
    set_name: 'Test',
    collector_number: '1',
    rarity: 'rare',
    finishes: ['nonfoil', 'foil', 'etched'],
  } as unknown as ScryfallCard;
}

function owned(name: string, oracleId: string, finish: Finish): EnrichedCard {
  return scryfallToEnrichedCard(scry(name, oracleId), finish);
}

beforeEach(() => {
  useCollectionStore.setState({ cards: [] });
  previewCards.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
  useCollectionStore.setState({ cards: [] });
});

async function openAndCapture(entries: CarouselEntry[], tapped: string): Promise<EnrichedCard> {
  const { result } = renderHook(() => useCardCarousel('Test Binder'));
  await act(async () => {
    await result.current.open(entries, tapped);
  });
  // Actually mount the preview element so the mocked CardPreview runs and
  // captures the `cards` prop the hook resolved.
  expect(result.current.preview).not.toBeNull();
  render(result.current.preview);
  const lastCall = previewCards.mock.calls.at(-1);
  expect(lastCall).toBeDefined();
  const cards = lastCall![0];
  const card = cards.find((c) => c.name === tapped);
  expect(card).toBeDefined();
  return card!;
}

describe('useCardCarousel ownership shimmer', () => {
  it('resolves an owned-foil card with the foil finish', async () => {
    useCollectionStore.setState({ cards: [owned('Sol Ring', 'oracle-sol', 'foil')] });
    const card = await openAndCapture(
      [{ name: 'Sol Ring', label: '1 copy', card: scry('Sol Ring', 'oracle-sol') }],
      'Sol Ring'
    );
    expect(card.finish).toBe('foil');
    expect(card.foil).toBe(true);
  });

  it('prefers foil over etched when both are owned', async () => {
    useCollectionStore.setState({
      cards: [owned('Sol Ring', 'oracle-sol', 'etched'), owned('Sol Ring', 'oracle-sol', 'foil')],
    });
    const card = await openAndCapture(
      [{ name: 'Sol Ring', label: '2 copies', card: scry('Sol Ring', 'oracle-sol') }],
      'Sol Ring'
    );
    expect(card.finish).toBe('foil');
  });

  it('uses etched when only an etched copy is owned', async () => {
    useCollectionStore.setState({ cards: [owned('Sol Ring', 'oracle-sol', 'etched')] });
    const card = await openAndCapture(
      [{ name: 'Sol Ring', label: '1 copy', card: scry('Sol Ring', 'oracle-sol') }],
      'Sol Ring'
    );
    expect(card.finish).toBe('etched');
  });

  it('keeps an unowned card nonfoil', async () => {
    // Collection has a different card → no oracleId match → no shimmer.
    useCollectionStore.setState({ cards: [owned('Counterspell', 'oracle-cs', 'foil')] });
    const card = await openAndCapture(
      [{ name: 'Sol Ring', label: '1 copy', card: scry('Sol Ring', 'oracle-sol') }],
      'Sol Ring'
    );
    expect(card.finish).toBe('nonfoil');
    expect(card.foil).toBe(false);
  });

  it('stays nonfoil when only a nonfoil copy is owned', async () => {
    useCollectionStore.setState({ cards: [owned('Sol Ring', 'oracle-sol', 'nonfoil')] });
    const card = await openAndCapture(
      [{ name: 'Sol Ring', label: '1 copy', card: scry('Sol Ring', 'oracle-sol') }],
      'Sol Ring'
    );
    expect(card.finish).toBe('nonfoil');
  });

  it('falls back to name match when the resolved card has no oracleId', async () => {
    // Resolved card has no oracleId (legacy/edge), so matching must fall back to
    // the card name. The owned foil copy still shimmers.
    const noOracleScry = {
      ...scry('Sol Ring', ''),
      oracle_id: undefined,
    } as unknown as ScryfallCard;
    useCollectionStore.setState({
      cards: [scryfallToEnrichedCard(noOracleScry, 'foil')],
    });
    const card = await openAndCapture(
      [{ name: 'Sol Ring', label: '1 copy', card: noOracleScry }],
      'Sol Ring'
    );
    expect(card.finish).toBe('foil');
  });
});
