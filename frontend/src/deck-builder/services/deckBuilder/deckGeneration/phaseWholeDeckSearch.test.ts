// @vitest-environment node
//
// E513 round 3: a swap's stated reason makes a case for the card that came in
// (Vexing Puzzlebox for Swiftfoot Boots was stated only by what Boots gave),
// and owns up to a repair that left the trust region.
import { describe, expect, it } from 'vitest';
import type { AppliedSwap } from '../deckObjective/optimizer';
import type { ScryfallCard } from '@/deck-builder/types';
import { BASELINE, card, merenCtx } from '../deckObjective/__fixtures__/objectiveFixture';
import {
  applySearchSwaps,
  landSeatedSpells,
  ownedExtraCandidates,
  reasonLine,
} from './phaseWholeDeckSearch';
import type { GenerationState } from './state';

const swap = (over: Partial<AppliedSwap>): AppliedSwap =>
  ({
    out: ['Swiftfoot Boots'],
    in: ['Vexing Puzzlebox'],
    kind: 'repair',
    delta: -1,
    terms: {},
    summary: '',
    reasons: [
      { name: 'Swiftfoot Boots', term: 'interaction', value: -1.5, note: 'protection #1 (1.49)' },
      { name: 'Swiftfoot Boots', term: 'quality', value: -0.6, note: "54.7% of this page's decks" },
      { name: 'Swiftfoot Boots', term: 'curve', value: -0.4, note: 'castable on curve 99.3%' },
      { name: 'Vexing Puzzlebox', term: 'mana', value: 0.2, note: 'a rock that adds one mana' },
    ],
    ...over,
  }) as AppliedSwap;

describe('reasonLine', () => {
  it('states why the card came in, with no heading repeated', () => {
    const line = reasonLine(swap({}));
    expect(line).toContain('A build rule you set needed this swap');
    expect(line).not.toContain('Vexing Puzzlebox for Swiftfoot Boots');
    expect(line).not.toMatch(/#\d|\(\d+\.\d+\)|price-adjusted|doublings|card-equivalent/);
  });

  it('says so when a repair had to leave the trust region', () => {
    const line = reasonLine(
      swap({ disclosure: 'no owned card fits inside the role limits (ramp would rise to 23)' })
    );
    expect(line).toMatch(
      /Outside the usual limits, because no card you own fits inside the role limits/
    );
  });
});

// E509: a collection build resolves the owned lands the list doesn't hold, even
// with every ownership rule met, so the search can seat one for a basic. Real
// Meren cards; the list owns itself and two lands it doesn't play.
describe('ownedExtraCandidates', () => {
  const LANDS = ["Gaea's Cradle", 'Phyrexian Tower'];
  const SPELL = 'Eternal Witness';
  const inList = new Set(BASELINE.cards.map((c) => c.name));
  const owned = new Set([...inList, ...LANDS, SPELL]);
  const ctx = merenCtx({
    ownedNames: owned,
    customization: {
      deckFormat: 99,
      currency: 'USD',
      collectionMode: true,
      collectionStrategy: 'prefer',
    },
  });
  const state = {
    bannedCards: new Set<string>(),
    context: {
      colorIdentity: ['B', 'G'],
      collectionPool: [...LANDS, SPELL].map((name) => ({
        name,
        colorIdentity: card(name).color_identity,
        typeLine: card(name).type_line,
      })),
    },
  } as unknown as GenerationState;
  const run = (resolved: string[]) =>
    ownedExtraCandidates(
      state,
      BASELINE,
      ctx,
      {
        resolveOwned: async (names: string[]) =>
          new Map<string, ScryfallCard>(
            names.filter((n) => resolved.includes(n)).map((n) => [n, card(n)])
          ),
      } as never,
      [],
      () => true,
      new Set()
    );

  it('keeps the owned lands the list does not hold, and no spell while no rule is broken', async () => {
    const got = await run([...LANDS, SPELL]);
    expect([...got.keys()].sort()).toEqual([...LANDS].sort());
  });
});

// Nightly 2026-10-09, Yuriko kitchen-sink: the search swapped Aetherize for
// Devastation Tide, then Devastation Tide for Covert Technician. Applying the
// first swap looked Devastation Tide up in the final list, didn't find it, and
// skipped cutting Aetherize, so the deck shipped 101 cards.
describe('applySearchSwaps', () => {
  const named = (name: string, type_line = 'Instant') => ({ name, type_line }) as ScryfallCard;
  const stateWith = (cards: ScryfallCard[]) =>
    ({
      categories: {
        lands: [],
        ramp: [],
        cardDraw: [],
        singleRemoval: [],
        boardWipes: [],
        creatures: [],
        synergy: cards,
        utility: [],
      },
      usedNames: new Set(cards.map((c) => c.name)),
      bannedCards: new Set<string>(),
      currentRoleCounts: {},
      gameChangerNames: new Set<string>(),
      gameChangerCount: { value: 0 },
    }) as unknown as GenerationState;

  it('applies a chained swap, so the card count holds', () => {
    const state = stateWith([named('Aetherize'), named('Opt')]);
    const byName = new Map(
      [named('Devastation Tide', 'Sorcery'), named('Covert Technician', 'Creature — Human')].map(
        (c) => [c.name, c]
      )
    );
    const records = applySearchSwaps(
      state,
      [
        swap({ out: ['Aetherize'], in: ['Devastation Tide'] }),
        swap({ out: ['Devastation Tide'], in: ['Covert Technician'] }),
      ],
      byName
    );
    const names = Object.values(state.categories)
      .flat()
      .map((c) => c.name)
      .sort();
    expect(names).toEqual(['Covert Technician', 'Opt']);
    expect(records.map((r) => `${r.cut}>${r.added}`)).toEqual([
      'Aetherize>Devastation Tide',
      'Devastation Tide>Covert Technician',
    ]);
  });
});

// Nightly 2026-10-07..09: the search read Bala Ged Recovery // Bala Ged
// Sanctuary, seated as a land, as a spell and traded it for one, so the deck
// delivered a land short of its plan.
describe('landSeatedSpells', () => {
  it('names the spell // land MDFCs in the lands category, not the plain lands', () => {
    const mdfc = {
      name: 'Bala Ged Recovery // Bala Ged Sanctuary',
      type_line: 'Sorcery // Land',
      card_faces: [{ type_line: 'Sorcery' }, { type_line: 'Land' }],
    } as ScryfallCard;
    const forest = { name: 'Forest', type_line: 'Basic Land — Forest' } as ScryfallCard;
    const categories = { lands: [mdfc, forest] } as unknown as GenerationState['categories'];
    expect(landSeatedSpells(categories)).toEqual([mdfc.name]);
  });
});
