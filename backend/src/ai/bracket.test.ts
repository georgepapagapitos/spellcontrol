import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { createTagLookup, type BracketEstimation } from '@spellcontrol/deck-metrics';
import { ScryfallCache } from '../cache';
import { estimateForNames, renderBracketCheck } from './bracket';
import { checkBracketTool } from './tools';
import type { ScryfallCard } from '../types';

function card(overrides: Partial<ScryfallCard> & { id: string; name: string }): ScryfallCard {
  return {
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    collector_number: '1',
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

let dir: string;
let cache: ScryfallCache;

/** No tags at all — the estimator's soft signals stay quiet unless a test adds some. */
const NO_TAGS = createTagLookup({});
const noCombos = async () => [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bracket-test-'));
  cache = new ScryfallCache(path.join(dir, 'cards.db'));
  const cards = [
    card({ id: 'i1', name: 'Forest', oracle_id: 'o1', type_line: 'Basic Land — Forest', cmc: 0 }),
    card({
      id: 'i2',
      name: 'Llanowar Elves',
      oracle_id: 'o2',
      type_line: 'Creature — Elf',
      cmc: 1,
    }),
    card({ id: 'i3', name: 'Rhystic Study', oracle_id: 'o3', type_line: 'Enchantment', cmc: 3 }),
    card({ id: 'i4', name: 'Armageddon', oracle_id: 'o4', type_line: 'Sorcery', cmc: 4 }),
    // An MDFC spell: Scryfall's top-level type line combines both faces.
    card({
      id: 'i5',
      name: 'Bala Ged Recovery // Bala Ged Sanctuary',
      oracle_id: 'o5',
      type_line: 'Sorcery // Land',
      cmc: 3,
      card_faces: [
        { name: 'Bala Ged Recovery', type_line: 'Sorcery' },
        { name: 'Bala Ged Sanctuary', type_line: 'Land' },
      ],
    }),
  ];
  cache.setMany(cards);
  // Multi-face cards are looked up under their front face, as the real cache does.
  cache.setLookups(
    cards.map((c) => ({
      key: `ns:${c.name.split(' // ')[0].toLowerCase()}|tst`,
      scryfallId: c.id,
    }))
  );
});

afterEach(() => {
  cache.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const inputs = () => ({ cache, tags: NO_TAGS, loadCombos: noCombos });

describe('estimateForNames', () => {
  it('scores a plain deck without any hard floor', async () => {
    const est = await estimateForNames(['Forest', 'Llanowar Elves'], inputs());
    expect(est.hardFloors).toEqual([]);
    expect(est.bracket).toBeGreaterThanOrEqual(1);
  });

  it('raises a hard floor for a game changer, using the SHARED list', async () => {
    // Rhystic Study is on the RC list that now lives in @spellcontrol/deck-metrics.
    // This is the assertion that would fail if the backend lost its game-changer
    // source — the floor would silently disappear rather than error.
    const est = await estimateForNames(['Forest', 'Rhystic Study'], inputs());
    expect(est.breakdown.gameChangerNames).toContain('Rhystic Study');
    expect(est.hardFloors.length).toBeGreaterThan(0);
  });

  it('raises a hard floor for mass land denial via the injected tags', async () => {
    const tags = createTagLookup({ 'mass-land-denial': ['Armageddon'] });
    const est = await estimateForNames(['Forest', 'Armageddon'], {
      ...inputs(),
      tags,
    });
    expect(est.breakdown.massLandDenialNames).toContain('Armageddon');
  });

  it('counts roles from the SAME tag data the estimator reads', async () => {
    const tags = createTagLookup({ removal: ['Armageddon'], ramp: ['Llanowar Elves'] });
    const est = await estimateForNames(['Armageddon', 'Llanowar Elves', 'Forest'], {
      ...inputs(),
      tags,
    });
    // interactionCount is driven by roleCounts; a removal card must register.
    expect(est.breakdown.interactionCount).toBeGreaterThan(0);
  });

  // Defect B guards: role counts must mirror the deck page — mainboard
  // non-lands only, gated on the card's own oracle text (checkRoleEvidence,
  // shared via deck-metrics), commander(s) excluded from both role counts and
  // the average CMC. Before this, `estimateForNames` counted a role over
  // EVERY name (lands and commanders included) with no evidence gate at all.
  it('does not count a land with a tagger role toward interaction — role counts exclude lands', async () => {
    const wastelandCard = card({
      id: 'i6',
      name: 'Field of Ruin',
      oracle_id: 'o6',
      type_line: 'Land',
      cmc: 0,
      oracle_text: 'Destroy target nonbasic land an opponent controls.',
    });
    cache.setMany([wastelandCard]);
    cache.setLookups([{ key: `ns:${wastelandCard.name.toLowerCase()}|tst`, scryfallId: 'i6' }]);
    // Tagged removal (correctly, even — the oracle text really is removal) but
    // it is still a land, and the page never counts a land toward roles.
    const tags = createTagLookup({ removal: ['Field of Ruin'] });
    const est = await estimateForNames(['Forest', 'Field of Ruin'], { ...inputs(), tags });
    expect(est.breakdown.interactionCount).toBe(0);
  });

  it("does not count a tagged card whose oracle text lacks the role's evidence", async () => {
    const mistagged = card({
      id: 'i7',
      name: 'Mistagged Bear',
      oracle_id: 'o7',
      type_line: 'Creature — Bear',
      cmc: 2,
      oracle_text: 'Vigilance.', // no destroy/exile/counter/etc — a bad removal tag
    });
    cache.setMany([mistagged]);
    cache.setLookups([{ key: `ns:${mistagged.name.toLowerCase()}|tst`, scryfallId: 'i7' }]);
    const tags = createTagLookup({ removal: ['Mistagged Bear'] });
    const est = await estimateForNames(['Forest', 'Mistagged Bear'], { ...inputs(), tags });
    expect(est.breakdown.interactionCount).toBe(0);
  });

  it("excludes the commander's CMC from the average, like the deck page does", async () => {
    // Llanowar Elves (cmc 1) is the commander here — only Rhystic Study (cmc 3)
    // should count toward the average.
    const est = await estimateForNames(['Llanowar Elves', 'Rhystic Study'], {
      ...inputs(),
      commanderNames: ['Llanowar Elves'],
    });
    expect(est.breakdown.averageCmc).toBe(3);
  });

  it('excludes lands from the average mana value', async () => {
    // Forest (cmc 0) must not drag the average down — only Llanowar Elves counts.
    const est = await estimateForNames(['Forest', 'Llanowar Elves'], inputs());
    expect(est.breakdown.averageCmc).toBe(1);
  });

  it('counts an MDFC by its front face, like the deck page does', async () => {
    // "Sorcery // Land" once matched /Land/ and the spell left the average.
    const est = await estimateForNames(
      ['Forest', 'Llanowar Elves', 'Bala Ged Recovery // Bala Ged Sanctuary'],
      inputs()
    );
    expect(est.breakdown.averageCmc).toBe(2);
  });

  it('ignores a name the cache has never heard of rather than throwing', async () => {
    const est = await estimateForNames(['Forest', 'Not A Real Card At All'], inputs());
    expect(est.bracket).toBeGreaterThanOrEqual(1);
  });

  it('knows the commander: a commander + one-card combo floors at 4, as on the deck page', async () => {
    const combo = {
      id: '1-2',
      identity: 'g',
      produces: ['Infinite mana'],
      prerequisites: null,
      description: null,
      manaNeeded: null,
      popularity: 1,
      legalities: { commander: 'legal' },
      cardCount: 2,
      bracket: 3,
      bracketTag: 'S',
      cards: [
        { oracleId: 'o2', cardName: 'Llanowar Elves', quantity: 1 },
        { oracleId: 'o1', cardName: 'Forest', quantity: 1 },
      ],
    };
    const withCombo = { ...inputs(), loadCombos: async () => [combo] };
    const names = ['Llanowar Elves', 'Forest'];
    expect((await estimateForNames(names, withCombo)).bracket).toBe(3);
    const est = await estimateForNames(names, { ...withCombo, commanderNames: ['Llanowar Elves'] });
    expect(est.bracket).toBe(4);
  });

  it('survives a combo lookup that throws — a floor is lost, not the answer', async () => {
    const est = await estimateForNames(['Forest', 'Llanowar Elves'], {
      ...inputs(),
      loadCombos: async () => {
        throw new Error('postgres is down');
      },
    });
    expect(est.bracket).toBeGreaterThanOrEqual(1);
  });

  it("resolves a template combo against the deck's own cards", async () => {
    // 5034--46: Hullbreaker Horror + Sol Ring + "Permanent Castable for {C}".
    cache.setMany([
      card({
        id: 'hh',
        name: 'Hullbreaker Horror',
        oracle_id: 'ohh',
        type_line: 'Creature — Horror',
        cmc: 8,
      }),
      card({
        id: 'sr',
        name: 'Sol Ring',
        oracle_id: 'osr',
        type_line: 'Artifact',
        mana_cost: '{1}',
        cmc: 1,
      }),
      card({
        id: 'ma',
        name: 'Mox Amber',
        oracle_id: 'oma',
        type_line: 'Legendary Artifact',
        mana_cost: '{0}',
        cmc: 0,
      }),
    ]);
    cache.setLookups(
      [
        { name: 'Hullbreaker Horror', id: 'hh' },
        { name: 'Sol Ring', id: 'sr' },
        { name: 'Mox Amber', id: 'ma' },
      ].map((c) => ({ key: `ns:${c.name.toLowerCase()}|tst`, scryfallId: c.id }))
    );
    const templateCombo = {
      id: '1-2--46',
      identity: 'u',
      produces: ['Infinite bounce'],
      prerequisites: null,
      description: null,
      manaNeeded: null,
      popularity: 1,
      legalities: { commander: 'legal' },
      cardCount: 2,
      bracket: 4,
      bracketTag: 'R',
      templateQueries: ['mv<=1 (mana={0} or mana={1} or mana={C}) is:permanent'],
      cards: [
        { oracleId: 'ohh', cardName: 'Hullbreaker Horror', quantity: 1 },
        { oracleId: 'osr', cardName: 'Sol Ring', quantity: 1 },
      ],
    };
    const withCombo = { ...inputs(), loadCombos: async () => [templateCombo] };

    // Without a qualifying deck card the template stays unresolved: no floor.
    const unresolved = await estimateForNames(['Hullbreaker Horror', 'Sol Ring'], withCombo);
    expect(unresolved.breakdown.twoCardComboCount).toBe(0);

    // Mox Amber satisfies "Permanent Castable for {C}" (not one of the combo's
    // named pieces) — the combo now counts toward the floor like any other.
    const resolved = await estimateForNames(
      ['Hullbreaker Horror', 'Sol Ring', 'Mox Amber'],
      withCombo
    );
    expect(resolved.breakdown.twoCardComboCount).toBe(1);
  });
});

describe('renderBracketCheck', () => {
  const est = (bracket: 1 | 2 | 3 | 4 | 5): BracketEstimation => ({
    bracket,
    label: 'x',
    hardFloors: [],
    softScore: 0,
    breakdown: {
      gameChangerCount: 0,
      gameChangerNames: [],
      massLandDenialCount: 0,
      massLandDenialNames: [],
      extraTurnCount: 0,
      extraTurnNames: [],
      twoCardComboCount: 0,
      multiCardComboCount: 0,
      fastManaCount: 0,
      fastManaNames: [],
      tutorCount: 0,
      tutorNames: [],
      staxPieceCount: 0,
      staxPieceNames: [],
      averageCmc: 0,
      interactionCount: 0,
    },
  });

  it('says plainly when nothing moved', () => {
    const out = renderBracketCheck(est(2), est(2), { add: 'A', cut: 'B' });
    expect(out).toMatch(/does NOT change the bracket/);
    expect(out).toMatch(/still 2/);
  });

  it('names the direction rather than leaving two numbers to interpret', () => {
    expect(renderBracketCheck(est(2), est(4), { add: 'A' })).toMatch(/moves the bracket UP/);
    expect(renderBracketCheck(est(4), est(2), { cut: 'B' })).toMatch(/moves the bracket DOWN/);
  });

  it('states the scale, because the model has inverted it before', () => {
    expect(renderBracketCheck(est(2), est(2), {})).toMatch(/1 Exhibition.*5 cEDH/);
  });
});

describe('check_bracket tool', () => {
  const deck = ['Forest', 'Llanowar Elves'];
  const tool = () =>
    checkBracketTool(deck, (names) => estimateForNames(names, inputs()), renderBracketCheck);

  it('refuses a call with neither an add nor a cut', async () => {
    const { text } = await tool().run({});
    expect(text).toMatch(/there is no change to check/);
  });

  it('computes the unchanged "before" estimate ONCE across calls', async () => {
    // Measured 4-5 checks per review, each two estimates deep, and every
    // estimate is a combo query. The before side never varies — same deck,
    // same inputs — so it is worth exactly one.
    let estimates = 0;
    const counting = checkBracketTool(
      deck,
      (names) => {
        estimates++;
        return estimateForNames(names, inputs());
      },
      renderBracketCheck
    );
    await counting.run({ add: 'Rhystic Study' });
    await counting.run({ add: 'Armageddon' });
    await counting.run({ cut: 'Llanowar Elves' });
    // 1 baseline + 1 per call, not 2 per call.
    expect(estimates).toBe(4);
  });

  it('stops a model that loops on the tool instead of answering', async () => {
    const t = tool();
    for (let i = 0; i < 12; i++) await t.run({ add: 'Rhystic Study' });
    const { text } = await t.run({ add: 'Rhystic Study' });
    expect(text).toMatch(/enough. Decide with what you already know/);
  });

  it('refuses to cut a card that is not in the deck', async () => {
    const { text } = await tool().run({ cut: 'Rhystic Study' });
    expect(text).toMatch(/not in the decklist/);
  });

  it('reports the floor a proposed add introduces', async () => {
    const { text } = await tool().run({ add: 'Rhystic Study', cut: 'Llanowar Elves' });
    expect(text).toMatch(/Adding Rhystic Study and cutting Llanowar Elves/);
    expect(text).toMatch(/game changer/i);
  });

  it('vouches for no card text — it is not a citation source', async () => {
    const { fetched } = await tool().run({ add: 'Rhystic Study' });
    expect(fetched).toEqual([]);
  });
});
