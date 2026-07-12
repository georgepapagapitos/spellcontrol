// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { CardTally } from './useCardCarousel';
import { BuyListDialog, buyListText, tcgplayerMassEntryUrl } from './BuyListDialog';

function mk(name: string, count: number, usd?: string): CardTally {
  const card = usd ? ({ id: `sf-${name}`, name, prices: { usd } } as ScryfallCard) : undefined;
  return { name, count, card };
}

describe('buyListText', () => {
  it('emits one "<qty> <name>" line per unique card', () => {
    expect(buyListText([mk('Sol Ring', 1), mk('Swamp', 12)])).toBe('1 Sol Ring\n12 Swamp');
  });
});

describe('tcgplayerMassEntryUrl', () => {
  it('joins entries with || inside an encoded massentry link', () => {
    const url = tcgplayerMassEntryUrl([mk('Sol Ring', 1), mk('Swamp', 12)]);
    expect(url).toBe(
      `https://www.tcgplayer.com/massentry?c=${encodeURIComponent('1 Sol Ring||12 Swamp')}`
    );
  });

  it('trims DFC names to the front face', () => {
    const url = tcgplayerMassEntryUrl([mk('Delver of Secrets // Insectile Aberration', 4)]);
    expect(decodeURIComponent(url.split('?c=')[1])).toBe('4 Delver of Secrets');
  });
});

describe('BuyListDialog', () => {
  it('renders rows with line prices, the total, and the TCGPlayer link', () => {
    const tally = [mk('Sol Ring', 2, '3.20'), mk('Counterspell', 1)];
    const { container, getByText } = render(
      <BuyListDialog tally={tally} currency="USD" title="Test deck" onClose={() => {}} />
    );
    // 2 × $3.20 line total; priceless card renders $0.00 and doesn't poison the sum.
    expect(getByText('$6.40')).toBeTruthy();
    expect(getByText('3 cards missing · $6.40')).toBeTruthy();
    expect(container.querySelectorAll('.buy-list-row')).toHaveLength(2);
    const link = container.querySelector('a.btn-primary')!;
    expect(link.getAttribute('href')).toBe(tcgplayerMassEntryUrl(tally));
    expect(link.getAttribute('target')).toBe('_blank');
  });
});
