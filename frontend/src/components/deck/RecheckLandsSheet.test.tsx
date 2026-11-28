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

// Only the stalled-apply test drives the real apply path through this.
const getCardsByNames = vi.fn();
vi.mock('@/deck-builder/services/scryfall/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/deck-builder/services/scryfall/client')>()),
  getCardsByNames: (...a: unknown[]) => getCardsByNames(...a),
}));

import { RecheckLandsSheet } from './RecheckLandsSheet';
import { pending } from '@/test/pending';
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
    await waitFor(() => expect(onApply).toHaveBeenCalledWith([swaps[0]], [swaps[1]]));
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
    await waitFor(() => expect(onApply).toHaveBeenCalledWith([offered], [declined]));
  });

  // E1121: the sheet is `dismissable={!applying}`. Browser Back used to close
  // it mid-apply anyway, because a sheet's Back path ignored `dismissable`.
  it('holds against browser Back while the swaps apply, and closes on Back once a failed apply frees it', async () => {
    window.history.replaceState({ idx: 0 }, '', '/deck');
    recheckLands.mockResolvedValue({
      swaps: [{ out: land('Halimar Depths'), in: land('Mystic Sanctuary') }],
      kept: [],
      inclusion: {},
      hidden: [],
    });
    // The apply fails, so the sheet stays open with `applying` back to false:
    // the one state where a Back after the apply has to be what closes it.
    let fail = () => {};
    const onApply = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          fail = () => reject(new Error('apply failed'));
        })
    );
    const onClose = vi.fn();
    render(
      <RecheckLandsSheet
        deck={deck}
        env={{ collection: [], decks: [], cubes: [] }}
        ownershipFor={() => 'owned'}
        onClose={onClose}
        onApply={onApply}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Apply 1 swap' }));
    await waitFor(() => expect(onApply).toHaveBeenCalled());

    window.history.back();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(window.location.pathname).toBe('/deck');

    fail();
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Apply 1 swap' }) as HTMLButtonElement).disabled
      ).toBe(false)
    );
    expect(onClose).not.toHaveBeenCalled();
    window.history.back();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  // E1122: every exit is locked while the swaps apply, and the card lookup
  // had no timeout, so one that never answered kept the sheet open for good.
  it('frees the sheet and says why when the card lookup never answers', async () => {
    recheckLands.mockResolvedValue({
      swaps: [{ out: land('Halimar Depths'), in: land('Mystic Sanctuary') }],
      kept: [],
      inclusion: {},
      hidden: [],
    });
    getCardsByNames.mockImplementation(() => pending(new Map()));
    const onClose = vi.fn();
    render(
      <RecheckLandsSheet
        deck={deck}
        env={{ collection: [], decks: [], cubes: [] }}
        ownershipFor={() => 'owned'}
        onClose={onClose}
        onApply={async (swaps) => {
          await applyUpgradePlan(
            deck.id,
            swaps.map((s) => ({ addName: s.in.name, cutName: s.out.name }))
          );
        }}
      />
    );
    const applyButton = (await screen.findByRole('button', {
      name: 'Apply 1 swap',
    })) as HTMLButtonElement;
    const cancel = () => screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;

    vi.useFakeTimers();
    try {
      fireEvent.click(applyButton);
      await vi.advanceTimersByTimeAsync(0);
      expect(cancel().disabled).toBe(true);
      await vi.advanceTimersByTimeAsync(APPLY_LOOKUP_TIMEOUT_MS);
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => expect(cancel().disabled).toBe(false));
    expect(screen.getByRole('alert').textContent).toBe(APPLY_LOOKUP_TIMEOUT_MESSAGE);
    expect(applyButton.disabled).toBe(false);
    fireEvent.click(cancel());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
