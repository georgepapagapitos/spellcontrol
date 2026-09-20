import { describe, expect, it } from 'vitest';
import type { BattlefieldCard, PlaytestCard } from '@/lib/playtest';
import { displayPT } from './power-toughness';

function card(over: Partial<PlaytestCard> = {}): PlaytestCard {
  return { id: 'c1', name: 'Grizzly Bears', ...over };
}

function bf(over: Partial<BattlefieldCard> = {}): BattlefieldCard {
  return {
    card: card(),
    tapped: false,
    counters: {},
    stickers: [],
    x: 0,
    y: 0,
    faceDown: false,
    ...over,
  };
}

describe('displayPT', () => {
  it('shows nothing for a card with no body and no modifier', () => {
    expect(displayPT(card(), bf())).toBeNull();
  });

  it('shows the printed body, unmodified', () => {
    const c = card({ power: '2', toughness: '2' });
    expect(displayPT(c, bf({ card: c }))).toEqual({
      power: '2',
      toughness: '2',
      modified: false,
    });
  });

  it('adds a numeric modifier into the printed body', () => {
    const c = card({ power: '2', toughness: '2' });
    expect(displayPT(c, bf({ card: c, pt: { power: 3, toughness: 1 } }))).toEqual({
      power: '5',
      toughness: '3',
      modified: true,
    });
  });

  it('subtracts, and is willing to go negative', () => {
    const c = card({ power: '1', toughness: '1' });
    expect(displayPT(c, bf({ card: c, pt: { power: -3, toughness: 0 } }))).toEqual({
      power: '-2',
      toughness: '1',
      modified: true,
    });
  });

  // The reason this module exists rather than a `Number(power) + delta`
  // inline: Scryfall ships `*`, `1+*` and `∞`, and folding a modifier into
  // one of those would print a number that is simply false.
  it('keeps a non-numeric body beside its modifier instead of folding it in', () => {
    const c = card({ name: 'Tarmogoyf', power: '*', toughness: '1+*' });
    expect(displayPT(c, bf({ card: c, pt: { power: 2, toughness: 2 } }))).toEqual({
      power: '*+2',
      toughness: '1+*+2',
      modified: true,
    });
  });

  it('shows a bare modifier for a card with no printed body', () => {
    expect(displayPT(card(), bf({ pt: { power: 1, toughness: 1 } }))).toEqual({
      power: '+1',
      toughness: '+1',
      modified: true,
    });
  });

  it('treats an empty printed value as absent', () => {
    const c = card({ power: '', toughness: '' });
    expect(displayPT(c, bf({ card: c }))).toBeNull();
  });
});
