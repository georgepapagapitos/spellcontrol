// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck } from '@/store/decks';
import type { ArrivalCandidateCard } from './new-arrivals';
import { computeNewArrivals } from './new-arrivals';
import { aggregateNewArrivalDecks } from '@/lib/home/home-signals';
import {
  coachWantedNames,
  type CoachLanes,
  narrowArrivals,
  readArrivalWatchlists,
  rememberArrivalWatchlist,
} from './arrival-watchlist';

function card(name: string, colorIdentity: string[] = []): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 2,
    type_line: 'Creature — Goblin',
    color_identity: colorIdentity,
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test Set',
    prices: {},
    legalities: { commander: 'legal' },
  } as unknown as ScryfallCard;
}

function deck(overrides: Partial<Deck>): Deck {
  return {
    id: 'd',
    name: 'Deck',
    format: 'commander',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    generationContext: null,
    color: '#888888',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Deck;
}

const T = 1_000_000;
const own = (
  name: string,
  colorIdentity: string[],
  at: number,
  extra: Partial<ArrivalCandidateCard> = {}
): ArrivalCandidateCard => ({
  name,
  typeLine: 'Creature — Goblin',
  cmc: 2,
  colorIdentity,
  updatedAt: at,
  ...extra,
});

describe('Home and the deck page count the same new cards', () => {
  // The bug this guards: Home counted every card in color identity bought
  // since the last edit (and summed copies); the deck page narrowed to the
  // coach's picks and counted names. Home said +2 and the deck showed none.
  const goblins = deck({
    id: 'goblins',
    updatedAt: T,
    commander: card('Krenko, Mob Boss', ['R']),
    cards: [{ card: card('Goblin Guide', ['R']) }] as Deck['cards'],
  });
  const sultai = deck({
    id: 'sultai',
    updatedAt: T,
    lastArrivalReviewAt: T + 1500,
    commander: card('Muldrotha, the Gravetide', ['B', 'G', 'U']),
  });
  const decks = [goblins, sultai];
  const addedAtByImportId = new Map([['imp', T + 2000]]);
  const collection: ArrivalCandidateCard[] = [
    own('Skirk Prospector', ['R'], T + 1000),
    own('Skirk Prospector', ['R'], T + 1000),
    own('Skirk Prospector', ['R'], T - 5),
    own('Goblin Recruiter', ['R'], 0, { importId: 'imp' }),
    own('Lightning Bolt', ['R'], T + 1000),
    own('Goblin Guide', ['R'], T + 1000),
    own('Mountain', ['R'], T + 1000),
    own('Sol Ring', [], T + 1000),
    own('Old Card', ['R'], T - 1000),
    own('Eternal Witness', ['G'], T + 1000),
    own('Sakura-Tribe Elder', ['G'], T + 2000),
    own('Birds of Paradise', ['G'], 0, { importId: 'imp' }),
  ];
  const coach = {
    goblins: coachWantedNames(
      {
        gaps: [{ name: 'Skirk Prospector' }, { name: 'Goblin Guide' }, { name: 'Mountain' }],
        synergy: [{ cardName: 'Sol Ring' }, { cardName: 'Old Card' }],
        hiddenGems: [{ name: 'Eternal Witness' }],
      },
      [
        {
          missingOracleIds: ['recruiter'],
          combo: {
            cards: [
              { oracleId: 'krenko', cardName: 'Krenko, Mob Boss' },
              { oracleId: 'recruiter', cardName: 'Goblin Recruiter' },
            ],
          },
        },
      ]
    ),
    sultai: coachWantedNames(
      {
        gaps: [{ name: 'Eternal Witness' }],
        hiddenGems: [{ name: 'Sakura-Tribe Elder' }, { name: 'Birds of Paradise' }],
      },
      undefined
    ),
  };

  it.each(decks.map((d) => [d.id, d] as const))('%s', (_id, d) => {
    const deckPage = Object.values(
      narrowArrivals(
        computeNewArrivals({
          commander: d.commander,
          partnerCommander: d.partnerCommander,
          cards: d.cards,
          sideboard: d.sideboard,
          deckUpdatedAt: d.updatedAt,
          lastArrivalReviewAt: d.lastArrivalReviewAt,
          collectionCards: collection,
          addedAtByImportId,
        }),
        coach[d.id as keyof typeof coach]
      )
    ).flat().length;
    const home =
      aggregateNewArrivalDecks(decks, collection, addedAtByImportId, coach).find(
        (r) => r.deck.id === d.id
      )?.count ?? 0;
    expect(deckPage).toBeGreaterThan(0);
    expect(home).toBe(deckPage);
  });
});

describe('coachWantedNames', () => {
  // Found driving the real app: a Krenko deck's list was recorded, then
  // Fireball was bought. Fireball became an owned substitute for a missing
  // burn staple, so the deck page counted 3 while Home, holding the list from
  // before the purchase, counted 2. Lanes that name only owned cards stay out.
  it('takes no owned-only lane, so a purchase cannot change the list', () => {
    const lanes = { gaps: [{ name: 'Goblin Recruiter' }] };
    const before = coachWantedNames(lanes, undefined);
    const withSubstitutes = {
      ...lanes,
      // @ts-expect-error substitutes are an owned-only lane
      substitutes: [{ usedName: 'Fireball' }],
    } satisfies CoachLanes;
    const after = coachWantedNames(withSubstitutes, undefined);
    expect([...after]).toEqual([...before]);
  });

  it('ignores a combo missing more than one card', () => {
    const oneAway = [
      {
        missingOracleIds: ['a', 'b'],
        combo: {
          cards: [
            { oracleId: 'a', cardName: 'A' },
            { oracleId: 'b', cardName: 'B' },
          ],
        },
      },
    ];
    expect(coachWantedNames({}, oneAway).size).toBe(0);
  });
});

describe('arrival watchlist storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a deck list', () => {
    rememberArrivalWatchlist('a', new Set(['sol ring', 'arcane signet']), ['a']);
    expect(readArrivalWatchlists()).toEqual({ a: new Set(['arcane signet', 'sol ring']) });
  });

  it('drops lists for decks that no longer exist', () => {
    rememberArrivalWatchlist('a', new Set(['x']), ['a', 'b']);
    rememberArrivalWatchlist('b', new Set(['y']), ['a', 'b']);
    rememberArrivalWatchlist('b', new Set(['y']), ['b']);
    expect(Object.keys(readArrivalWatchlists())).toEqual(['b']);
  });

  it('writes only when the list changes', () => {
    rememberArrivalWatchlist('a', new Set(['x', 'y']), ['a']);
    const set = vi.spyOn(Storage.prototype, 'setItem');
    rememberArrivalWatchlist('a', new Set(['y', 'x']), ['a']);
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
  });

  it('reads nothing from a corrupt entry', () => {
    localStorage.setItem('sc-arrival-watch', '{not json');
    expect(readArrivalWatchlists()).toEqual({});
  });
});
