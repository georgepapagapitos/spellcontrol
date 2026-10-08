// Pins the pure parts of the decklist corpus (E516) on real captured payloads:
// an EDHREC average deck (Atraxa) and an EDHTop16 top-cut entry.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  TOURNAMENT_WEIGHT_BELOW_4,
  chooseSwaps,
  cooccurrence,
  countCards,
  dedupeDecks,
  edhrecAverageDeck,
  edhtop16Decks,
  rng,
  tally,
  tournamentWeight,
} from './decklist-corpus-lib.mjs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'));

describe('edhrecAverageDeck', () => {
  const deck = edhrecAverageDeck(fixture('edhrec-average-atraxa.fixture.json'), { bracket: 3 });

  it('reads the 99 with basic counts and the commander', () => {
    expect(deck.commander).toBe("Atraxa, Praetors' Voice");
    expect(countCards(deck.cards)).toBe(99);
    expect(deck.cards.find((c) => c.name === 'Sol Ring')?.qty).toBe(1);
    expect(deck.source).toBe('edhrec-average');
    expect(deck.bracket).toBe(3);
    expect(deck.numDecks).toBeGreaterThan(1000);
  });

  it('refuses a stub and a payload with no commander', () => {
    expect(
      edhrecAverageDeck({ deck: { commander: ['X'], cards: { Land: [['Forest', 5]] } } })
    ).toBeNull();
    expect(edhrecAverageDeck({ deck: { cards: {} } })).toBeNull();
    expect(edhrecAverageDeck({})).toBeNull();
  });
});

describe('edhtop16Decks', () => {
  const t = fixture('edhtop16-tournament.fixture.json');
  const decks = edhtop16Decks(t);

  it('keeps the list and drops entries with no deck', () => {
    expect(decks).toHaveLength(1);
    expect(decks[0].commander).toBe('Sisay, Weatherlight Captain');
    expect(countCards(decks[0].cards)).toBe(99);
  });

  it('keeps no pilot, player or URL field', () => {
    expect(Object.keys(decks[0]).sort()).toEqual(
      [
        'bracket',
        'cards',
        'commander',
        'eventSize',
        'partner',
        'source',
        'standing',
        'weight',
      ].sort()
    );
  });

  it('splits partners and weights tournament lists low below bracket 4', () => {
    const [p] = edhtop16Decks({
      entries: [
        {
          commander: { name: 'Thrasios, Triton Hero / Tymna the Weaver' },
          maindeck: t.entries[0].maindeck,
        },
      ],
    });
    expect([p.commander, p.partner]).toEqual(['Thrasios, Triton Hero', 'Tymna the Weaver']);
    expect(tournamentWeight(3)).toBe(TOURNAMENT_WEIGHT_BELOW_4);
    expect(tournamentWeight(4)).toBe(1);
  });
});

describe('dedupeDecks and tally', () => {
  it('drops an identical list seen at two events', () => {
    const t = fixture('edhtop16-tournament.fixture.json');
    const [d] = edhtop16Decks(t);
    expect(dedupeDecks([d, { ...d }, { ...d, commander: 'Other' }])).toHaveLength(2);
  });

  it('straightens apostrophes and counts copies', () => {
    expect(tally(['Atraxa, Praetors’ Voice', "Atraxa, Praetors' Voice", 'Forest'])).toEqual([
      { name: "Atraxa, Praetors' Voice", qty: 2 },
      { name: 'Forest', qty: 1 },
    ]);
  });
});

describe('cooccurrence', () => {
  const decks = [
    {
      cards: [
        { name: 'A', qty: 1 },
        { name: 'B', qty: 1 },
        { name: 'C', qty: 1 },
      ],
    },
    {
      cards: [
        { name: 'A', qty: 1 },
        { name: 'B', qty: 1 },
      ],
    },
    {
      cards: [
        { name: 'A', qty: 1 },
        { name: 'C', qty: 1 },
      ],
    },
  ];

  it('counts each pair once per deck and drops rare cards', () => {
    const co = cooccurrence(decks, { minDecks: 2, minPair: 2 });
    expect(co.cards).toEqual(['A', 'B', 'C']);
    const named = co.pairs.map(([i, j, n]) => [co.cards[i], co.cards[j], n]);
    expect(named).toEqual(
      expect.arrayContaining([
        ['A', 'B', 2],
        ['A', 'C', 2],
      ])
    );
    expect(named).toHaveLength(2);
    expect(cooccurrence(decks, { minDecks: 3 }).cards).toEqual(['A']);
  });
});

describe('chooseSwaps', () => {
  const removable = [
    { name: 'Cultivate', role: 'ramp/n', incl: 60 },
    { name: 'Swords to Plowshares', role: 'removal/n', incl: 40 },
    { name: 'Filler Bear', role: 'none/c', incl: 3 },
  ];
  const candidates = [
    { name: 'Kodama Reach', role: 'ramp/n', incl: 58 },
    { name: 'Rampant Growth', role: 'ramp/n', incl: 12 },
    { name: 'Path to Exile', role: 'removal/n', incl: 41 },
    { name: 'Grizzly Bears', role: 'none/c', incl: 1 },
  ];
  const all = [...removable, ...candidates];

  it('swaps within a role and never reuses a card', () => {
    const swaps = chooseSwaps({ removable, candidates, k: 3, mode: 'random', rand: rng(1) });
    expect(swaps).toHaveLength(3);
    expect(new Set(swaps.map((s) => s.in)).size).toBe(3);
    const role = (n) => all.find((c) => c.name === n).role;
    for (const s of swaps) expect(role(s.in)).toBe(role(s.out));
  });

  it('matched mode only brings in cards of similar inclusion', () => {
    const swaps = chooseSwaps({
      removable,
      candidates,
      k: 3,
      mode: 'matched',
      rand: rng(2),
      band: 5,
    });
    const incl = (n) => all.find((c) => c.name === n).incl;
    expect(swaps.length).toBeGreaterThan(0);
    for (const s of swaps) expect(Math.abs(incl(s.in) - incl(s.out))).toBeLessThanOrEqual(5);
    // Cultivate (60) only matches Kodama Reach (58): Rampant Growth (12) is out of band.
    expect(swaps.find((s) => s.out === 'Cultivate')?.in).toBe('Kodama Reach');
  });

  it('is deterministic for a seed and returns nothing when the pool is empty', () => {
    const a = chooseSwaps({ removable, candidates, k: 3, mode: 'random', rand: rng(7) });
    const b = chooseSwaps({ removable, candidates, k: 3, mode: 'random', rand: rng(7) });
    expect(a).toEqual(b);
    expect(chooseSwaps({ removable, candidates: [], k: 3, mode: 'random', rand: rng(7) })).toEqual(
      []
    );
  });
});
