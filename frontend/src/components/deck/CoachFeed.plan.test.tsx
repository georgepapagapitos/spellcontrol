// @vitest-environment happy-dom
/**
 * The upgrade plan as the app wires it: DeckEditorLayout hands CoachFeed the
 * real handleApplyPlan, and CoachFeed (the sheet's only host) wraps it for the
 * suggestion labels. E1122: that wrapper once dropped the sheet's abort
 * signal, so closing the sheet mid-lookup still let the plan land after the
 * user had left.
 */
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GapAnalysisCard, ScryfallCard } from '@/deck-builder/types';
import { useDecksStore, type Deck } from '@/store/decks';
import { useDeckHistoryStore } from '@/store/deck-history';
import { useToastsStore } from '@/store/toasts';
import { setApplyingServer } from '@/lib/sync/applying-server';
import { resetSuggestionLabelsForTests, setSuggestionContext } from '@/lib/util/suggestion-labels';
import type { UpgradePlanTools } from '@/lib/coach/upgrade-plan-tools';
import { useDeckCoachApply } from '@/pages/deck-editor/use-deck-coach-apply';
import { CoachFeed, type CoachFeedProps } from './CoachFeed';

const sent = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('@/lib/util/analytics', () => ({
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
vi.mock('./use-missing-prices', () => ({
  useCardPriceLookup: () => ({ prices: new Map([['cultivate', 1]]), loaded: true }),
}));
vi.mock('@/lib/util/use-media-query', () => ({ useMediaQuery: () => true }));
const getCardsByNames = vi.fn();
vi.mock('@/deck-builder/services/scryfall/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/deck-builder/services/scryfall/client')>()),
  getCardsByNames: (...a: unknown[]) => getCardsByNames(...a),
}));
vi.mock('@/lib/sync', () => ({ persistDecksState: vi.fn().mockResolvedValue(undefined) }));

const card = (name: string) => ({ id: `sf-${name}`, name }) as unknown as ScryfallCard;
const DECK_CARDS = ['Sol Ring', 'Arcane Signet'];

const tools: UpgradePlanTools = {
  estimate: 2,
  current: 2,
  gameChangersInDeck: 0,
  isGameChanger: () => false,
  raisesBracket: () => false,
  estimateAfter: () => 2,
  weakestCuts: [],
  bracketReason: () => 'Raises the bracket',
  basics: 10,
  fetchers: 0,
};

const gap = {
  name: 'Cultivate',
  role: 'ramp',
  roleLabel: 'Ramp',
  inclusion: 64,
} as GapAnalysisCard;

const noop = () => {};

function feedProps(over: Partial<CoachFeedProps>): CoachFeedProps {
  return {
    gaps: [gap],
    synergy: [],
    substitutes: [],
    oneAwayCombos: [],
    roleCounts: {},
    roleTargets: {},
    // One open slot, so the plan's step is a fill: applied twice, the deck
    // would gain two copies.
    deckSize: 98,
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
    analysisState: 'ready',
    ...over,
  };
}

function Harness() {
  const [planOpen, setPlanOpen] = useState(true);
  const deck = useDecksStore((s) => s.decks.find((d) => d.id === 'd1'))!;
  const { handleApplyPlan } = useDeckCoachApply({
    deck,
    collectionCards: [],
    crossDeckMoves: [],
    deckIsFull: false,
    setPendingMove: noop,
    setPendingAdd: noop,
    setPendingAddPrinting: noop,
    setPendingAddGroup: noop,
    commitCrossDeckMove: async () => {},
    handleAddEngineCard: async () => {},
    handleCutEngineCard: noop,
    setPlanOpen,
  });
  return (
    <CoachFeed
      {...feedProps({
        upgradePlan: {
          deckId: deck.id,
          tools,
          open: planOpen,
          onOpenChange: setPlanOpen,
          onApply: handleApplyPlan,
        },
      })}
    />
  );
}

/** A lookup the test answers when it chooses. */
function deferredLookups() {
  const answers: Array<(cards: Map<string, ScryfallCard>) => void> = [];
  getCardsByNames.mockImplementation(
    () => new Promise<Map<string, ScryfallCard>>((resolve) => answers.push(resolve))
  );
  return (i: number) => answers[i](new Map([['Cultivate', card('Cultivate')]]));
}

const renderHarness = () =>
  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>
  );
const settle = () => new Promise((r) => setTimeout(r, 0));
const cards = () =>
  useDecksStore
    .getState()
    .decks.find((d) => d.id === 'd1')!
    .cards.map((c) => c.card.name);
const deckNames = () => useDecksStore.getState().decks.map((d) => d.name);
const planAccepts = () => sent.filter((p) => p.surface === 'coach:plan' && p.action === 'accept');
const applyButton = () => screen.getByRole('button', { name: 'Apply 1 swap' }) as HTMLButtonElement;
const closeWithEscape = () => {
  fireEvent.keyDown(document, { key: 'Escape' });
  // The modal's exit; happy-dom plays no animation of its own.
  const dialog = screen.queryByRole('dialog', { name: 'Upgrade plan' });
  if (dialog) fireEvent.animationEnd(dialog, { animationName: 'modal-panel-out' });
};

beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
  resetSuggestionLabelsForTests();
  setSuggestionContext({
    id: 'd1',
    commander: { name: 'Zimone', oracle_id: 'zimone-oracle' } as ScryfallCard,
    partnerCommander: null,
  });
  setApplyingServer(false);
  useDeckHistoryStore.getState().clear();
  useToastsStore.setState({ toasts: [] });
  getCardsByNames.mockReset();
  useDecksStore.setState({
    hydrated: true,
    decks: [
      {
        id: 'd1',
        name: 'Zimone',
        source: 'manual',
        format: 'commander',
        commander: null,
        partnerCommander: null,
        commanderAllocatedCopyId: null,
        partnerCommanderAllocatedCopyId: null,
        cards: DECK_CARDS.map((n, i) => ({
          slotId: `s${i}`,
          card: card(n),
          allocatedCopyId: null,
        })),
        sideboard: [],
        considering: [],
        generationContext: null,
        color: '#7a8a70',
        createdAt: 0,
        updatedAt: 0,
      } as unknown as Deck,
    ],
  });
});

describe('CoachFeed upgrade plan apply', () => {
  it('applies the plan once, then labels the accept', async () => {
    const answer = deferredLookups();
    renderHarness();
    fireEvent.click(applyButton());
    await waitFor(() => expect(getCardsByNames).toHaveBeenCalledTimes(1));
    expect(planAccepts()).toEqual([]);
    answer(0);
    await waitFor(() => expect(cards()).toEqual([...DECK_CARDS, 'Cultivate']));
    expect(planAccepts()).toHaveLength(1);
  });

  it.each([
    ['Escape', closeWithEscape],
    ['the header Close', () => fireEvent.click(screen.getByRole('button', { name: 'Close' }))],
  ])('closing with %s mid-lookup lands nothing when the lookup answers', async (_, leave) => {
    const answer = deferredLookups();
    renderHarness();
    fireEvent.click(applyButton());
    await waitFor(() => expect(getCardsByNames).toHaveBeenCalledTimes(1));

    leave();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Upgrade plan' })).toBeNull());
    answer(0);
    await settle();

    expect(cards()).toEqual(DECK_CARDS);
    expect(deckNames()).toEqual(['Zimone']);
    expect(useToastsStore.getState().toasts).toEqual([]);
    expect(useDeckHistoryStore.getState().undoLabel('d1')).toBeNull();
    expect(planAccepts()).toEqual([]);
  });

  it('closing an apply to a copy mid-lookup leaves no copy', async () => {
    const answer = deferredLookups();
    renderHarness();
    const copy = screen.getByRole('button', { name: 'Apply to a copy' }) as HTMLButtonElement;
    await waitFor(() => expect(copy.disabled).toBe(false));
    fireEvent.click(copy);
    await waitFor(() => expect(getCardsByNames).toHaveBeenCalledTimes(1));
    closeWithEscape();
    answer(0);
    await settle();
    expect(deckNames()).toEqual(['Zimone']);
    expect(useToastsStore.getState().toasts).toEqual([]);
    expect(planAccepts()).toEqual([]);
  });

  it('applies exactly once when the sheet is reopened and applied again mid-lookup', async () => {
    const answer = deferredLookups();
    renderHarness();
    fireEvent.click(applyButton());
    await waitFor(() => expect(getCardsByNames).toHaveBeenCalledTimes(1));
    closeWithEscape();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Upgrade plan' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /Upgrade plan/ }));
    fireEvent.click(applyButton());
    await waitFor(() => expect(getCardsByNames).toHaveBeenCalledTimes(2));

    answer(0); // the abandoned first apply answers first
    await settle();
    expect(cards()).toEqual(DECK_CARDS);
    answer(1);
    await waitFor(() => expect(cards()).toEqual([...DECK_CARDS, 'Cultivate']));
    await settle();
    expect(cards()).toEqual([...DECK_CARDS, 'Cultivate']);
    expect(planAccepts()).toHaveLength(1);
  });
});
