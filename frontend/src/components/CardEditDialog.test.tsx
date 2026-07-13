// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CardEditDialog } from './CardEditDialog';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Finish } from '../types';
import type { ChangeOwnership } from '../lib/deck-change';

const fetchPrintingsMock = vi.fn();
vi.mock('../lib/api', () => ({
  fetchPrintings: (name: string) => fetchPrintingsMock(name),
  getSetMap: () => Promise.resolve({}),
}));

function printing(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'sf-a',
    oracle_id: 'oracle-sol',
    name: 'Sol Ring',
    cmc: 1,
    type_line: 'Artifact',
    color_identity: [],
    keywords: [],
    rarity: 'uncommon',
    set: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '270',
    finishes: ['nonfoil', 'foil'],
    prices: { usd: '1.50', usd_foil: '9.00' },
    legalities: { commander: 'legal' },
    ...overrides,
  } as ScryfallCard;
}

const current = printing(); // sf-a — the deck slot's current printing (unowned)
const ownedFoil = printing({
  id: 'sf-b',
  set: 'neo',
  set_name: 'Kamigawa: Neon Dynasty',
  collector_number: '123',
});

/** The deck-editor wiring under test: sf-b is owned, but only in foil. */
const resolveAvailability = (p: ScryfallCard): ChangeOwnership =>
  p.id === 'sf-b' ? 'owned' : 'unowned';
const resolveOwnedFinishes = (p: ScryfallCard): Finish[] => (p.id === 'sf-b' ? ['foil'] : []);

function renderDialog(onConfirm = vi.fn()) {
  render(
    <CardEditDialog
      cardName="Sol Ring"
      currentScryfallId="sf-a"
      currentFinish="nonfoil"
      resolveAvailability={resolveAvailability}
      resolveOwnedFinishes={resolveOwnedFinishes}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />
  );
  return onConfirm;
}

async function selectOwnedPrinting() {
  const row = (await screen.findByText('#123')).closest('button')!;
  fireEvent.click(row);
}

describe('CardEditDialog owned-finish awareness', () => {
  beforeEach(() => {
    fetchPrintingsMock.mockReset();
    fetchPrintingsMock.mockResolvedValue([current, ownedFoil]);
  });

  it('marks owned finishes on the printing row and the finish buttons', async () => {
    renderDialog();
    await selectOwnedPrinting();
    // Row tag carries the sr-only ownership note…
    expect(screen.getByText(/\(owned\)/)).toBeTruthy();
    // …and the finish button announces it.
    expect(screen.getByRole('button', { name: 'Foil — you own this finish' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Non-foil' })).toBeTruthy();
  });

  it('defaults to an owned finish when an owned printing is selected', async () => {
    renderDialog();
    await selectOwnedPrinting();
    const foilBtn = screen.getByRole('button', { name: 'Foil — you own this finish' });
    expect(foilBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('restricts the finish choice to owned finishes under "Owned only" and confirms it', async () => {
    const onConfirm = renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Owned only' }));
    await selectOwnedPrinting();
    // Only foil is owned → no finish toggle is offered at all.
    expect(screen.queryByRole('button', { name: 'Non-foil' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ finish: 'foil' }));
    expect(onConfirm.mock.calls[0][0].card.id).toBe('sf-b');
  });

  it('passes the explicitly chosen finish through onConfirm', async () => {
    const onConfirm = renderDialog();
    await selectOwnedPrinting();
    fireEvent.click(screen.getByRole('button', { name: 'Non-foil' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ finish: 'nonfoil' }))
    );
  });
});

describe('CardEditDialog mixed condition/language (E131)', () => {
  beforeEach(() => {
    fetchPrintingsMock.mockReset();
    fetchPrintingsMock.mockResolvedValue([current]);
  });

  function renderMixedDialog(onConfirm = vi.fn()) {
    render(
      <CardEditDialog
        cardName="Sol Ring"
        currentScryfallId="sf-a"
        currentFinish="nonfoil"
        quantity={4}
        details={{ condition: 'nm', language: 'en' }}
        mixedDetails={{ condition: '3 NM, 1 HP' }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    return onConfirm;
  }

  it("shows a Mixed placeholder for the non-uniform field instead of pre-filling one copy's value", async () => {
    renderMixedDialog();
    expect(await screen.findByText('Mixed (3 NM, 1 HP)')).toBeTruthy();
  });

  it('bumping quantity alone leaves the mixed field untouched (no per-copy overwrite signaled)', async () => {
    const onConfirm = renderMixedDialog();
    await screen.findByText('Mixed (3 NM, 1 HP)');
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const { details } = onConfirm.mock.calls[0][0];
    expect(details.conditionTouched).toBe(false);
    expect(details.condition).toBeUndefined();
  });

  it('explicitly picking a value for the mixed field marks it touched and sends the value', async () => {
    const onConfirm = renderMixedDialog();
    await screen.findByText('Mixed (3 NM, 1 HP)');
    fireEvent.click(screen.getByRole('button', { name: /Condition/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Heavily Played' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ condition: 'hp', conditionTouched: true }),
      })
    );
  });
});
