import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { buildPrintingPriceNote } from './printingPriceNote';

const card = (name: string, usd: string, pricedFromSet?: string) =>
  ({ name, prices: { usd }, pricedFromSet }) as unknown as ScryfallCard;

describe('buildPrintingPriceNote', () => {
  it('is undefined when every card carries its own price', () => {
    expect(buildPrintingPriceNote([card('Sol Ring', '1.00')])).toBeUndefined();
  });

  it('names the cards priced from another printing, and how many more', () => {
    const cards = ['A', 'B', 'C', 'D', 'E'].map((n, i) => card(n, `${i + 1}.50`, 'fdc'));
    expect(buildPrintingPriceNote(cards)).toBe(
      '5 cards have no price in the printing your filter chose, so the budget and price cap count them at the cheapest printing that has one: A ($1.50), B ($2.50), C ($3.50), D ($4.50), and 1 more.'
    );
  });

  it('reads singular for one card', () => {
    expect(buildPrintingPriceNote([card('Lightning Bolt', '0.81', 'fdc')])).toContain(
      '1 card has no price'
    );
  });
});
