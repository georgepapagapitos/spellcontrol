// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TradeCard } from '@/lib/trade/trades-client';

const usePrintingThumb = vi.hoisted(() => vi.fn());
vi.mock('@/lib/cards/card-thumbs', () => ({
  usePrintingThumb: (...a: unknown[]) => usePrintingThumb(...a),
}));

import { TradeOfferCardTile } from './TradeOfferCardTile';

const pinned: TradeCard = {
  oracleId: 'o-sol',
  name: 'Sol Ring',
  quantity: 1,
  copies: [{ scryfallId: 'scry-lea', finish: 'nonfoil' }],
};
const anyPrinting: TradeCard = { oracleId: 'o-rh', name: 'Rhystic Study', quantity: 2, copies: [] };

describe('TradeOfferCardTile', () => {
  it('asks for the PINNED printing and renders its id on the art', () => {
    usePrintingThumb.mockReturnValue({ src: 'http://cdn/sol-lea.png', id: 'scry-lea' });
    const { container } = render(
      <TradeOfferCardTile card={pinned} compact={false} onInspect={vi.fn()} />
    );

    expect(usePrintingThumb).toHaveBeenCalledWith('scry-lea', 'Sol Ring', 'normal');
    const img = container.querySelector('img');
    expect(img?.getAttribute('data-scryfall-id')).toBe('scry-lea');
    expect(img?.getAttribute('src')).toBe('http://cdn/sol-lea.png');
    // The art IS the printing: a pinned nonfoil carries no caption.
    expect(screen.queryByText('Any printing')).toBeNull();
    expect(screen.getByRole('button', { name: 'Preview Sol Ring' })).toBeTruthy();
  });

  it('says "Any printing" for an oracle-level ask, in the caption and the accessible name', () => {
    usePrintingThumb.mockReturnValue({ src: 'http://cdn/rh.png', id: undefined });
    const { container } = render(
      <TradeOfferCardTile card={anyPrinting} compact={false} onInspect={vi.fn()} />
    );

    expect(usePrintingThumb).toHaveBeenCalledWith(undefined, 'Rhystic Study', 'normal');
    expect(screen.getByText('Any printing')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Preview Rhystic Study, 2 copies, any printing' })
    ).toBeTruthy();
    expect(container.querySelector('img')?.hasAttribute('data-scryfall-id')).toBe(false);
  });

  it('names a foil printing', () => {
    usePrintingThumb.mockReturnValue({ src: 'x.png', id: 'scry-lea' });
    const foil = { ...pinned, copies: [{ scryfallId: 'scry-lea', finish: 'foil' }] };
    render(<TradeOfferCardTile card={foil} compact={false} onInspect={vi.fn()} />);
    expect(screen.getByText('Foil')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Preview Sol Ring, foil' })).toBeTruthy();
  });

  it('shows the name on a card-shaped placeholder while there is no art', () => {
    usePrintingThumb.mockReturnValue({ src: undefined, id: undefined });
    const { container } = render(
      <TradeOfferCardTile card={pinned} compact={false} onInspect={vi.fn()} />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.trade-offer-chip-thumb.is-placeholder')?.textContent).toBe(
      'Sol Ring'
    );
  });

  it('uses small art for a ledger tile and opens the preview on click', () => {
    usePrintingThumb.mockReturnValue({ src: 'x.png', id: 'scry-lea' });
    const onInspect = vi.fn();
    render(<TradeOfferCardTile card={pinned} compact onInspect={onInspect} />);
    expect(usePrintingThumb).toHaveBeenLastCalledWith('scry-lea', 'Sol Ring', 'small');
    fireEvent.click(screen.getByRole('button', { name: 'Preview Sol Ring' }));
    expect(onInspect).toHaveBeenCalledWith(pinned);
  });
});
