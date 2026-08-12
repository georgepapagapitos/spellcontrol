// @vitest-environment happy-dom
/**
 * TradeComposer's card preview — the affordance split.
 *
 * The give-side result row used to be ONE row-wide button that added the card.
 * It is now two siblings: the thumbnail previews, everything else adds. These
 * tests pin both halves (a regression here either steals the add target or
 * silently adds a card when you only wanted to look at it), and pin WHICH set
 * each entry point walks — a result row shows that side's results, a picked
 * row shows the whole deal.
 *
 * No `@testing-library/jest-dom` in this repo — plain vitest matchers.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnrichedCard } from '../../types';
import type { FriendCard } from '../../lib/cube/pool';

vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('../../lib/trade-value', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/trade-value')>('../../lib/trade-value');
  return { ...actual, useFloorPrices: () => ({ prices: new Map(), pending: false }) };
});
vi.mock('../../lib/use-binder-by-copy', () => ({ useBinderByCopyId: () => new Map() }));
vi.mock('../../lib/card-tags', () => ({ getCardTags: () => [], useCardTagsReady: () => false }));

let storeState: { cards: EnrichedCard[] } = { cards: [] };
vi.mock('../../store/collection', () => ({
  useCollectionStore: (sel: (s: unknown) => unknown) => sel(storeState),
}));
vi.mock('../../store/decks', () => ({
  useDecksStore: (sel: (s: unknown) => unknown) => sel({ decks: [] }),
}));
vi.mock('../../store/cube', () => ({
  useCubeStore: (sel: (s: unknown) => unknown) => sel({ saved: [] }),
}));

// The ask side and the deal resolve through the network; the give side must
// NOT (its cards are already owned and enriched). Returning only the cards it
// was asked for is what lets a test assert which SET was opened.
const resolveTradePreview = vi.fn();
vi.mock('../../lib/trade-preview', () => ({
  resolveTradePreview: (cards: { name: string; oracleId: string }[]) => resolveTradePreview(cards),
}));

// CardPreview itself is covered by its own tests; here we only care that the
// right slides opened at the right index, and that the action button works.
const previewProps = vi.fn();
vi.mock('../CardPreview', () => ({
  CardPreview: (props: {
    cards: { name: string }[];
    index: number;
    getActions?: (i: number) => { key: string; label: string; onClick: () => void }[];
  }) => {
    previewProps(props);
    const actions = props.getActions?.(props.index) ?? [];
    return (
      <div data-testid="preview">
        <span data-testid="preview-slide">{props.cards[props.index]?.name}</span>
        <span data-testid="preview-all">{props.cards.map((c) => c.name).join(',')}</span>
        {actions.map((a) => (
          <button key={a.key} type="button" onClick={a.onClick}>
            {`preview-${a.label}`}
          </button>
        ))}
      </div>
    );
  },
}));

import { TradeComposer } from './TradeComposer';

function owned(over: Partial<EnrichedCard> & { copyId: string; name: string }): EnrichedCard {
  return {
    setCode: 'cmr',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId: `scry-${over.copyId}`,
    purchasePrice: 1,
    sourceCategory: 'manual',
    sourceFormat: 'manual',
    finish: 'nonfoil',
    foil: false,
    ...over,
  } as EnrichedCard;
}

const FRIEND_CARDS: FriendCard[] = [
  { name: 'Rhystic Study', oracleId: 'o-rhystic', colors: ['U'], cmc: 3, typeLine: 'Enchantment' },
];

function renderComposer(extra: Partial<Parameters<typeof TradeComposer>[0]> = {}) {
  return render(
    <TradeComposer
      friendId="friend-1"
      friendName="Trade Pal"
      friendCards={FRIEND_CARDS}
      friendCardsLoading={false}
      friendWants={null}
      onClose={() => {}}
      onSent={() => {}}
      {...extra}
    />
  );
}

/** The give side's results list, which is the second "pick a card" list. */
function giveResults() {
  return screen.getByRole('list', { name: /You give — pick a card/i });
}

beforeEach(() => {
  previewProps.mockClear();
  resolveTradePreview.mockReset();
  storeState = {
    cards: [
      owned({ copyId: 'a', name: 'Arcane Signet', oracleId: 'o-signet' }),
      owned({ copyId: 'b', name: 'Sol Ring', oracleId: 'o-sol' }),
    ],
  };
});

describe('TradeComposer — give-side result row split', () => {
  it('the thumbnail previews without adding the card', () => {
    renderComposer();
    const row = within(giveResults()).getByRole('button', { name: 'Preview Sol Ring' });
    fireEvent.click(row);

    expect(screen.getByTestId('preview-slide').textContent).toBe('Sol Ring');
    // Nothing entered the basket — the whole point of carving the thumb out.
    expect(screen.queryByRole('list', { name: /You give — chosen cards/i })).toBeNull();
    // The give side never hits the network: these copies are already owned.
    expect(resolveTradePreview).not.toHaveBeenCalled();
  });

  it('the rest of the row still adds, and does not open the preview', () => {
    renderComposer();
    fireEvent.click(within(giveResults()).getByRole('button', { name: 'Add Sol Ring' }));

    const basket = screen.getByRole('list', { name: /You give — chosen cards/i });
    expect(within(basket).getByText('Sol Ring')).toBeTruthy();
    expect(screen.queryByTestId('preview')).toBeNull();
  });

  it('walks that side’s whole results list, opening on the tapped card', () => {
    renderComposer();
    fireEvent.click(within(giveResults()).getByRole('button', { name: 'Preview Sol Ring' }));

    // Both owned lines are slides, alphabetical as the list renders them, and
    // the tapped one is the open slide — not slide 0.
    expect(screen.getByTestId('preview-all').textContent).toBe('Arcane Signet,Sol Ring');
    expect(screen.getByTestId('preview-slide').textContent).toBe('Sol Ring');
  });

  it('the preview carries Add, and it adds the card the slide is showing', () => {
    renderComposer();
    fireEvent.click(within(giveResults()).getByRole('button', { name: 'Preview Sol Ring' }));
    fireEvent.click(screen.getByRole('button', { name: 'preview-Add' }));

    const basket = screen.getByRole('list', { name: /You give — chosen cards/i });
    expect(within(basket).getByText('Sol Ring')).toBeTruthy();
    expect(within(basket).queryByText('Arcane Signet')).toBeNull();
  });
});

describe('TradeComposer — a picked row opens the DEAL', () => {
  it('spans both baskets, and carries no action button', async () => {
    resolveTradePreview.mockImplementation((cards: { name: string; oracleId: string }[]) => {
      const slides = cards.map((c) => ({ name: c.name }));
      return Promise.resolve({
        cards: slides,
        indexOf: (card: { name: string }) => slides.findIndex((s) => s.name === card.name),
      });
    });
    renderComposer({ initialWant: { oracleId: 'o-rhystic', name: 'Rhystic Study' } });

    // Put one of ours in too, so the deal has both sides.
    fireEvent.click(within(giveResults()).getByRole('button', { name: 'Add Sol Ring' }));
    const basket = screen.getByRole('list', { name: /You give — chosen cards/i });
    fireEvent.click(within(basket).getByRole('button', { name: 'Preview Sol Ring' }));

    expect(await screen.findByTestId('preview')).toBeTruthy();
    // Give side then get side, in reading order — #1560's ruling.
    expect(screen.getByTestId('preview-all').textContent).toBe('Sol Ring,Rhystic Study');
    expect(screen.getByTestId('preview-slide').textContent).toBe('Sol Ring');
    // Editing one card while reading a set would be incoherent.
    expect(screen.queryByRole('button', { name: 'preview-Add' })).toBeNull();
  });

  it('maps the tapped card through indexOf, so a DROPPED card cannot shift the slide', async () => {
    // The give card resolves nowhere (an unresolvable printing) and is
    // dropped; the ask card must still open on ITSELF, not on slide 0's
    // neighbour. A positional assumption fails this.
    resolveTradePreview.mockImplementation((cards: { name: string; oracleId: string }[]) => {
      const kept = cards.filter((c) => c.name !== 'Sol Ring').map((c) => ({ name: c.name }));
      return Promise.resolve({
        cards: kept,
        indexOf: (card: { name: string }) => kept.findIndex((s) => s.name === card.name),
      });
    });
    renderComposer({ initialWant: { oracleId: 'o-rhystic', name: 'Rhystic Study' } });

    fireEvent.click(within(giveResults()).getByRole('button', { name: 'Add Sol Ring' }));
    const wantBasket = screen.getByRole('list', { name: /You get — chosen cards/i });
    fireEvent.click(within(wantBasket).getByRole('button', { name: 'Preview Rhystic Study' }));

    expect(await screen.findByTestId('preview')).toBeTruthy();
    expect(screen.getByTestId('preview-all').textContent).toBe('Rhystic Study');
    expect(screen.getByTestId('preview-slide').textContent).toBe('Rhystic Study');
  });
});
