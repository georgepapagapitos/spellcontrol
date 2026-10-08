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

/** The draft key of one of their printings: `oracleId|scryfallId|finish`. */
const RHYSTIC_A = 'o-Rhystic Study|sf-Rhystic Study-a|nonfoil';
const SOL_A = 'o-Sol Ring|sf-Sol Ring-a|nonfoil';
const SOL_B = 'o-Sol Ring|sf-Sol Ring-b|nonfoil';

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

    // Tapping a printing asks for THAT printing: the entry names it.
    expect(draft()?.get[RHYSTIC_A]).toEqual({
      name: 'Rhystic Study',
      oracleId: 'o-Rhystic Study',
      scryfallId: 'sf-Rhystic Study-a',
      finish: 'nonfoil',
      quantity: 1,
    });
    expect(screen.getByRole('button', { name: /^Review trade with Morgan. Get 1/ })).toBeTruthy();
    // The tile now offers the way back out, and says how many are in.
    const check = screen.getByRole('button', { name: /Take one Rhystic Study out of the trade/ });
    fireEvent.click(check);
    expect(draft()).toBeNull();
    expect(screen.queryByRole('button', { name: /^Review trade with Morgan/ })).toBeNull();
  });

  it('asks per printing and stops at what they really hold of that printing', () => {
    renderWorkspace();
    // Two Sol Rings in two printings: two tiles, each its own ask.
    const plus = screen.getAllByRole('button', { name: 'Ask for Sol Ring' });
    expect(plus).toHaveLength(2);
    fireEvent.click(plus[0]);
    expect(Object.keys(draft()?.get ?? {})).toEqual([SOL_A]);
    fireEvent.click(screen.getAllByRole('button', { name: /Take one Sol Ring out/ })[0]);
    expect(draft()).toBeNull();

    // Through the preview: Ask pins the previewed printing, and it is at its
    // ceiling at once, because they hold one copy of THIS printing.
    fireEvent.click(screen.getAllByRole('button', { name: /^Sol Ring/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Ask for this' }));
    expect(draft()?.get[SOL_A].quantity).toBe(1);
    expect(draft()?.get[SOL_B]).toBeUndefined();
    expect(
      (screen.getByRole('button', { name: 'One more in the trade' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(screen.getByText(/that's all Morgan has of this printing/)).toBeTruthy();
  });

  it('rings only the tile that was tapped, with nothing on the art', () => {
    renderWorkspace();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ask for Sol Ring' })[1]);

    // One printing asked for: one tile says so, the other still offers the "+".
    expect(screen.getAllByText('In trade · 1')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Ask for Sol Ring' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Take one Sol Ring out/ })).toHaveLength(1);
    expect(Object.keys(draft()?.get ?? {})).toEqual([SOL_B]);
    // The count is a caption, never a badge on the card face.
    for (const art of document.querySelectorAll('.collection-grid-item')) {
      expect(art.querySelector('.art-badge')).toBeNull();
    }
  });

  it('keeps two printings of one card as two entries, and counts both', () => {
    renderWorkspace();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ask for Sol Ring' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Ask for Sol Ring' })[0]);
    expect(Object.keys(draft()?.get ?? {}).sort()).toEqual([SOL_A, SOL_B]);
    expect(screen.getAllByText('In trade · 1')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^Review trade with Morgan. Get 2/ })).toBeTruthy();
  });

  it('prices a pinned ask exactly, from the printing that was tapped', () => {
    world.width = 1000;
    const cheap = { ...theirCard('Sol Ring', 'b'), purchasePrice: 0.5 };
    renderWorkspace({ theirCards: [theirCard('Sol Ring', 'a'), cheap] });
    fireEvent.click(screen.getAllByRole('button', { name: 'Ask for Sol Ring' })[1]);
    const dock = screen.getByRole('complementary', { name: /Trade with Morgan/ });
    expect(within(dock).getAllByText(/\$0\.50/).length).toBeGreaterThan(0);
    expect(within(dock).queryByText(/from \$/)).toBeNull();
  });

  it('asks for a card from its preview with "Ask for this"', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: /^Rhystic Study/ }));
    expect(screen.getByText(/Morgan has 1 of this printing/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask for this' }));
    expect(draft()?.get[RHYSTIC_A].quantity).toBe(1);
    expect(draft()?.get[RHYSTIC_A].scryfallId).toBe('sf-Rhystic Study-a');
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

  describe('picks a copy no deck holds before one a deck does', () => {
    // Three Mana Geysers of one printing; the cheapest is the one Goblin Storm uses.
    function seedGeysers() {
      world.cards = [
        owned('g1', 'Mana Geyser', 0.1),
        owned('g2', 'Mana Geyser', 0.4),
        owned('g3', 'Mana Geyser', 0.2),
      ];
      world.allocations = new Map<string, AllocationInfo>([
        ['g1', makeDeckAllocationInfo('d9', 'Goblin Storm', '#f00', 'Mana Geyser')],
      ]);
    }

    it('adds free copies with no question, and warns once only when none is left', () => {
      seedGeysers();
      renderWorkspace();
      openYours();
      expect(screen.getByText('1 spare')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Offer Mana Geyser' }));
      expect(screen.queryByRole('dialog', { name: 'Offer Mana Geyser?' })).toBeNull();
      expect(draft()?.give['o-Mana Geyser'].copyIds).toEqual(['g3']);

      // The second free copy, from the preview stepper.
      fireEvent.click(screen.getByRole('button', { name: /^Mana Geyser/ }));
      fireEvent.click(screen.getByRole('button', { name: 'One more in the trade' }));
      expect(screen.queryByRole('dialog', { name: 'Offer Mana Geyser?' })).toBeNull();
      expect(draft()?.give['o-Mana Geyser'].copyIds).toEqual(['g3', 'g2']);

      // Only the deck's copy is left: now it asks, naming the deck.
      fireEvent.click(screen.getByRole('button', { name: 'One more in the trade' }));
      const dialog = screen.getByRole('dialog', { name: 'Offer Mana Geyser?' });
      expect(within(dialog).getByText(/Mana Geyser is in Goblin Storm/)).toBeTruthy();
      expect(draft()?.give['o-Mana Geyser'].copyIds).toEqual(['g3', 'g2']);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Offer it anyway' }));
      expect(draft()?.give['o-Mana Geyser'].copyIds).toEqual(['g3', 'g2', 'g1']);
    });

    it('offers the printing on the tile, and "spare" never promises more than that tile gives', () => {
      // Printing X has one copy, and Goblin Storm holds it. Printing Y has two free copies.
      world.cards = [
        { ...owned('x1', 'Mana Geyser', 0.1), scryfallId: 'sf-x' },
        { ...owned('y1', 'Mana Geyser', 0.2), scryfallId: 'sf-y' },
        { ...owned('y2', 'Mana Geyser', 0.3), scryfallId: 'sf-y' },
      ];
      world.allocations = new Map<string, AllocationInfo>([
        ['x1', makeDeckAllocationInfo('d9', 'Goblin Storm', '#f00', 'Mana Geyser')],
      ]);
      renderWorkspace();
      openYours();

      // Tile X has nothing free: it says so rather than borrowing Y's spare.
      expect(screen.getByText('in 1 deck')).toBeTruthy();
      expect(screen.getByText('1 spare')).toBeTruthy();
      // The tile whose caption says so, whichever order the grid puts them in.
      const addOn = (caption: string) => {
        let node: HTMLElement | null = screen.getByText(caption);
        while (
          node &&
          node.querySelectorAll('button[aria-label="Offer Mana Geyser"]').length !== 1
        ) {
          node = node.parentElement;
        }
        return node!.querySelector('button[aria-label="Offer Mana Geyser"]') as HTMLElement;
      };
      const tileX = addOn('in 1 deck');
      const tileY = addOn('1 spare');
      // Tapping Y's "+" puts in a Y copy, with no question.
      fireEvent.click(tileY);
      expect(screen.queryByRole('dialog', { name: 'Offer Mana Geyser?' })).toBeNull();
      expect(draft()?.give['o-Mana Geyser'].copyIds).toEqual(['y1']);
      // Tapping X's "+" is the deck's copy of X, and it asks.
      fireEvent.click(tileX);
      expect(screen.getByRole('dialog', { name: 'Offer Mana Geyser?' })).toBeTruthy();
    });
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
    d.get['o-Rhystic Study'] = { name: 'Rhystic Study', oracleId: 'o-Rhystic Study', quantity: 1 };
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
