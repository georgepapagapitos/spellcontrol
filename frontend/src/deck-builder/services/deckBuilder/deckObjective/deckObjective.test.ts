// @vitest-environment node
//
// The whole-deck objective (E513) over real cards: every card below is a real
// Scryfall record, the EDHREC rows and lift pools are Meren of Clan Nel
// Toth's real page as the app's client parsed it, and the two Meren decks are
// the E510 gate's baseline and treatment (__fixtures__/objective.fixture.json
// says where each piece came from). Card facts are extracted from each card's
// own oracle text (the snapshot isn't loaded in tests).
import { describe, expect, it } from 'vitest';
import {
  TERM_KEYS,
  checkConstraints,
  compareScores,
  infeasibility,
  scoreDeck,
  termDeltas,
  type ObjectiveDeck,
} from './index';
import { qualityTerm, signatureTerm } from './terms/quality';
import { PRICE_A, PRICE_B } from './context';
import { rolesTerm, UNDER_SCALE } from './terms/roles';
import { answerValue, interactionTerm, isFree, protectionValue } from './terms/interaction';
import { curveTerm } from './terms/curve';
import { manaTerm } from './terms/mana';
import { combosTerm, COMBO_SCALE } from './terms/combos';
import { liftTerm, synergyTerm } from './terms/synergy';
import { nonboTerm, HARD_NONBO } from './terms/nonbo';
import {
  BASELINE,
  FIX,
  MEREN,
  TREATMENT,
  card,
  cards,
  merenCtx,
  merenDeck,
  swap,
} from './__fixtures__/objectiveFixture';

describe('quality: EDHREC inclusion as a prior', () => {
  const ctx = merenCtx();

  const priced = (name: string) => {
    const c = card(name);
    const f = PRICE_A + PRICE_B * Math.log10(1 + parseFloat(c.prices.usd ?? '0'));
    return Math.min(1, (FIX.merenPage[name].inclusion / 100) * f);
  };

  it('reads an on-page card as its price-adjusted inclusion share and a basic as zero', () => {
    expect(ctx.qualityOf(card('Sol Ring'))).toMatchObject({ source: 'page' });
    expect(ctx.qualityOf(card('Sol Ring')).q).toBeCloseTo(priced('Sol Ring'));
    expect(ctx.qualityOf(card('Swamp'))).toMatchObject({ q: 0, source: 'basic' });
  });

  it('lifts an expensive card toward what stronger decks play; a $1 card stays near its rate', () => {
    // Bracket-4 pages play premium cards more than the page average does.
    const cheap = card('Sakura-Tribe Elder');
    const dear = card('Vampiric Tutor');
    const read = (c: typeof cheap) => ctx.qualityOf(c).q / (FIX.merenPage[c.name].inclusion / 100);
    expect(read(dear)).toBeGreaterThan(read(cheap));
    expect(Math.abs(read(cheap) - 1)).toBeLessThan(0.15);
    expect(ctx.qualityOf(dear).note).toMatch(/price-adjusted/);
  });

  it('never reads an off-page card as 0, and orders off-page cards by global popularity', () => {
    // Neither is on Meren's page; Mox Diamond is played far more across Commander.
    expect(FIX.merenPage['Mox Diamond']).toBeUndefined();
    expect(FIX.merenPage['Aetherjacket']).toBeUndefined();
    const mox = ctx.qualityOf(card('Mox Diamond'));
    const jacket = ctx.qualityOf(card('Aetherjacket'));
    expect(mox.source).toBe('off-page');
    expect(jacket.q).toBeGreaterThanOrEqual(ctx.pageFloorPct / 100);
    expect(mox.q).toBeGreaterThan(jacket.q);
    expect(mox.note).toMatch(/off-page/);
  });

  it('sums over the 99 and names every non-basic card', () => {
    const v = qualityTerm(merenDeck(['Sol Ring', 'Swamp', 'Skullclamp']), ctx);
    const expected = priced('Sol Ring') + priced('Skullclamp');
    expect(v.value).toBeCloseTo(expected);
    expect(v.cards.map((c) => c.name).sort()).toEqual(['Skullclamp', 'Sol Ring']);
  });

  it('signature rewards what this commander plays over its colours and names the avoided', () => {
    const v = signatureTerm(merenDeck(['Spore Frog', 'Heroic Intervention']), ctx);
    const frog = v.cards.find((c) => c.name === 'Spore Frog')!;
    const hi = v.cards.find((c) => c.name === 'Heroic Intervention')!;
    expect(frog.value).toBeGreaterThan(0.2);
    expect(hi.value).toBeLessThan(0);
    expect(hi.note).toMatch(/avoid/);
  });
});

describe('roles: coverage against targets, soft on both sides', () => {
  const targets = { ramp: 2, cardDraw: 2, removal: 2, boardwipe: 1 };
  const ctx = merenCtx({ roleTargets: targets });

  it('counts roles from card facts: Liliana is draw and removal, not a wipe', () => {
    const v = rolesTerm(merenDeck(['Liliana, Dreadhorde General']), ctx);
    expect(v.summary).toMatch(/draw 1\/2/);
    expect(v.summary).toMatch(/removal 0\.6\/2/);
    expect(v.summary).toMatch(/wipes 0\/1/);
  });

  it('does not count a counterspell as removal (E486)', () => {
    const v = rolesTerm(merenDeck(['Counterspell']), ctx);
    expect(v.summary).toMatch(/removal 0\/2/);
  });

  it('costs nothing inside the band and saturates below the scale', () => {
    const onTarget = rolesTerm(
      merenDeck([
        'Sol Ring',
        'Cultivate',
        'Rhystic Study',
        'Skullclamp',
        'Swords to Plowshares',
        'Path to Exile',
        'Toxic Deluge',
      ]),
      ctx
    );
    expect(onTarget.value).toBe(0);
    const empty = rolesTerm(merenDeck(['Swamp']), merenCtx({ roleTargets: { ramp: 10 } }));
    expect(empty.value).toBeLessThan(0);
    expect(-empty.value).toBeLessThanOrEqual(UNDER_SCALE);
    expect(empty.cards[0].note).toMatch(/ramp 0 of target 10/);
  });

  it('penalizes an overbuilt role too, naming its members', () => {
    const ramp = [
      'Sol Ring',
      'Cultivate',
      'Mana Vault',
      'Mox Diamond',
      'Gilded Lotus',
      'Llanowar Elves',
    ];
    const v = rolesTerm(merenDeck(ramp), merenCtx({ roleTargets: { ramp: 2 } }));
    expect(v.value).toBeLessThan(0);
    expect(v.cards.every((c) => /overbuilt/.test(c.note))).toBe(true);
    expect(new Set(v.cards.map((c) => c.name))).toEqual(new Set(ramp));
  });
});

describe('interaction: answer quality and protection', () => {
  const ctx = merenCtx();
  const answer = (name: string) => answerValue(card(name), ctx.factsOf(card(name)))?.v ?? 0;

  it('values Path to Exile over Magus of the Abyss, and a broad answer over a narrow one', () => {
    expect(answer('Path to Exile')).toBeGreaterThan(answer('Magus of the Abyss'));
    expect(answer("Assassin's Trophy")).toBeGreaterThan(answer('Swords to Plowshares'));
  });

  it('reads one-sided mass bounce above a symmetric wipe', () => {
    expect(answer('Cyclonic Rift')).toBeGreaterThan(answer('Toxic Deluge'));
  });

  it('recognises protection, and reads the commander free-cast clause as free', () => {
    expect(
      protectionValue(card('Lightning Greaves'), ctx.factsOf(card('Lightning Greaves')))
    ).toBeGreaterThan(0);
    expect(isFree(card('Fierce Guardianship'))).toBe(true);
    expect(isFree(card('Counterspell'))).toBe(false);
  });

  it('names every answer and protection piece with its rank', () => {
    const v = interactionTerm(merenDeck(['Path to Exile', 'Lightning Greaves', 'Swamp']), ctx);
    expect(v.cards.map((c) => c.name).sort()).toEqual(['Lightning Greaves', 'Path to Exile']);
    expect(v.cards.find((c) => c.name === 'Path to Exile')!.note).toMatch(/answer #1/);
  });
});

describe('curve: phase shares against the plan', () => {
  it('penalizes a top-heavy curve and blames the expensive spells', () => {
    const ctx = merenCtx({ pacing: 'balanced' });
    const heavy = merenDeck([
      'Craterhoof Behemoth',
      'Siege-Gang Commander',
      'Massacre Wurm',
      'Sheoldred, Whispering One',
      'Sol Ring',
    ]);
    const v = curveTerm(heavy, ctx);
    expect(v.value).toBeLessThan(0);
    const blamed = new Set(
      v.cards.filter((c) => /late phase is heavy/.test(c.note)).map((c) => c.name)
    );
    expect(blamed.has('Craterhoof Behemoth')).toBe(true);
    expect(blamed.has('Sol Ring')).toBe(false);
  });

  it("reads the context's pacing, not the deck's own curve", () => {
    const deck = merenDeck(['Sol Ring', 'Skullclamp', 'Craterhoof Behemoth', 'Massacre Wurm']);
    const aggressive = curveTerm(deck, merenCtx({ pacing: 'aggressive-early' })).value;
    const late = curveTerm(deck, merenCtx({ pacing: 'late-game' })).value;
    expect(aggressive).not.toBe(late);
  });
});

describe('mana: the goldfish with a fixed seed', () => {
  it('is deterministic for a context and deck', () => {
    const a = manaTerm(BASELINE, merenCtx()).value;
    const b = manaTerm(BASELINE, merenCtx()).value;
    expect(a).toBe(b);
  });

  it('scores a Golgari deck on Islands far below the same deck on its own colours', () => {
    const lands = BASELINE.cards.filter((c) => /\bLand\b/.test(c.type_line));
    const spells = BASELINE.cards.filter((c) => !/\bLand\b/.test(c.type_line));
    const islands: ObjectiveDeck = {
      commanders: [MEREN],
      cards: [...spells, ...lands.map(() => card('Island'))],
    };
    const ctx = merenCtx();
    expect(manaTerm(islands, ctx).value).toBeLessThan(manaTerm(BASELINE, ctx).value - 5);
  });

  describe('common random numbers', () => {
    const slots = BASELINE.cards.map((c) => c.name);

    it('a swap that plays the same, in the same slot, barely moves the term', () => {
      // Snow-Covered Swamp is a Swamp to the goldfish; only the name (and so
      // the simulator's card id, which breaks a few ties) differs.
      const snow = swap(BASELINE, 'Swamp', 'Snow-Covered Swamp');
      const aligned = merenCtx({ slotOrder: slots });
      const inSlot = Math.abs(manaTerm(snow, aligned).value - manaTerm(BASELINE, aligned).value);
      // In name order the snow basic shifts every card between the two names.
      const sorted = merenCtx();
      const moved = Math.abs(manaTerm(snow, sorted).value - manaTerm(BASELINE, sorted).value);
      expect(inSlot).toBeLessThan(0.01);
      expect(moved).toBeGreaterThan(5 * inSlot);
    });

    it("shrinks the seed noise of a real pair's mana delta", () => {
      // The E510 Meren pair (seven swaps) at six fixed seeds: the spread of
      // the delta is the goldfish's own noise on the comparison.
      const spread = (slotOrder?: string[]) => {
        const d = [11, 12, 13, 14, 15, 16].map((seed) => {
          const ctx = merenCtx({ manaSim: { games: 1000, seed }, slotOrder });
          return manaTerm(TREATMENT, ctx).value - manaTerm(BASELINE, ctx).value;
        });
        const mean = d.reduce((a, b) => a + b, 0) / d.length;
        return Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / (d.length - 1));
      };
      expect(spread(slots)).toBeLessThan(spread() * 0.8);
    });
  });
});

describe('combos: completeness', () => {
  const combo = FIX.hermitDruidCombo;
  const druid = {
    commanders: [card('Muldrotha, the Gravetide')],
    cards: cards('Hermit Druid', "Thassa's Oracle"),
  };

  it('credits a complete combo and names its pieces', () => {
    const ctx = merenCtx({ combos: [combo], colorIdentity: ['B', 'G', 'U'] });
    const v = combosTerm(druid, ctx);
    expect(v.value).toBeCloseTo(COMBO_SCALE * Math.min(1, Math.log10(1 + combo.deckCount) / 4));
    expect(v.cards.map((c) => c.name).sort()).toEqual(['Hermit Druid', "Thassa's Oracle"]);
  });

  it('a broken two-card combo is a loss', () => {
    const ctx = merenCtx({ combos: [combo], colorIdentity: ['B', 'G', 'U'] });
    const broken = { commanders: druid.commanders, cards: cards("Thassa's Oracle", 'Island') };
    expect(combosTerm(broken, ctx).value).toBe(0);
    expect(combosTerm(druid, ctx).value).toBeGreaterThan(0);
  });

  it('earns nothing at a target bracket of 3 or lower', () => {
    const ctx = merenCtx({ combos: [combo], customization: { targetBracket: 3 } });
    expect(combosTerm(druid, ctx).value).toBe(0);
  });
});

describe('synergy: producer → payoff matching, and E71 lift in deck context', () => {
  const ctx = merenCtx();

  it("feeds Meren's death payoff from the deck's sacrifice pieces and names the feeders", () => {
    const v = synergyTerm(merenDeck(['Viscera Seer', 'Plaguecrafter', 'Blood Artist']), ctx);
    expect(v.summary).toMatch(/Meren of Clan Nel Toth pays off death/);
    expect(v.cards.some((c) => /feeds Meren of Clan Nel Toth/.test(c.note))).toBe(true);
  });

  it('a payoff with nothing feeding it scores nothing', () => {
    const krenkoCtx = merenCtx({ colorIdentity: ['R'] });
    const fed = synergyTerm(
      {
        commanders: [card('Krenko, Mob Boss')],
        cards: cards('Impact Tremors', 'Mogg War Marshal'),
      },
      krenkoCtx
    );
    const unfed = synergyTerm(
      { commanders: [card('Sol Ring')], cards: cards('Impact Tremors', 'Swamp') },
      krenkoCtx
    );
    const tremors = (v: typeof fed) => v.cards.find((c) => c.name === 'Impact Tremors')?.value ?? 0;
    expect(tremors(fed)).toBeGreaterThan(0);
    expect(tremors(unfed)).toBe(0);
  });

  it('lift counts only seeds that are in the deck', () => {
    const withFrog = liftTerm(
      merenDeck(['Spore Frog', 'Plaguecrafter', 'Sakura-Tribe Elder']),
      ctx
    );
    const without = liftTerm(merenDeck(['Plaguecrafter', 'Sakura-Tribe Elder']), ctx);
    const elder = (v: typeof withFrog) => v.cards.find((c) => c.name === 'Sakura-Tribe Elder');
    expect(elder(withFrog)!.note).toMatch(/Spore Frog/);
    expect(elder(without)!.note).not.toMatch(/Spore Frog/);
  });
});

describe('nonbo: cards that fight the plan', () => {
  it('flags Rest in Peace in a graveyard deck as a hard nonbo', () => {
    const deck = { commanders: [MEREN], cards: [...BASELINE.cards, card('Rest in Peace')] };
    const v = nonboTerm(deck, merenCtx());
    const rip = v.cards.find((c) => c.name === 'Rest in Peace');
    expect(rip?.value).toBe(-HARD_NONBO);
  });
});

describe('hard constraints', () => {
  it('passes the real baseline and flags each broken rule with its cards', () => {
    const ctx = merenCtx();
    expect(checkConstraints(BASELINE, ctx)).toEqual([]);
    const offColour = swap(BASELINE, 'Sol Ring', 'Counterspell');
    expect(checkConstraints(offColour, ctx)).toEqual([
      expect.objectContaining({ check: 'identity', cards: ['Counterspell'] }),
    ]);
    const dupe = swap(BASELINE, 'Arcane Signet', 'Sol Ring');
    expect(checkConstraints(dupe, ctx).map((v) => v.check)).toEqual(['singleton']);
    const short = { commanders: [MEREN], cards: BASELINE.cards.slice(1) };
    expect(checkConstraints(short, ctx)[0]).toMatchObject({ check: 'size', magnitude: 1 });
  });

  it('holds bans, must-includes, budget, bracket and the owned-only rule', () => {
    const cz = (over: Record<string, unknown>) =>
      merenCtx({ customization: { deckFormat: 99, currency: 'USD', ...over } });
    const checks = (over: Record<string, unknown>, deck = BASELINE) =>
      checkConstraints(deck, cz(over)).map((v) => v.check);
    expect(checks({ bannedCards: ['Skullclamp'] })).toEqual(['banned']);
    expect(checks({ mustIncludeCards: ['Grave Pact'] })).toEqual(['must-include']);
    expect(checks({ deckBudget: 50 })).toEqual(['budget']);
    // Bracket 2 allows no Game Changer; the baseline runs Vampiric Tutor and friends.
    expect(checks({ targetBracket: 2 })).toContain('bracket-ceiling');
    const owned = new Set(BASELINE.cards.map((c) => c.name).filter((n) => n !== 'Skullclamp'));
    const coll = checkConstraints(
      BASELINE,
      merenCtx({
        customization: { collectionMode: true, collectionStrategy: 'full' },
        ownedNames: owned,
      })
    );
    expect(coll).toEqual([expect.objectContaining({ check: 'collection', cards: ['Skullclamp'] })]);
  });

  it('compares a feasible deck above an infeasible one whatever the totals', () => {
    const ctx = merenCtx();
    const good = scoreDeck(BASELINE, ctx);
    const bad = scoreDeck(swap(BASELINE, 'Swamp', 'Counterspell'), ctx);
    expect(bad.feasible).toBe(false);
    expect(infeasibility(bad)).toBe(1);
    expect(compareScores(good, bad)).toBeGreaterThan(0);
    expect(compareScores(bad, good)).toBeLessThan(0);
  });
});

describe('the whole score on the real E510 Meren pair', () => {
  const ctx = merenCtx();
  const base = scoreDeck(BASELINE, ctx);
  const treat = scoreDeck(TREATMENT, ctx);

  it('explains itself: every nonzero term names real cards', () => {
    const names = new Set([MEREN.name, ...BASELINE.cards.map((c) => c.name)]);
    for (const key of TERM_KEYS) {
      const t = base.terms[key];
      expect(t.contribution).toBeCloseTo(t.value * t.weight);
      if (t.value === 0) continue;
      expect(t.detail.cards.length, key).toBeGreaterThan(0);
      for (const c of t.detail.cards) {
        expect(names.has(c.name) || /^\(.+\)$/.test(c.name), `${key}: ${c.name}`).toBe(true);
        expect(c.note.length).toBeGreaterThan(0);
      }
    }
    const sum = TERM_KEYS.reduce((s, k) => s + base.terms[k].contribution, 0);
    expect(base.total).toBeCloseTo(sum);
  });

  it('agrees with the differ: cutting Skullclamp and Sheoldred made the deck worse', () => {
    expect(compareScores(treat, base)).toBeLessThan(0);
  });

  it('ranks the named payoff loss above the cards that took its slot, in context', () => {
    // The differ: "Skullclamp ... Net effect: Demonic Tutor and Natural Order
    // take the main-pick cardDraw slots, and Skullclamp drops out."
    for (const replacement of ['Demonic Tutor', 'Natural Order']) {
      const back = scoreDeck(swap(TREATMENT, replacement, 'Skullclamp'), ctx);
      expect(back.total - treat.total, replacement).toBeGreaterThan(0.5);
      // Not by popularity alone: Skullclamp feeds on the deck's own deaths.
      expect(termDeltas(back, treat).synergy, replacement).toBeGreaterThan(0);
    }
  });

  it('weights multiply a term, and weight 0 removes it', () => {
    const noMana = scoreDeck(BASELINE, merenCtx({ weights: { mana: 0 } }));
    expect(noMana.terms.mana.contribution).toBe(0);
    expect(noMana.total).toBeCloseTo(base.total - base.terms.mana.contribution);
  });
});
