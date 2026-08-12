// @vitest-environment happy-dom
/**
 * TradeAcceptDialog — the surface that mutates a collection.
 *
 * These tests pin the dialog's own contract, which the libs under it cannot:
 * it opens pre-filled with the exact cheapest-first pick the unattended path
 * would send (so confirming changes NOTHING), the short-line gate blocks a
 * deal the server would reject anyway, switching printings is one tap thanks
 * to the auto-balance, and the confirmed payload is the wire shape — printings
 * only, never a copyId.
 *
 * No `@testing-library/jest-dom` in this repo — plain vitest matchers.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnrichedCard } from '../../types';
import type { TradeCard } from '../../lib/trades-client';

vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('../../lib/use-binder-by-copy', () => ({ useBinderByCopyId: () => new Map() }));
vi.mock('../../store/decks', () => ({
  useDecksStore: (sel: (s: unknown) => unknown) => sel({ decks: [] }),
}));
vi.mock('../../store/cube', () => ({
  useCubeStore: (sel: (s: unknown) => unknown) => sel({ saved: [] }),
}));
vi.mock('../../lib/trade-preview', () => ({ resolveTradePreview: vi.fn() }));
vi.mock('../CardPreview', () => ({ CardPreview: () => null }));

import { TradeAcceptDialog, type AcceptChoice } from './TradeAcceptDialog';

function copyOf(over: Partial<EnrichedCard> & { copyId: string }): EnrichedCard {
  return {
    name: 'Sol Ring',
    oracleId: 'o-sol',
    setName: 'Set',
    rarity: 'rare',
    sourceCategory: 'manual',
    sourceFormat: 'manual',
    finish: 'nonfoil',
    foil: false,
    ...over,
  } as EnrichedCard;
}

// Beta FIRST in collection order, so a correct seed must sort, not slice.
const beta = copyOf({
  copyId: 'beta',
  scryfallId: 'scry-lea',
  setCode: 'lea',
  collectorNumber: '233',
  purchasePrice: 500,
});
const cheap = copyOf({
  copyId: 'cheap',
  scryfallId: 'scry-cmd',
  setCode: 'cmd',
  collectorNumber: '120',
  purchasePrice: 2,
});

function makeChoices(): AcceptChoice[] {
  return [
    {
      asked: { oracleId: 'o-sol', name: 'Sol Ring', quantity: 1, copies: [] },
      line: { oracleId: 'o-sol', name: 'Sol Ring', copies: [beta, cheap] },
    },
  ];
}

const onConfirm = vi.fn<(resolved: TradeCard[]) => void>();
const onCancel = vi.fn();

function renderDialog(choices: AcceptChoice[] = makeChoices()) {
  // MemoryRouter because the real badges render inside PrintingChoices —
  // BinderBadge calls useNavigate before its empty-input early return.
  return render(
    <MemoryRouter>
      <TradeAcceptDialog
        counterpartyName="Trade Pal"
        choices={choices}
        busy={false}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    </MemoryRouter>
  );
}

beforeEach(() => {
  onConfirm.mockClear();
  onCancel.mockClear();
});

describe('TradeAcceptDialog', () => {
  it('opens pre-filled with the cheapest-first pick, and confirming sends exactly that', () => {
    renderDialog();

    const accept = screen.getByRole('button', { name: 'Accept trade' });
    expect((accept as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(accept);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const resolved = onConfirm.mock.calls[0][0];
    expect(resolved).toEqual([
      {
        oracleId: 'o-sol',
        name: 'Sol Ring',
        quantity: 1,
        copies: [{ scryfallId: 'scry-cmd', finish: 'nonfoil' }],
      },
    ]);
    // The wire shape names printings, never copies — a copyId here would leak
    // a local identifier the other side can do nothing with.
    expect(Object.keys(resolved[0].copies[0]).sort()).toEqual(['finish', 'scryfallId']);
  });

  it('blocks Accept and names the card while a line is short', () => {
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'One fewer CMD · #120 Sol Ring' }));

    const accept = screen.getByRole('button', { name: 'Accept trade' });
    expect((accept as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Pick 1 copy of Sol Ring to continue.')).toBeTruthy();
    fireEvent.click(accept);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('switches printings in one tap — the other printing trims to keep the total', () => {
    renderDialog();

    // One "+" on the Beta: the auto-balance sheds the default cheap pick, so
    // there is no invalid intermediate state and no second tap.
    fireEvent.click(screen.getByRole('button', { name: 'One more LEA · #233 Sol Ring' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept trade' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0][0].copies).toEqual([
      { scryfallId: 'scry-lea', finish: 'nonfoil' },
    ]);
  });

  it('renders a single owned printing as a receipt — nothing to step', () => {
    renderDialog([
      {
        asked: { oracleId: 'o-sol', name: 'Sol Ring', quantity: 1, copies: [] },
        line: { oracleId: 'o-sol', name: 'Sol Ring', copies: [cheap] },
      },
    ]);

    // No steppers: the dialog is a confirm step here, not a picker.
    expect(screen.queryByRole('button', { name: /One more/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /One fewer/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Accept trade' }));
    expect(onConfirm.mock.calls[0][0][0].copies).toEqual([
      { scryfallId: 'scry-cmd', finish: 'nonfoil' },
    ]);
  });
});
