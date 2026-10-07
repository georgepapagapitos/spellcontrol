// @vitest-environment node
//
// E515 discovery slot, over Meren's real page and real cards (the objective
// fixture): linked cards that the page plays little may take filler slots,
// and nothing else. Soul Net (rank 25,218) is the weak linked card the
// quality bar exists for; Cordial Vampire and Hermit Druid are the real ones.
import { describe, expect, it } from 'vitest';
import { checkConstraints } from './index';
import {
  CMC_MAX,
  DISCOVERY_MAX,
  FILLER_MAX_PCT,
  RANK_MAX,
  VAGUE_RESOURCES,
  discover,
  labelFor,
  qualityBarProblem,
} from './discovery';
import { inclusionPct, protectedCards } from './protections';
import { BASELINE, FIX, TREATMENT, card, merenCtx, swap } from './__fixtures__/objectiveFixture';

const ctx = merenCtx();
// The generator's own lists have no card the page does not play, so each deck
// carries two off-page fillers (the weakest cards a build can end with).
const withFiller = (deck: typeof BASELINE) =>
  swap(swap(deck, 'Golgari Germination', 'Shadow-Rite Priest'), 'Desecrated Tomb', 'Rattlechains');
const BASE = withFiller(BASELINE);
const TREAT = withFiller(TREATMENT);
const names = (deck: { cards: readonly { name: string }[] }) => deck.cards.map((c) => c.name);
const poolFor = (deck: typeof BASELINE) => {
  const held = new Set(names(deck));
  return FIX.cards.filter((c) => !held.has(c.name));
};

describe('the commander-independent quality bar', () => {
  const facts = (n: string) => ctx.factsOf(card(n));

  it('refuses a linked card nobody plays (Soul Net, EDHREC rank 25,218)', () => {
    expect(card('Soul Net').edhrec_rank).toBeGreaterThan(RANK_MAX);
    expect(qualityBarProblem(card('Soul Net'), facts('Soul Net'), [])).toBe(
      'global play rate too low'
    );
  });

  it('refuses a card that costs too much (Craterhoof Behemoth, mana value 8)', () => {
    expect(card('Craterhoof Behemoth').cmc).toBeGreaterThan(CMC_MAX + 1);
    expect(qualityBarProblem(card('Craterhoof Behemoth'), facts('Craterhoof Behemoth'), [])).toBe(
      'costs too much'
    );
  });

  it('passes a well-played, cheap card with no vouching (Cordial Vampire, Hermit Druid)', () => {
    for (const n of ['Cordial Vampire', 'Hermit Druid']) {
      expect(qualityBarProblem(card(n), facts(n), [])).toBeNull();
    }
  });

  it('wants a proven look-alike for a card between the two ranks (Oriq Loremage)', () => {
    expect(qualityBarProblem(card('Oriq Loremage'), facts('Oriq Loremage'), [])).toBe(
      'resembles no proven card'
    );
  });
});

describe('discover', { timeout: 120_000 }, () => {
  for (const [label, deck] of [
    ['the generator-shaped baseline', BASE],
    ['the treatment deck', TREAT],
  ] as const) {
    const result = discover(deck, poolFor(deck), ctx);

    it(`${label}: takes one or two filler slots and labels each with its link`, () => {
      expect(result.picks.length).toBeGreaterThan(0);
      expect(result.picks.length).toBeLessThanOrEqual(DISCOVERY_MAX);
      const held = new Set([...names(result.deck), ...deck.commanders.map((c) => c.name)]);
      for (const p of result.picks) {
        expect(p.links.length).toBeGreaterThanOrEqual(2);
        // Every partner the label can name is a card of the final deck (or its commander).
        for (const l of p.links) expect(held.has(l.partner)).toBe(true);
        expect(p.label).toMatch(/^(makes|pays off)/);
        expect(p.label).toContain(p.links[0].partner);
        // No link on a resource every deck makes (graveyard cards, loyalty, enters triggers).
        for (const l of p.links) expect(VAGUE_RESOURCES).not.toContain(l.resource);
        // Discovery: the page plays it little. Quality: the whole deck does not lose.
        expect(inclusionPct(p.card, ctx)).toBeLessThan(15);
        expect(p.delta).toBeGreaterThanOrEqual(0);
      }
    });

    it(`${label}: never cuts protected cards, staples or must-keep cards, and breaks no rule`, () => {
      const protectedNow = protectedCards(deck, ctx);
      for (const p of result.picks) {
        expect(protectedNow.has(p.cut.name), p.cut.name).toBe(false);
        expect(inclusionPct(p.cut, ctx)).toBeLessThan(FILLER_MAX_PCT);
        expect(['Sol Ring', 'Arcane Signet']).not.toContain(p.cut.name);
      }
      const after = names(result.deck);
      for (const [n, c] of protectedNow) expect(after, `${n} (${c.cls})`).toContain(n);
      expect(result.deck.cards).toHaveLength(deck.cards.length);
      expect(checkConstraints(result.deck, ctx).length).toBeLessThanOrEqual(
        checkConstraints(deck, ctx).length
      );
    });

    it(`${label}: is deterministic`, () => {
      const again = discover(deck, poolFor(deck), ctx);
      expect(again.picks.map((p) => [p.card.name, p.cut.name])).toEqual(
        result.picks.map((p) => [p.card.name, p.cut.name])
      );
    });
  }

  it('holds even when every card is called filler: the protection set still stands', () => {
    const wide = discover(BASE, poolFor(BASE), ctx, { fillerMaxPct: 100 });
    const protectedNow = protectedCards(BASE, ctx);
    for (const [n] of protectedNow) expect(names(wide.deck)).toContain(n);
    for (const p of wide.picks) expect(protectedNow.has(p.cut.name)).toBe(false);
  });

  it('never brings in a card that fails the bar, however linked: Soul Net alone gets nothing', () => {
    const only = discover(BASE, [card('Soul Net')], ctx);
    expect(only.picks).toEqual([]);
  });

  it('honours a lock and an exclusion', () => {
    const base = discover(BASE, poolFor(BASE), ctx);
    const cut = base.picks[0].cut.name;
    const locked = discover(BASE, poolFor(BASE), ctx, { locks: [cut] });
    for (const p of locked.picks) expect(p.cut.name).not.toBe(cut);
    const excluded = discover(BASE, poolFor(BASE), ctx, {
      exclude: new Set(base.picks.map((p) => p.card.name)),
    });
    for (const p of excluded.picks) {
      expect(base.picks.map((b) => b.card.name)).not.toContain(p.card.name);
    }
  });

  it('never takes the slot of a card the page plays more than the pick (the Hyper Focus direction)', () => {
    // BASELINE's weakest cards are on the page at 6-12%; Cordial Vampire is off it.
    expect(discover(BASELINE, [card('Cordial Vampire')], ctx).picks).toEqual([]);
    expect(discover(BASE, [card('Cordial Vampire')], ctx).picks.length).toBeGreaterThan(0);
  });

  it('does not spend more than a few dollars over the card it replaces', () => {
    const priced = (usd: string) => {
      const c = card('Cordial Vampire');
      c.prices = { ...c.prices, usd };
      return c;
    };
    expect(discover(BASE, [priced('40.00')], ctx).picks).toEqual([]);
    expect(discover(BASE, [priced('2.00')], ctx).picks.length).toBeGreaterThan(0);
  });

  it('can be asked for fewer picks', () => {
    expect(discover(BASE, poolFor(BASE), ctx, { max: 1 }).picks.length).toBe(1);
    expect(discover(BASE, poolFor(BASE), ctx, { max: 0 }).picks).toEqual([]);
  });
});

describe('labelFor', () => {
  it('names the exact link, grouped by what it feeds', () => {
    expect(
      labelFor([
        { kind: 'makes', resource: 'treasure', partner: 'Marionette Master', strength: 1 },
        { kind: 'makes', resource: 'treasure', partner: 'Pitiless Plunderer', strength: 0.9 },
      ])
    ).toBe('makes Treasure for Marionette Master and Pitiless Plunderer');
    expect(
      labelFor([
        { kind: 'feeds-on', resource: 'creature-death', partner: 'Viscera Seer', strength: 1 },
      ])
    ).toBe('pays off the creature deaths that Viscera Seer makes');
  });

  it('says so when the pair is a known combo', () => {
    expect(
      labelFor([
        { kind: 'makes', resource: 'graveyard', partner: 'Animate Dead', strength: 1, combo: true },
      ])
    ).toContain('a known combo');
  });
});
