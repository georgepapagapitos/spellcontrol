import { describe, expect, it } from 'vitest';
import type { Customization, EDHRECCommanderData, ScryfallCard } from '@/deck-builder/types';
import { expectedMdfcLandTerm, mdfcLandTermOf } from './mdfcLandTerm';

// Real Scryfall facts (layout, rarity and face type lines) for the cards that
// separate the cases: two spell/land MDFCs, a Land // Land Pathway, a plain land.
const card = (name: string, layout: string, rarity: string, faces: string[]): ScryfallCard =>
  ({
    name,
    layout,
    rarity,
    type_line: faces.join(' // '),
    card_faces: faces.length > 1 ? faces.map((type_line) => ({ type_line })) : undefined,
  }) as unknown as ScryfallCard;

const TURNTIMBER = card(
  'Turntimber Symbiosis // Turntimber, Serpentine Wood',
  'modal_dfc',
  'mythic',
  ['Sorcery', 'Land']
);
const SHATTERSKULL = card(
  'Shatterskull Smashing // Shatterskull, the Hammer Pass',
  'modal_dfc',
  'mythic',
  ['Sorcery', 'Land']
);
const HAGRA = card('Hagra Mauling // Hagra Broodpit', 'modal_dfc', 'uncommon', ['Instant', 'Land']);
const PATHWAY = card('Blightstep Pathway // Searstep Pathway', 'modal_dfc', 'rare', [
  'Land',
  'Land',
]);
const SWAMP = card('Swamp', 'normal', 'common', ['Basic Land \u2014 Swamp']);

describe('mdfcLandTermOf', () => {
  it('weighs a mythic spell/land MDFC 0.74 and any other 0.38', () => {
    expect(mdfcLandTermOf([TURNTIMBER])).toBeCloseTo(0.74);
    expect(mdfcLandTermOf([HAGRA])).toBeCloseTo(0.38);
    expect(mdfcLandTermOf([TURNTIMBER, SHATTERSKULL, HAGRA])).toBeCloseTo(0.74 + 0.74 + 0.38);
  });

  it('ignores a Pathway (Land // Land) and plain lands', () => {
    expect(mdfcLandTermOf([PATHWAY, SWAMP])).toBe(0);
  });
});

const page = (lands: Array<[string, number]>) =>
  ({
    cardlists: { lands: lands.map(([name, inclusion]) => ({ name, inclusion })) },
  }) as unknown as EDHRECCommanderData;
const defaults = { landCount: 37, nonBasicLandCount: 15, landsExplicit: false } as Pick<
  Customization,
  'landCount' | 'nonBasicLandCount' | 'landsExplicit'
>;

describe('expectedMdfcLandTerm', () => {
  const byName = new Map([HAGRA, TURNTIMBER, PATHWAY].map((c) => [c.name, c]));
  const fetched: string[][] = [];
  const fetchCards = async (names: string[]) => {
    fetched.push(names);
    return new Map(names.flatMap((n) => (byName.has(n) ? [[n, byName.get(n)!] as const] : [])));
  };

  it('counts the page lands at 25%+ that are spell/land MDFCs', async () => {
    fetched.length = 0;
    const term = await expectedMdfcLandTerm({
      format: 99,
      customization: defaults,
      edhrecData: page([
        [HAGRA.name, 40],
        [TURNTIMBER.name, 10],
        [PATHWAY.name, 60],
      ]),
      fetchCards,
    });
    expect(term).toBeCloseTo(0.38); // Turntimber is under the bar, the Pathway is not an MDFC land
    expect(fetched[0]).toEqual([HAGRA.name, PATHWAY.name]);
  });

  it('fetches nothing when the player set the lands or the format is not 99', async () => {
    fetched.length = 0;
    const data = page([[HAGRA.name, 40]]);
    const set = { ...defaults, landsExplicit: true };
    expect(
      await expectedMdfcLandTerm({ format: 99, customization: set, edhrecData: data, fetchCards })
    ).toBe(0);
    expect(
      await expectedMdfcLandTerm({
        format: 60,
        customization: defaults,
        edhrecData: data,
        fetchCards,
      })
    ).toBe(0);
    expect(
      await expectedMdfcLandTerm({
        format: 99,
        customization: defaults,
        edhrecData: null,
        fetchCards,
      })
    ).toBe(0);
    expect(fetched).toEqual([]);
  });
});
