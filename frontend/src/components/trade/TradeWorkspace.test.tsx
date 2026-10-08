// @vitest-environment happy-dom
/**
 * The trade workspace end to end at component level: the "+" on a tile, the
 * preview's Ask, the Your cards side (ranked by what the friend wants, with
 * its captions and the once-only confirm), the first-pull window, the review
 * the URL opens, and dock versus tray by the host's width.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AllocationInfo } from '@/lib/collection/allocations-core';
import { makeDeckAllocationInfo } from '@/lib/collection/allocations-core';
import type { PublicCard } from '@/lib/social/shared-types';
import { emptyDraft } from '@/lib/trade/trade-draft';
import { useTradeDraftsStore } from '@/store/trade-drafts';
import type { EnrichedCard } from '@/types/index';

vi.mock('@/lib/api', async () => {
  const { pending } = await import('@/test/pending');
  return { getSetMap: () => pending({}) };
});
vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('@/lib/binder/use-binder-by-copy', () => ({ useBinderByCopyId: () => new Map() }));
vi.mock('@/lib/cards/card-tags', () => ({ getCardTags: () => [], useCardTagsReady: () => false }));
vi.mock('@/lib/trade/trade-value', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/trade/trade-value')>('@/lib/trade/trade-value');
  return { ...actual, useFloorPrices: () => ({ prices: new Map(), pending: false }) };
});

vi.mock('@/store/auth', () => ({
  useAuth: (sel: (s: unknown) => unknown) => sel({ status: 'authed', user: { id: 'viewer-1' } }),
}));

const world = vi.hoisted(() => ({
  cards: [] as unknown[],
  lists: [] as unknown[],
  allocations: new Map<string, unknown>(),
  awaiting: false,
  width: 0,
}));
vi.mock('@/store/collection', () => ({
  useCollectionStore: (sel: (s: unknown) => unknown) =>
    sel({ cards: world.cards, lists: world.lists, binders: [] }),
}));
vi.mock('@/lib/collection/allocations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/collection/allocations')>(
    '@/lib/collection/allocations'
  );
  return { ...actual, useAllocations: () => world.allocations };
});
vi.mock('@/lib/sync/use-awaiting-first-pull', () => ({
  useAwaitingFirstPull: () => world.awaiting,
}));
// happy-dom has no layout: the host's width is whatever the test says.
vi.mock('@/lib/util/use-element-width', () => ({
  useElementWidth: () => [() => {}, world.width],
}));

import { TradeWorkspace } from './TradeWorkspace';

const VIEWER = 'viewer-1';
const FRIEND = 'friend-1';

function theirCard(name: string, printing: string): PublicCard {
  return {
    name,
    oracleId: `o-${name}`,
    scryfallId: `sf-${name}-${printing}`,
    setCode: printing,
    setName: 'Set',
    collectorNumber: '1',
    rarity: 'rare',
    finish: 'nonfoil',
    foil: false,
    purchasePrice: 1,
    cmc: 1,
    typeLine: 'Artifact',
    spare: false,
    inDeck: false,
  };
}

function owned(copyId: string, name: string, price = 1): EnrichedCard {
  return {
    copyId,
    name,
    oracleId: `o-${name}`,
    setCode: 'cmr',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId: `sf-${name}`,
    purchasePrice: price,
    sourceCategory: 'manual',
    sourceFormat: 'manual',
    finish: 'nonfoil',
    foil: false,
  } as EnrichedCard;
}

// They have two Sol Rings (two printings), one Rhystic Study.
const THEIRS: PublicCard[] = [
  theirCard('Sol Ring', 'a'),
  theirCard('Sol Ring', 'b'),
  theirCard('Rhystic Study', 'a'),
];

// Mine: a spare Counterspell, a lone Ancient Tomb, a Rhystic Study held by a
// deck, and a spare Cultivate nobody asked for.
function seedMine() {
  world.cards = [
    owned('c1', 'Counterspell'),
    owned('c2', 'Counterspell', 2),
    owned('t1', 'Ancient Tomb'),
    owned('r1', 'Rhystic Study'),
    owned('v1', 'Cultivate'),
    owned('v2', 'Cultivate', 2),
  ];
  world.allocations = new Map<string, AllocationInfo>([
    ['r1', makeDeckAllocationInfo('d1', 'Esper Tempo', '#fff', 'Rhystic Study')],
  ]);
}

const FRIEND_WANTS = [
  { name: 'Ancient Tomb', oracleId: 'o-Ancient Tomb' },
  { name: 'Counterspell', oracleId: 'o-Counterspell' },
];

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function renderWorkspace(
  over: Partial<React.ComponentProps<typeof TradeWorkspace>> = {},
  at = '/hub'
) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route
          path="/hub"
          element={
            <>
              <TradeWorkspace
                friendId={FRIEND}
                friendName="Morgan"
                theirCards={THEIRS}
                onRetry={() => {}}
                isPrivate={false}
                friendWants={FRIEND_WANTS}
                onSent={() => {}}
                {...over}
              />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

const draft = () => useTradeDraftsStore.getState().getDraft(VIEWER, FRIEND);

function stubViewport() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  stubViewport();
  useTradeDraftsStore.setState({ drafts: {} });
  world.cards = [];
  world.lists = [];
  world.allocations = new Map();
  world.awaiting = false;
  world.width = 0;
  seedMine();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The tile buttons, in the order the grid shows them. */
function tileNames(): string[] {
  return [...document.querySelectorAll('.collection-grid-open')].map(
    (b) => (b.getAttribute('aria-label') ?? '').split(',')[0].split(' · ')[0]
  );
}

describe('TradeWorkspace: their cards', () => {
  it('adds a card to the draft with the "+" and shows the tray; the check takes it back out', () => {
    renderWorkspace();
    expect(screen.queryByRole('button', { name: /^Review trade with Morgan/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Ask for Rhystic Study' }));

    expect(draft()?.get['o-Rhystic Study']).toEqual({ name: 'Rhystic Study', quantity: 1 });
    expect(screen.getByRole('button', { name: /^Review trade with Morgan. Get 1/ })).toBeTruthy();
    // The tile now offers the way back out, and says how many are in.
    const check = screen.getByRole('button', { name: /Take one Rhystic Study out of the trade/ });
    fireEvent.click(check);
    expect(draft()).toBeNull();
    expect(screen.queryByRole('button', { name: /^Review trade with Morgan/ })).toBeNull();
  });

  it('counts a card across printings and stops at what they really have', () => {
    renderWorkspace();
    // Two Sol Rings in two printings: two tiles, one card in the trade.
    const plus = screen.getAllByRole('button', { name: 'Ask for Sol Ring' });
    expect(plus).toHaveLength(2);
    fireEvent.click(plus[0]);
    fireEvent.click(screen.getAllByRole('button', { name: /Take one Sol Ring out/ })[0]);
    expect(draft()).toBeNull();

    // Through the preview stepper: Ask, one more, and then it is at the ceiling.
    fireEvent.click(screen.getAllByRole('button', { name: /^Sol Ring/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Ask for this' }));
    expect(draft()?.get['o-Sol Ring'].quantity).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'One more in the trade' }));
    expect(draft()?.get['o-Sol Ring'].quantity).toBe(2);
    expect(
      (screen.getByRole('button', { name: 'One more in the trade' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(screen.getByText(/that's all Morgan has/)).toBeTruthy();
  });

  it('says the same true thing on every printing of a picked card, with nothing on the art', () => {
    renderWorkspace();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ask for Sol Ring' })[0]);

    // Seven tiles of one card would read as seven picked; they say "In trade · 1".
    expect(screen.getAllByText('In trade · 1')).toHaveLength(2);
    // The count is a caption, never a badge on the card face.
    for (const art of document.querySelectorAll('.collection-grid-item')) {
      expect(art.querySelector('.art-badge')).toBeNull();
    }
  });

  it('prices the ask from their own copies: the cheapest printing', () => {
    world.width = 1000;
    const cheap = { ...theirCard('Sol Ring', 'b'), purchasePrice: 0.5 };
    renderWorkspace({ theirCards: [theirCard('Sol Ring', 'a'), cheap] });
    fireEvent.click(screen.getAllByRole('button', { name: 'Ask for Sol Ring' })[0]);
    const dock = screen.getByRole('complementary', { name: /Trade with Morgan/ });
    expect(within(dock).getByText('from $0.50')).toBeTruthy();
  });

  it('asks for a card from its preview with "Ask for this"', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: /^Rhystic Study/ }));
    expect(screen.getByText(/Morgan has 1/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask for this' }));
    expect(draft()?.get['o-Rhystic Study'].quantity).toBe(1);
    // Once in, the action gives way to the stepper.
    expect(screen.queryByRole('button', { name: 'Ask for this' })).toBeNull();
  });

  it('marks a card the viewer wants', () => {
    world.lists = [
      {
        id: 'l1',
        name: 'Wants',
        order: 0,
        createdAt: 0,
        updatedAt: 0,
        entries: [{ id: 'e1', name: 'Rhystic Study', oracleId: 'o-Rhystic Study', quantity: 1 }],
      },
    ];
    renderWorkspace();
    expect(screen.getByText('You want')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^On my wants/ })).toBeTruthy();
  });

  it('says a private collection is private and points at the other side', () => {
    renderWorkspace({ theirCards: [], isPrivate: true });
    expect(screen.getByText('Morgan keeps their collection private.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pick from your cards' }));
    expect(screen.getByText('Counterspell')).toBeTruthy();
  });
});

describe('TradeWorkspace: your cards', () => {
  function openYours() {
    fireEvent.click(screen.getByRole('tab', { name: 'Your cards' }));
  }

  it('ranks what Morgan wants first, spares first within, and says what each card costs', () => {
    renderWorkspace();
    openYours();

    expect(tileNames()).toEqual([
      'Counterspell', // wanted and spare
      'Ancient Tomb', // wanted, your only copy
      'Cultivate', // not wanted, spare
      'Rhystic Study', // not wanted, in a deck
    ]);
    expect(screen.getAllByText('1 spare')).toHaveLength(2);
    expect(screen.getByText('your only copy')).toBeTruthy();
    expect(screen.getByText('in 1 deck')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sort' }).textContent).toContain(
      'Morgan wants first'
    );
    expect(screen.getByRole('button', { name: /^Morgan wants/ })).toBeTruthy();
  });

  it('puts the cheapest copy in with no question when it is a spare', () => {
    renderWorkspace();
    openYours();
    fireEvent.click(screen.getByRole('button', { name: 'Offer Counterspell' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(draft()?.give['o-Counterspell'].copyIds).toEqual(['c1']);
  });

  it('asks once before offering your only copy, and Cancel adds nothing', () => {
    renderWorkspace();
    openYours();
    fireEvent.click(screen.getByRole('button', { name: 'Offer Ancient Tomb' }));

    const dialog = screen.getByRole('dialog', { name: 'Offer Ancient Tomb?' });
    expect(within(dialog).getByText(/Ancient Tomb is your only copy/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(draft()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Offer Ancient Tomb' }));
    fireEvent.click(screen.getByRole('button', { name: 'Offer it anyway' }));
    expect(draft()?.give['o-Ancient Tomb'].copyIds).toEqual(['t1']);
  });

  it('names the deck when the copy is in one', () => {
    renderWorkspace();
    openYours();
    fireEvent.click(screen.getByRole('button', { name: 'Offer Rhystic Study' }));
    const dialog = screen.getByRole('dialog', { name: 'Offer Rhystic Study?' });
    expect(
      within(dialog).getByText(
        'Rhystic Study is in Esper Tempo. If Morgan accepts, that deck will need another copy.'
      )
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(draft()).toBeNull();
  });

  it('shows a loading state, never an empty one, while the first pull lands', () => {
    world.cards = [];
    world.awaiting = true;
    renderWorkspace();
    openYours();
    expect(screen.getByText('Getting your cards from your other devices…')).toBeTruthy();
    expect(screen.getByText(/keep picking from Morgan's side/)).toBeTruthy();
    expect(screen.queryByText(/collection is empty/i)).toBeNull();
  });
});

describe('TradeWorkspace: the review', () => {
  function seedDraft() {
    const d = emptyDraft(FRIEND, 'Morgan');
    d.get['o-Rhystic Study'] = { name: 'Rhystic Study', quantity: 1 };
    useTradeDraftsStore.getState().setDraft(VIEWER, FRIEND, d);
  }

  it('opens the review sheet when the URL says review=1, then drops the param', () => {
    seedDraft();
    renderWorkspace({}, '/hub?tab=collection&review=1');
    expect(screen.getByRole('dialog', { name: /Trade with Morgan/ })).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe('/hub?tab=collection');
  });

  it('keeps the sheet closed without the param, and opens it from the tray', () => {
    seedDraft();
    renderWorkspace();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Review trade with Morgan/ }));
    expect(screen.getByRole('dialog', { name: /Trade with Morgan/ })).toBeTruthy();
  });

  it('docks the review beside the grid when the host is wide, with no tray', () => {
    seedDraft();
    world.width = 1000;
    renderWorkspace();
    expect(screen.getByRole('complementary', { name: /Trade with Morgan/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Review trade with Morgan/ })).toBeNull();
  });

  it('uses the tray and sheet when the host is narrow', () => {
    seedDraft();
    world.width = 600;
    renderWorkspace();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.getByRole('button', { name: /^Review trade with Morgan/ })).toBeTruthy();
  });

  it('focuses the dock, with no sheet, when review=1 arrives on a wide host', () => {
    seedDraft();
    world.width = 1000;
    renderWorkspace({}, '/hub?review=1');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement?.className).toBe('trade-workspace-dock');
  });
});
