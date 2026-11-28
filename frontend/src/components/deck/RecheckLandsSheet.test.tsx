// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck } from '../../store/decks';

const recheckLands = vi.fn();
vi.mock('@/lib/deck/recheck-lands', () => ({
  recheckLands: (...a: unknown[]) => recheckLands(...a),
}));

// The apply tests drive the real apply path through this.
const getCardsByNames = vi.fn();
// The decks store persists through ./sync; nothing here reaches it.
vi.mock('@/lib/sync', () => ({ persistDecksState: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/deck-builder/services/scryfall/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/deck-builder/services/scryfall/client')>()),
  getCardsByNames: (...a: unknown[]) => getCardsByNames(...a),
}));

import { RecheckLandsSheet } from './RecheckLandsSheet';
import { pending } from '@/test/pending';
import { useDecksStore } from '@/store/decks';
import { useDeckHistoryStore } from '@/store/deck-history';
import { setApplyingServer } from '@/lib/sync/applying-server';
import {
  applyUpgradePlan,
  APPLY_LOOKUP_TIMEOUT_MESSAGE,
  APPLY_LOOKUP_TIMEOUT_MS,
} from '@/lib/coach/apply-upgrade-plan';

const land = (name: string) =>
  ({
    name,
    type_line: 'Land',
    image_uris: { normal: `https://cards.test/${name}.jpg` },
  }) as unknown as ScryfallCard;
const deck = {
  id: 'd1',
  name: 'Talrand',
  generationContext: { customization: { collectionStrategy: 'available' } },
} as unknown as Deck;

function renderSheet(onApply = vi.fn().mockResolvedValue(undefined)) {
  // StrictMode on purpose: an unmount flag that never re-armed dropped every result.
  render(
    <StrictMode>
      <RecheckLandsSheet
        deck={deck}
        env={{ collection: [], decks: [], cubes: [] }}
        ownershipFor={(n) => (n === 'Mystic Sanctuary' ? 'owned' : 'unowned')}
        onClose={vi.fn()}
        onApply={onApply}
      />
    </StrictMode>
  );
  return onApply;
}

beforeEach(() => {
  recheckLands.mockReset();
});

describe('RecheckLandsSheet', () => {
  it('runs on open and lists each swap, all checked, before anything changes', async () => {
    const swaps = [
      { out: land('Halimar Depths'), in: land('Mystic Sanctuary') },
      { out: land('Island'), in: land('Cavern of Souls') },
    ];
    recheckLands.mockResolvedValue({ swaps, kept: ['Reliquary Tower'], inclusion: {}, hidden: [] });
    const onApply = renderSheet();

    expect(screen.getByText(/Only lands you own that no other deck is using/)).toBeTruthy();
    await waitFor(() => screen.getByRole('button', { name: 'Apply 2 swaps' }));
    expect(screen.getByText('Replaces Halimar Depths')).toBeTruthy();
    expect(screen.getByText(/Kept the lands you added: Reliquary Tower/)).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Swap Island for Cavern of Souls' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 swap' }));
    await waitFor(() =>
      expect(onApply).toHaveBeenCalledWith([swaps[0]], [swaps[1]], expect.any(AbortSignal))
    );
  });

  it('says nothing changed when the picks are the same', async () => {
    recheckLands.mockResolvedValue({ swaps: [], kept: [], inclusion: {}, hidden: [] });
    renderSheet();
    await waitFor(() => screen.getByText(/No changes/));
    expect(screen.queryByRole('button', { name: /Apply/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('shows the error and retries', async () => {
    recheckLands.mockRejectedValueOnce(new Error("Couldn't load land picks for this commander."));
    recheckLands.mockResolvedValueOnce({ swaps: [], kept: [], inclusion: {}, hidden: [] });
    renderSheet();
    await waitFor(() => screen.getByRole('alert'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => screen.getByText(/No changes/));
  });

  // E1034: a swap declined last time stays out until asked for, comes back
  // unchecked, and is declined again unless the player checks it.
  it('hides swaps declined before, shows them unchecked on request, and reports declines', async () => {
    const offered = { out: land('Halimar Depths'), in: land('Mystic Sanctuary') };
    const declined = { out: land('Otawara, Soaring City'), in: land('Mana Confluence') };
    recheckLands.mockResolvedValue({
      swaps: [offered],
      kept: [],
      inclusion: {},
      hidden: [declined],
    });
    const onApply = renderSheet();

    await waitFor(() => screen.getByText('1 swap you turned down before is hidden.'));
    expect(screen.queryByText('Replaces Otawara, Soaring City')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show it' }));
    const box = screen.getByRole('checkbox', {
      name: 'Swap Otawara, Soaring City for Mana Confluence',
    }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 swap' }));
    await waitFor(() =>
      expect(onApply).toHaveBeenCalledWith([offered], [declined], expect.any(AbortSignal))
    );
  });

  // The swaps, applied the way DeckEditorOverlays applies them.
  const realApply = async (
    swaps: { out: ScryfallCard; in: ScryfallCard }[],
    _declined: unknown,
    signal: AbortSignal
  ) => {
    await applyUpgradePlan(
      deck.id,
      swaps.map((s) => ({ addName: s.in.name, cutName: s.out.name })),
      { signal }
    );
  };
  const oneSwap = () =>
    recheckLands.mockResolvedValue({
      swaps: [{ out: land('Halimar Depths'), in: land('Mystic Sanctuary') }],
      kept: [],
      inclusion: {},
      hidden: [],
    });
  const seedDeck = () => {
    setApplyingServer(false);
    useDeckHistoryStore.getState().clear();
    useDecksStore.setState({
      hydrated: true,
      decks: [
        {
          ...deck,
          cards: [{ slotId: 's0', card: land('Halimar Depths'), allocatedCopyId: null }],
        } as unknown as Deck,
      ],
    });
  };
  const deckCards = () => useDecksStore.getState().decks[0].cards.map((c) => c.card.name);

  // E1122 (replaces the E1121 hold): the apply's only wait is the card lookup
  // and nothing lands before it answers, so every exit stays live while it
  // runs. Leaving abandons the apply; the deck is untouched when it answers.
  it.each([
    ['browser Back', () => window.history.back()],
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['Cancel', () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
  ])('%s during the card lookup closes the sheet and changes nothing', async (_, leave) => {
    window.history.replaceState({ idx: 0 }, '', '/deck');
    oneSwap();
    seedDeck();
    let answer: (cards: Map<string, ScryfallCard>) => void = () => {};
    getCardsByNames.mockImplementation(
      () => new Promise<Map<string, ScryfallCard>>((resolve) => (answer = resolve))
    );
    const onClose = vi.fn();
    render(
      <RecheckLandsSheet
        deck={deck}
        env={{ collection: [], decks: [], cubes: [] }}
        ownershipFor={() => 'owned'}
        onClose={onClose}
        onApply={realApply}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Apply 1 swap' }));
    await waitFor(() => expect(getCardsByNames).toHaveBeenCalled());

    leave();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    answer(new Map([['Mystic Sanctuary', land('Mystic Sanctuary')]]));
    await new Promise((r) => setTimeout(r, 0));
    expect(deckCards()).toEqual(['Halimar Depths']);
    expect(useDeckHistoryStore.getState().undoLabel('d1')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // E1122: a user who waits gets the sheet back at the deadline, with the
  // reason by the button they pressed, gone once they change the swaps.
  it('says why by the Apply button when the card lookup never answers', async () => {
    oneSwap();
    seedDeck();
    getCardsByNames.mockImplementation(() => pending(new Map()));
    render(
      <RecheckLandsSheet
        deck={deck}
        env={{ collection: [], decks: [], cubes: [] }}
        ownershipFor={() => 'owned'}
        onClose={vi.fn()}
        onApply={realApply}
      />
    );
    const applyButton = (await screen.findByRole('button', {
      name: 'Apply 1 swap',
    })) as HTMLButtonElement;

    vi.useFakeTimers();
    try {
      fireEvent.click(applyButton);
      await vi.advanceTimersByTimeAsync(0);
      expect(applyButton.disabled).toBe(true);
      await vi.advanceTimersByTimeAsync(APPLY_LOOKUP_TIMEOUT_MS);
    } finally {
      vi.useRealTimers();
    }

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(APPLY_LOOKUP_TIMEOUT_MESSAGE);
    expect(alert.closest('.card-picker-footer')).not.toBeNull();
    expect(applyButton.disabled).toBe(false);
    expect(deckCards()).toEqual(['Halimar Depths']);

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Swap Halimar Depths for Mystic Sanctuary' })
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
