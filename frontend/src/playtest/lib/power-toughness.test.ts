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

  // A 2/2 under two +1/+1 counters is a 4/4, and that is the number a
  // player needs when working out whether it survives. Reading the printed
  // body and doing the arithmetic off the badge is work the board should be
  // doing for them.
  it('folds +1/+1 counters into the printed body', () => {
    const c = card({ power: '2', toughness: '2' });
    expect(displayPT(c, bf({ card: c, counters: { '+1/+1': 2 } }))).toEqual({
      power: '4',
      toughness: '4',
      modified: true,
    });
  });

  it('folds -1/-1 counters the other way, and nets the two out', () => {
    const c = card({ power: '3', toughness: '3' });
    expect(displayPT(c, bf({ card: c, counters: { '-1/-1': 2 } }))?.power).toBe('1');
    expect(displayPT(c, bf({ card: c, counters: { '+1/+1': 3, '-1/-1': 1 } }))?.power).toBe('5');
  });

  it('adds counters on top of a hand-applied modifier', () => {
    const c = card({ power: '1', toughness: '1' });
    expect(
      displayPT(c, bf({ card: c, counters: { '+1/+1': 1 }, pt: { power: 2, toughness: 0 } }))
    ).toEqual({ power: '4', toughness: '2', modified: true });
  });

  // Only these two kinds change a body. Folding a charge or loyalty counter
  // in would print a size the card simply does not have.
  it('ignores counters that are not +1/+1 or -1/-1', () => {
    const c = card({ power: '2', toughness: '2' });
    expect(displayPT(c, bf({ card: c, counters: { charge: 5, loyalty: 3 } }))).toEqual({
      power: '2',
      toughness: '2',
      modified: false,
    });
  });

  it('keeps a non-numeric body beside its counter step', () => {
    const c = card({ name: 'Tarmogoyf', power: '*', toughness: '1+*' });
    expect(displayPT(c, bf({ card: c, counters: { '+1/+1': 1 } }))).toEqual({
      power: '*+1',
      toughness: '1+*+1',
      modified: true,
    });
  });

  it('treats an empty printed value as absent', () => {
    const c = card({ power: '', toughness: '' });
    expect(displayPT(c, bf({ card: c }))).toBeNull();
  });
});
