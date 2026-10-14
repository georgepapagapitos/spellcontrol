// @vitest-environment node
//
// An owned spell the commander's page has no row for may take the place of an
// owned card the page plays, by what it does itself (OFF_PAGE_MIN_GAIN, the bar
// Coach holds it to). An "available only" deck is all owned page cards, so a
// flat refusal kept every off-page owned card out: a Zo-Zu build seated
// Kiki-Jiki and never the owned Zealous Conscripts that Coach then offered.
// Here Meren's real treatment deck loses Mikaeus, the Unhallowed, which the
// page then has no row for, and every card is owned.
import { describe, expect, it } from 'vitest';
import { isOwnedCard } from './constraints';
import { optimizeDeck } from './optimizer';
import { FIX, TREATMENT, card, merenCtx, swap } from './__fixtures__/objectiveFixture';

const deck = swap(TREATMENT, 'Mikaeus, the Unhallowed', 'Crop Rotation');
/** A "full collection" build that owns the deck and `offPage`, which the page doesn't rank. */
const ctxWith = (offPage: string, comboCount?: number, prefer = false) => {
  const page = { ...FIX.merenPage };
  delete page[offPage];
  return merenCtx({
    edhrec: new Map(Object.entries(page)),
    // "prefer" owns only the off-page card, so every page card it could replace is unowned.
    ownedNames: new Set(prefer ? [offPage] : [...deck.cards.map((c) => c.name), offPage]),
    customization: {
      deckFormat: 99,
      currency: 'USD',
      collectionMode: true,
      collectionStrategy: prefer ? 'prefer' : 'full',
      ...(comboCount === undefined ? {} : { comboCount }),
    },
  });
};
const SMALL = { maxSwaps: 3, maxEvaluations: 60, shortlist: 12, escapes: 0, comboPairs: false };
const run = (name: string, comboCount?: number, prefer = false) => {
  const ctx = ctxWith(name, comboCount, prefer);
  const r = optimizeDeck(deck, [card(name)], ctx, { ...SMALL, offPageOwned: new Set([name]) });
  return { ctx, swaps: r.swaps.filter((s) => s.in.includes(name)) };
};

describe('optimizeDeck with an owned spell the page never ranked', { timeout: 60_000 }, () => {
  it('seats it for an owned card the page plays when it gains enough on its own', () => {
    const { ctx, swaps } = run('Mikaeus, the Unhallowed');
    expect(swaps).toHaveLength(1);
    const out = card(swaps[0].out[0]);
    expect(isOwnedCard(out, ctx)).toBe(true);
    expect(ctx.qualityOf(out).source).toBe('page');
    // The combos it completes, not a role count, carry it.
    expect(swaps[0].terms.combos).toBeGreaterThan(0.6);
  });

  it('keeps it out when its gain is mostly mana noise and theme reads', () => {
    // Unbarred, Sheoldred comes in for +0.69, 0.49 of it its own.
    expect(run('Sheoldred, Whispering One').swaps).toEqual([]);
  });

  // A High Perfect Morcant build with combos set to none took Sanguine Bond +
  // Exquisite Blood: the combos term paid for a combo the user said no to.
  // A "prefer" Isshin took Goblin King for an unowned Relentless Assault: owning
  // a card paid for a seat its play didn't earn.
  it('keeps it out of an unowned page card seat when owning it is most of the gain', () => {
    expect(run('Sheoldred, Whispering One', undefined, true).swaps).toEqual([]);
  });

  it('keeps a combo piece out when combos are set to none', () => {
    expect(run('Mikaeus, the Unhallowed', 0).swaps).toEqual([]);
  });
});
