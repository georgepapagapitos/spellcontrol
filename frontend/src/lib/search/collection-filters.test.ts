/**
 * Tests for collection price + CMC filter matching logic (UX-302).
 * These are pure logic tests — no DOM needed.
 */

import { describe, it, expect } from 'vitest';

// --- Matcher helpers (mirroring the logic in CardListTable's filtered useMemo) ---

interface CardLike {
  purchasePrice: number;
  cmc?: number;
}

function matchesPrice(card: CardLike, min: number | undefined, max: number | undefined): boolean {
  if (min !== undefined && (card.purchasePrice <= 0 || card.purchasePrice < min)) return false;
  if (max !== undefined && (card.purchasePrice <= 0 || card.purchasePrice > max)) return false;
  return true;
}

function matchesCmc(card: CardLike, min: number | undefined, max: number | undefined): boolean {
  if (min !== undefined && (card.cmc === undefined || card.cmc < min)) return false;
  if (max !== undefined && (card.cmc === undefined || card.cmc > max)) return false;
  return true;
}

// --- Price tests ---

describe('price filter', () => {
  const priced = { purchasePrice: 5.0, cmc: 3 };
  const zeroPriced = { purchasePrice: 0, cmc: 3 }; // no price recorded

  it('passes when no price constraint', () => {
    expect(matchesPrice(priced, undefined, undefined)).toBe(true);
    expect(matchesPrice(zeroPriced, undefined, undefined)).toBe(true);
  });

  it('min-only: card price >= min passes', () => {
    expect(matchesPrice(priced, 4.0, undefined)).toBe(true);
    expect(matchesPrice(priced, 5.0, undefined)).toBe(true); // exact boundary
  });

  it('min-only: card price < min fails', () => {
    expect(matchesPrice(priced, 6.0, undefined)).toBe(false);
  });

  it('max-only: card price <= max passes', () => {
    expect(matchesPrice(priced, undefined, 10.0)).toBe(true);
    expect(matchesPrice(priced, undefined, 5.0)).toBe(true); // exact boundary
  });

  it('max-only: card price > max fails', () => {
    expect(matchesPrice(priced, undefined, 4.99)).toBe(false);
  });

  it('range: card price in range passes', () => {
    expect(matchesPrice(priced, 3.0, 8.0)).toBe(true);
  });

  it('range: card price out of range fails', () => {
    expect(matchesPrice(priced, 6.0, 10.0)).toBe(false);
    expect(matchesPrice(priced, 1.0, 4.99)).toBe(false);
  });

  it('card with purchasePrice === 0 does NOT match any price constraint', () => {
    expect(matchesPrice(zeroPriced, 0, undefined)).toBe(false); // min=0 still no match
    expect(matchesPrice(zeroPriced, undefined, 100)).toBe(false); // max constraint: no match
    expect(matchesPrice(zeroPriced, 0, 100)).toBe(false); // range: no match
  });

  it('card with purchasePrice === 0 passes when no price constraint', () => {
    expect(matchesPrice(zeroPriced, undefined, undefined)).toBe(true);
  });
});

// --- CMC tests ---

describe('CMC filter', () => {
  const card3 = { purchasePrice: 1.0, cmc: 3 };
  const card0 = { purchasePrice: 1.0, cmc: 0 }; // lands
  const cardNoCmc = { purchasePrice: 1.0, cmc: undefined }; // old card

  it('passes when no CMC constraint', () => {
    expect(matchesCmc(card3, undefined, undefined)).toBe(true);
    expect(matchesCmc(cardNoCmc, undefined, undefined)).toBe(true);
  });

  it('min-only: card cmc >= min passes', () => {
    expect(matchesCmc(card3, 2, undefined)).toBe(true);
    expect(matchesCmc(card3, 3, undefined)).toBe(true); // boundary
  });

  it('min-only: card cmc < min fails', () => {
    expect(matchesCmc(card3, 4, undefined)).toBe(false);
  });

  it('max-only: card cmc <= max passes', () => {
    expect(matchesCmc(card3, undefined, 4)).toBe(true);
    expect(matchesCmc(card3, undefined, 3)).toBe(true); // boundary
  });

  it('max-only: card cmc > max fails', () => {
    expect(matchesCmc(card3, undefined, 2)).toBe(false);
  });

  it('cmc=0 (lands) matches cmc range 0-2', () => {
    expect(matchesCmc(card0, 0, 2)).toBe(true);
  });

  it('card with no cmc does NOT match any CMC constraint', () => {
    expect(matchesCmc(cardNoCmc, 0, undefined)).toBe(false);
    expect(matchesCmc(cardNoCmc, undefined, 100)).toBe(false);
    expect(matchesCmc(cardNoCmc, 0, 100)).toBe(false);
  });

  it('card with no cmc passes when no constraint', () => {
    expect(matchesCmc(cardNoCmc, undefined, undefined)).toBe(true);
  });
});
