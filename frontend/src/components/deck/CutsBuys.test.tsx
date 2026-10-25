// @vitest-environment happy-dom
//
// The buys under the Cuts lane: loading, empty, ranked by gain per dollar, and
// the unpriced cards counted rather than priced by guess.
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CutsBuys } from './CutsBuys';
import type { BuyState } from '@/lib/coach/use-cut-swaps';
import type { BuyCandidate } from '@/lib/coach/coach-buys';
import type { Change } from '@/lib/coach/deck-change';

vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));

let priceState = { prices: new Map<string, number>(), loaded: true };
vi.mock('./use-missing-prices', () => ({ useCardPriceLookup: () => priceState }));

const buy = (cutName: string, inName: string, delta: number): BuyCandidate => ({
  cutName,
  delta,
  change: {
    id: `upgrade:cut:${cutName}`,
    type: 'swap',
    lane: 'upgrade',
    name: inName,
    inName: cutName,
    pairedCut: true,
    ownership: 'unowned',
    reason: `${inName} fits better.`,
  } as Change,
});

const DECK = new Set(['skull prophet', 'dread return', 'skullclamp']);
const ready = (...buys: BuyCandidate[]): BuyState => ({ status: 'ready', buys });

function renderBuys(buys: BuyState, onAct = vi.fn()) {
  render(
    <CutsBuys buys={buys} deckNames={DECK} onAct={onAct} onPreview={vi.fn()} busy={() => false} />
  );
  return onAct;
}

beforeEach(() => {
  priceState = { prices: new Map(), loaded: true };
});

describe('CutsBuys', () => {
  it('shows a status while the search runs, and nothing when idle or failed', () => {
    const { unmount } = render(
      <CutsBuys
        buys={{ status: 'loading' }}
        deckNames={DECK}
        onAct={vi.fn()}
        onPreview={vi.fn()}
        busy={() => false}
      />
    );
    expect(screen.getByRole('status').textContent).toMatch(/Looking for buys/);
    unmount();
    const idle = render(
      <CutsBuys
        buys={{ status: 'idle' }}
        deckNames={DECK}
        onAct={vi.fn()}
        onPreview={vi.fn()}
        busy={() => false}
      />
    );
    expect(idle.container.textContent).toBe('');
    idle.unmount();
    const failed = render(
      <CutsBuys
        buys={{ status: 'error' }}
        deckNames={DECK}
        onAct={vi.fn()}
        onPreview={vi.fn()}
        busy={() => false}
      />
    );
    expect(failed.container.textContent).toBe('');
  });

  it('says so when nothing worth buying was found', () => {
    renderBuys(ready());
    expect(screen.getByText(/Nothing you'd have to buy beats what you own/)).toBeTruthy();
  });

  it('lists the best gain per dollar first with its price, and applies the swap', () => {
    priceState = {
      prices: new Map([
        ['demonic tutor', 3],
        ['cultivate', 0.5],
      ]),
      loaded: true,
    };
    const onAct = renderBuys(
      ready(buy('Skull Prophet', 'Demonic Tutor', 6), buy('Dread Return', 'Cultivate', 3))
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows[0].textContent).toContain('Cultivate');
    expect(rows[1].textContent).toContain('Demonic Tutor');
    expect(rows[0].textContent).toContain('$0.50');
    fireEvent.click(rows[0].querySelector('button.deck-card-row-act, button[class*="act"]')!);
    expect(onAct).toHaveBeenCalledTimes(1);
    expect(onAct.mock.calls[0][0]).toMatchObject({ name: 'Cultivate', inName: 'Dread Return' });
  });

  it('counts a card with no price instead of ranking it', () => {
    priceState = { prices: new Map([['cultivate', 0.5]]), loaded: true };
    renderBuys(ready(buy('Dread Return', 'Cultivate', 3), buy('Skullclamp', 'Grave Pact', 9)));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText(/1 more has no price yet and isn't ranked/)).toBeTruthy();
  });

  it('drops a buy whose cut has already left the deck', () => {
    priceState = { prices: new Map([['cultivate', 0.5]]), loaded: true };
    renderBuys(ready(buy('Gone Card', 'Cultivate', 3)));
    expect(screen.queryByRole('listitem')).toBeNull();
  });
});
