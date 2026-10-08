// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CardSearchPanel } from './CardSearchPanel';
import { CoachFeed, type CoachFeedProps } from './CoachFeed';
import { SimilarCardsStrip } from './SimilarCardsStrip';
import { SwapThisCard } from './SwapThisCard';
import { ATRAXA, hiddenOf, hideFromMenu, openDeck, pressUndo } from './dismiss-test-helpers';
import { toSwapAgainst, type Change } from '@/lib/coach/deck-change';
import { resetSuggestionLabelsForTests } from '@/lib/util/suggestion-labels';
import { useDecksStore } from '@/store/decks';
import type { GapAnalysisCard, HiddenGemRow, ScryfallCard } from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';

const sent = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('@/lib/util/analytics', async (orig) => ({
  ...(await orig<typeof import('@/lib/util/analytics')>()),
  track: () => {},
  sendBeaconPayload: (p: Record<string, unknown>) => sent.push(p),
  normalizePath: (p: string) => p,
}));
vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('./useCardCarousel', () => ({
  useCardCarousel: () => ({ open: vi.fn(), preview: null }),
}));
vi.mock('./use-deck-hover-peek', () => ({
  useDeckHoverPeek: () => ({ listHandlers: {}, peek: null }),
}));
vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/scryfall/client')>()),
  getCardByNameResilient: async (name: string) => ({ id: `id-${name}`, name }),
}));
vi.mock('./useSimilarCards', () => {
  const row = (name: string) => ({
    name,
    card: { name, cmc: 2, type_line: 'Sorcery' },
    ownership: 'owned',
    inclusion: 30,
    sharedAxes: [],
    freeCount: 1,
  });
  return {
    useSimilarCards: () => ({
      owned: [row('Cultivate')],
      discovery: [row('Farseek')],
      loading: false,
    }),
  };
});

let deckId = '';
beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
  resetSuggestionLabelsForTests();
  deckId = openDeck();
});

const labelsOf = (action: string) => sent.filter((p) => p.action === action);
const alt = (name: string): Change =>
  toSwapAgainst(
    { id: `fill-gaps:${name}`, type: 'add', lane: 'fill-gaps', name },
    'Rampant Growth'
  );
const undo = () => act(() => pressUndo());

describe('Swap this card: Not for this deck', () => {
  it('hides the row, labels a dismissal, and Undo restores it with an undo label', () => {
    render(
      <SwapThisCard
        currentName="Rampant Growth"
        alternatives={[alt('Cultivate'), alt('Farseek')]}
        onSwap={vi.fn()}
      />
    );
    hideFromMenu('Farseek');
    expect(screen.queryByRole('button', { name: 'Swap in Farseek' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Swap in Cultivate' })).toBeTruthy();
    expect(hiddenOf(deckId)).toEqual([{ name: 'Farseek', surface: 'swap' }]);
    expect(labelsOf('dismiss')).toEqual([
      expect.objectContaining({
        surface: 'swap',
        rank: 2,
        reason: 'fill-gaps',
        cmdr: ATRAXA,
        cardIn: 'Farseek',
        cardOut: 'Rampant Growth',
      }),
    ]);

    undo();
    expect(screen.getByRole('button', { name: 'Swap in Farseek' })).toBeTruthy();
    expect(hiddenOf(deckId)).toBeUndefined();
    expect(labelsOf('undo')).toEqual([
      expect.objectContaining({ surface: 'swap', cardIn: 'Farseek', cardOut: 'Rampant Growth' }),
    ]);
  });

  it('sends nothing but still hides when the player opted out of labels', () => {
    localStorage.setItem('sc-suggestion-labels', '0');
    render(
      <SwapThisCard currentName="Rampant Growth" alternatives={[alt('Farseek')]} onSwap={vi.fn()} />
    );
    hideFromMenu('Farseek');
    expect(sent).toEqual([]);
    expect(hiddenOf(deckId)).toHaveLength(1);
  });
});

describe('Similar cards: Not for this deck', () => {
  const renderStrip = () =>
    render(
      <SimilarCardsStrip
        target={{ name: 'Rampant Growth' } as ScryfallCard}
        deckCardNames={[]}
        collectionCards={[]}
        ownershipFor={() => 'owned'}
        freeCountFor={() => 1}
        identity={['G']}
        inclusionMap={{}}
        onSwap={vi.fn()}
        enabled
      />
    );

  it('hides the row from either group, labels it by rank across groups, and Undo restores it', () => {
    renderStrip();
    hideFromMenu('Farseek');
    expect(screen.queryByRole('button', { name: 'Swap in Farseek' })).toBeNull();
    expect(labelsOf('dismiss')).toEqual([
      expect.objectContaining({
        surface: 'similar',
        rank: 2,
        reason: 'similar',
        cardIn: 'Farseek',
        cardOut: 'Rampant Growth',
      }),
    ]);
    undo();
    expect(screen.getByRole('button', { name: 'Swap in Farseek' })).toBeTruthy();
    expect(labelsOf('undo')).toEqual([expect.objectContaining({ surface: 'similar' })]);
  });

  it('renders nothing once every similar card is hidden', () => {
    const { container } = renderStrip();
    hideFromMenu('Cultivate');
    hideFromMenu('Farseek');
    expect(container.querySelector('.similar-cards')).toBeNull();
  });
});

describe('Add panel: Not for this deck', () => {
  const gap = {
    name: 'Cultivate',
    role: 'ramp',
    roleLabel: 'Ramp',
    inclusion: 64,
  } as GapAnalysisCard;
  const gem = {
    name: 'Grave Pact',
    typeLine: 'Enchantment',
    price: null,
    signals: [],
  } as unknown as HiddenGemRow;
  const renderPanel = () =>
    render(
      <CardSearchPanel
        deckId={deckId}
        commanderColorIdentity={['W', 'U', 'B', 'G']}
        existingCardCounts={new Map()}
        atCopyLimit={() => false}
        onAdd={vi.fn()}
        enableSuggestions
        suggestions={[gap]}
        hiddenGems={[gem]}
        ownershipFor={() => 'owned'}
      />
    );

  it('labels a staple and a hidden gem by their own surface and Undo brings the row back', () => {
    renderPanel();
    hideFromMenu('Cultivate');
    hideFromMenu('Grave Pact');
    expect(labelsOf('dismiss')).toEqual([
      expect.objectContaining({
        surface: 'add-suggestions',
        reason: 'staple',
        cardIn: 'Cultivate',
      }),
      expect.objectContaining({
        surface: 'hidden-gems',
        reason: 'hidden-gem',
        cardIn: 'Grave Pact',
      }),
    ]);
    expect(screen.queryByRole('button', { name: 'Add Cultivate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add Grave Pact' })).toBeNull();
    undo();
    expect(screen.getByRole('button', { name: 'Add Grave Pact' })).toBeTruthy();
    expect(labelsOf('undo')).toEqual([expect.objectContaining({ surface: 'hidden-gems' })]);
  });

  it('lists what was hidden and restores it from the list', () => {
    renderPanel();
    hideFromMenu('Cultivate');
    fireEvent.click(screen.getByRole('button', { name: /Hidden for this deck \(1\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Show Cultivate again' }));
    expect(screen.getByRole('button', { name: 'Add Cultivate' })).toBeTruthy();
    expect(hiddenOf(deckId)).toBeUndefined();
    expect(labelsOf('undo')).toEqual([
      expect.objectContaining({ surface: 'add-suggestions', cardIn: 'Cultivate' }),
    ]);
    // Opened, then emptied: the panel stays and says so instead of vanishing.
    expect(screen.getByText(/Nothing hidden/)).toBeTruthy();
  });
});

describe('Coach feed: Not for this deck', () => {
  const heliod: ComboMatch = {
    combo: {
      id: 'combo-1',
      identity: 'W',
      produces: ['infinite damage'],
      prerequisites: null,
      description: null,
      manaNeeded: null,
      popularity: 100,
      cardCount: 2,
      bracket: 4,
      cards: [
        { oracleId: 'o1', cardName: 'Walking Ballista', quantity: 1 },
        { oracleId: 'o2', cardName: 'Heliod, Sun-Crowned', quantity: 1 },
      ],
    },
    presentOracleIds: ['o1'],
    missingOracleIds: ['o2'],
  };
  const props = (over: Partial<CoachFeedProps> = {}): CoachFeedProps => ({
    gaps: [
      { name: 'Cultivate', role: 'ramp', roleLabel: 'Ramp', inclusion: 64 } as GapAnalysisCard,
    ],
    synergy: [],
    substitutes: [],
    oneAwayCombos: [heliod],
    roleCounts: {},
    roleTargets: {},
    deckSize: 99,
    deckTarget: 99,
    bracketOverridePresent: false,
    resolveOwnership: () => undefined,
    ownedNames: new Set(),
    deckNames: new Set(),
    onApplyMove: vi.fn(),
    onApplyAllDropIns: vi.fn(),
    onConvergeBracket: vi.fn(),
    ownedOnly: false,
    onOwnedOnlyChange: vi.fn(),
    ...over,
  });

  it('hides the row, labels it with the lane the player was in, and Undo restores it', () => {
    render(<CoachFeed {...props()} />);
    hideFromMenu('Cultivate');
    expect(screen.queryByRole('button', { name: 'Add Cultivate' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Add Heliod/ })).toBeTruthy();
    expect(labelsOf('dismiss')).toEqual([
      expect.objectContaining({
        surface: 'coach:all',
        reason: 'fill-gaps',
        cmdr: ATRAXA,
        cardIn: 'Cultivate',
      }),
    ]);
    expect(JSON.stringify(sent)).not.toContain(deckId);
    undo();
    expect(screen.getByRole('button', { name: 'Add Cultivate' })).toBeTruthy();
    expect(labelsOf('undo')).toEqual([expect.objectContaining({ surface: 'coach:all' })]);
  });

  it('keeps a hidden suggestion hidden across a reload of the deck, and Show again brings it back', () => {
    const { unmount } = render(<CoachFeed {...props()} />);
    hideFromMenu('Cultivate');
    unmount();

    // The reload: the deck comes back from storage as plain JSON, nothing in memory.
    const stored = JSON.parse(JSON.stringify(useDecksStore.getState().decks));
    useDecksStore.setState({ decks: [] });
    useDecksStore.setState({ decks: stored });

    render(<CoachFeed {...props()} />);
    expect(screen.queryByRole('button', { name: 'Add Cultivate' })).toBeNull();
    const toggle = screen.getByRole('button', { name: /Hidden for this deck \(1\)/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Show Cultivate again' }));
    expect(screen.getByRole('button', { name: 'Add Cultivate' })).toBeTruthy();
  });

  it('does not change updatedAt: hiding a suggestion is not an edit to the deck', () => {
    const before = useDecksStore.getState().decks[0].updatedAt;
    render(<CoachFeed {...props()} />);
    hideFromMenu('Cultivate');
    expect(useDecksStore.getState().decks[0].updatedAt).toBe(before);
  });

  it('shows the way back even when everything is hidden', () => {
    render(<CoachFeed {...props({ oneAwayCombos: [] })} />);
    hideFromMenu('Cultivate');
    expect(screen.getByText(/Nothing to coach/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Hidden for this deck \(1\)/ })).toBeTruthy();
  });
});

describe('keyboard and a11y', () => {
  it('the ⋮ is a real, named button; the menu takes focus and Escape gives it back', () => {
    render(
      <SwapThisCard currentName="Rampant Growth" alternatives={[alt('Farseek')]} onSwap={vi.fn()} />
    );
    const trigger = screen.getByRole('button', { name: 'More actions for Farseek' });
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('aria-haspopup')).toBeTruthy();
    trigger.focus();
    fireEvent.click(trigger);
    const item = screen.getByRole('menuitem', { name: 'Not for this deck' });
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem')).toHaveLength(1);
    return waitFor(() => expect(document.activeElement).toBe(item)).then(() => {
      fireEvent.keyDown(item, { key: 'Escape' });
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  it('a right-click on the row opens the same menu', () => {
    const { container } = render(
      <SwapThisCard currentName="Rampant Growth" alternatives={[alt('Farseek')]} onSwap={vi.fn()} />
    );
    fireEvent.contextMenu(container.querySelector('.deck-card-row-body') as HTMLElement, {
      clientX: 20,
      clientY: 20,
    });
    expect(screen.getByRole('menuitem', { name: 'Not for this deck' })).toBeTruthy();
  });

  it('moves focus to the next row when the focused row is hidden', async () => {
    render(
      <SwapThisCard
        currentName="Rampant Growth"
        alternatives={[alt('Cultivate'), alt('Farseek')]}
        onSwap={vi.fn()}
      />
    );
    hideFromMenu('Cultivate');
    await waitFor(() =>
      expect((document.activeElement as HTMLElement | null)?.getAttribute('aria-label')).toBe(
        'Swap in Farseek'
      )
    );
  });
});
