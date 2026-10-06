// Guard (E540 S-combo): the shadow run of the whole-deck objective over 119
// labelled decks found one clear win over Coach's feed order: a one-card combo
// add that ends the game sat at #17-43 in the legacy feed. The cause is the
// within-tier key (coach-rank.ts): [ownership, plan band, EDHREC inclusion, ...].
// A combo completion carries no inclusion, so it sorted behind every row that
// had one, and an unowned piece was tier 3 besides. A game-ending completion is
// now tier 1 where combos count (the objective's own bracket gate) and the deck
// can seat it, and it leads its ownership class by the line's deck count.
//
// The combo records are real Commander Spellbook variants (fetched 2026-10-06):
// 307-3821-4520 (Thousand-Faced Shadow + Silver-Fur Master + Peregrine Drake)
// and 307-2327-3821 (Thousand-Faced Shadow + Peregrine Drake + Moon-Circuit
// Hacker), both producing "Infinite combat damage". The competing rows are the
// real fill-gaps rows (name, play rate) the Yuriko collection deck's feed held
// ahead of Peregrine Drake in the shadow run.
import { describe, it, expect } from 'vitest';
import type { GapAnalysisCard, ScryfallCard } from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';
import { comboEndsGame } from '@/deck-builder/services/winConditions/detect';
import { buildCoachChanges } from './coach-changes';
import { rankCoachMoves, diversifyRankedMoves, type CoachContext } from './coach-rank';
import { replaceCuts } from './replace-cuts';

const TFS = '98636623-bbc6-4935-a2bb-2234691eb6d8';
const DRAKE = '0bd67481-6bd9-48d6-92bd-8933b5ea1eae';
const SILVER_FUR = '60ec735d-c9be-4776-beb7-f603ae22edbf';
const HACKER = '7cd8b017-8d59-4b55-bb9a-8d8e492ef1ac';
const HULLBREAKER = 'd4a84e78-d9b9-4c67-8a4b-4329e65f0f15';
const SOL_RING = '6ad8011d-3471-4369-9d68-b264cc027487';

const combo = (
  id: string,
  popularity: number,
  produces: string[],
  cards: Array<[string, string]>,
  missing: string,
  bracketTag = 'E'
): ComboMatch => ({
  combo: {
    id,
    identity: 'UB',
    produces,
    prerequisites: null,
    description: null,
    manaNeeded: '',
    popularity,
    cardCount: cards.length,
    bracket: null,
    bracketTag,
    cards: cards.map(([oracleId, cardName]) => ({ oracleId, cardName, quantity: 1 })),
  },
  presentOracleIds: cards.map(([o]) => o).filter((o) => o !== missing),
  missingOracleIds: [missing],
});

const drakeLine = combo(
  '307-3821-4520',
  3738,
  [
    'Infinite creature tokens',
    'Infinite creature ETB',
    'Infinite creature LTB',
    'Infinite combat damage',
  ],
  [
    [TFS, 'Thousand-Faced Shadow'],
    [DRAKE, 'Peregrine Drake'],
    [SILVER_FUR, 'Silver-Fur Master'],
  ],
  DRAKE
);
const hackerLine = combo(
  '307-2327-3821',
  2484,
  [
    'Infinite combat damage to one opponent',
    'Infinite creature tokens',
    'Infinite creature ETB',
    'Infinite creature LTB',
  ],
  [
    [TFS, 'Thousand-Faced Shadow'],
    [DRAKE, 'Peregrine Drake'],
    [HACKER, 'Moon-Circuit Hacker'],
  ],
  HACKER
);
/** Spellbook 307-344-3821: the same partner set as hackerLine, a third line off those pieces. */
const SKULLSNATCHER = '5326381e-e5e7-4c3e-9565-4837b3ffaec0';
const skullsnatcherLine = combo(
  '307-344-3821',
  936,
  [
    'Infinite combat damage to one opponent',
    'Infinite creature tokens',
    'Infinite creature ETB',
    'Infinite creature LTB',
  ],
  [
    [TFS, 'Thousand-Faced Shadow'],
    [DRAKE, 'Peregrine Drake'],
    [SKULLSNATCHER, 'Skullsnatcher'],
  ],
  SKULLSNATCHER
);
/** 513-5034--46, tag E: loops, never ends the game (E437). */
const hullbreakerLine = combo(
  '513-5034--46',
  356633,
  ['Infinite colorless mana', 'Infinite storm count'],
  [
    [HULLBREAKER, 'Hullbreaker Horror'],
    [SOL_RING, 'Sol Ring'],
  ],
  HULLBREAKER
);

// The Yuriko deck's fill-gaps rows ahead of the combos in the shadow run: [name, play rate %].
const GAPS: Array<[string, number]> = [
  ['Dauthi Voidwalker', 30.1],
  ["An Offer You Can't Refuse", 43.6],
  ['Baleful Strix', 40.9],
  ['Tormented Soul', 35.5],
  ['Sea Gate Restoration', 34.2],
  ['Negate', 34.1],
  ['Flare of Denial', 34.0],
  ['Hydroelectric Specimen', 32.7],
  ['Universal Automaton', 31.3],
  ['Cover of Darkness', 31.2],
  ['Temporal Mastery', 30.6],
  ['Mockingbird', 30.2],
  ['Roaming Throne', 29.5],
  ['Force of Negation', 29.5],
  ['Siren Stormtamer', 26.4],
  ['Memnite', 26.1],
  ['Phyrexian Walker', 24.4],
].map(([name, inclusion]) => [name, inclusion] as [string, number]);

const gaps: GapAnalysisCard[] = GAPS.map(([name, inclusion]) => ({
  name,
  price: null,
  inclusion,
  synergy: 0,
  typeLine: 'Creature',
}));

const ctx = (over: Partial<CoachContext> = {}): CoachContext => ({
  roleCounts: {},
  roleTargets: {},
  deckSize: 99,
  deckTarget: 100,
  bracketOverridePresent: false,
  ownedNames: new Set(),
  ...over,
});

const names = (oneAwayCombos: ComboMatch[], c: CoachContext, owned: string[] = []) => {
  const ownedSet = new Set(owned);
  const changes = buildCoachChanges(
    { gaps, synergy: [], substitutes: [], oneAwayCombos },
    (n) => (ownedSet.has(n) ? 'owned' : 'unowned'),
    new Set()
  );
  return diversifyRankedMoves(rankCoachMoves(changes, c)).map((m) => m.change.name);
};

describe('a game-ending combo completion ranks as a combo (E540)', () => {
  it('reads the real records the way Spellbook does', () => {
    expect(comboEndsGame(drakeLine.combo.produces)).toBe(true);
    expect(comboEndsGame(hackerLine.combo.produces)).toBe(true);
    expect(comboEndsGame(hullbreakerLine.combo.produces)).toBe(false);
  });

  it('puts the unowned completion in the first fold at target bracket 4', () => {
    const order = names([drakeLine], ctx({ targetBracket: 4 }));
    expect(order.indexOf('Peregrine Drake')).toBeLessThan(3);
  });

  it('promotes with no stated bracket, as the objective pays combos there too', () => {
    expect(names([drakeLine], ctx({ targetBracket: 'all' })).indexOf('Peregrine Drake')).toBe(0);
  });

  it('promotes nothing for a caller that passes no bracket', () => {
    expect(names([drakeLine], ctx()).indexOf('Peregrine Drake')).toBe(GAPS.length);
  });

  it('leaves the completion where it was at target bracket 2 and 3, where combos earn nothing', () => {
    for (const targetBracket of [1, 2, 3]) {
      const order = names([drakeLine], ctx({ targetBracket }));
      expect(order.indexOf('Peregrine Drake')).toBe(GAPS.length);
    }
  });

  it('does not promote a completion the deck has no protected cut for', () => {
    const order = names([drakeLine], ctx({ targetBracket: 4, hasProtectedCut: () => false }));
    expect(order.indexOf('Peregrine Drake')).toBe(GAPS.length);
  });

  it('never promotes a loop that does not end the game', () => {
    const order = names([hullbreakerLine], ctx({ targetBracket: 4 }));
    expect(order).not.toContain('Hullbreaker Horror');
  });

  it('keeps an owned completion ahead of an unowned one, whatever the line deck count', () => {
    const order = names([drakeLine, hackerLine], ctx({ targetBracket: 4 }), [
      'Moon-Circuit Hacker',
    ]);
    expect(order.slice(0, 2)).toEqual(['Moon-Circuit Hacker', 'Peregrine Drake']);
  });

  it('orders two promoted completions by the line deck count', () => {
    const order = names([hackerLine, drakeLine], ctx({ targetBracket: 4 }));
    expect(order.slice(0, 2)).toEqual(['Peregrine Drake', 'Moon-Circuit Hacker']);
  });

  it('promotes one line per partner set, so a third line off the same pieces stays put', () => {
    const order = names([drakeLine, hackerLine, skullsnatcherLine], ctx({ targetBracket: 4 }));
    expect(order.slice(0, 2)).toEqual(['Peregrine Drake', 'Moon-Circuit Hacker']);
    expect(order.indexOf('Skullsnatcher')).toBeGreaterThan(GAPS.length);
  });

  it('changes no other row: the rest keep their order', () => {
    const base = names([], ctx({ targetBracket: 4 }));
    const withCombo = names([drakeLine], ctx({ targetBracket: 4 })).filter(
      (n) => n !== 'Peregrine Drake'
    );
    expect(withCombo).toEqual(base);
  });
});

describe('the cut a promoted completion needs comes from the protected path (E540)', () => {
  const creature = (name: string, typeLine: string): ScryfallCard =>
    ({ name, type_line: typeLine, cmc: 2, color_identity: ['U'], oracle_text: '' }) as ScryfallCard;
  const tfs = creature('Thousand-Faced Shadow', 'Creature — Human Ninja');
  const silver = creature('Moon-Circuit Hacker', 'Creature — Human Ninja');
  const drake = creature('Peregrine Drake', 'Creature — Elemental');
  const change = buildCoachChanges(
    { gaps: [], synergy: [], substitutes: [], oneAwayCombos: [drakeLine] },
    () => 'unowned',
    new Set()
  )[0];
  const inDeck: ComboMatch[] = [
    { ...hackerLine, presentOracleIds: [TFS, DRAKE, HACKER], missingOracleIds: [] },
  ];
  const make = (deck: ScryfallCard[], full: boolean) =>
    replaceCuts({
      deckCards: deck.map((card, i) => ({ slotId: `s${i}`, card })),
      analysis: {},
      // The deck already assembles the line the pieces belong to: they are never a cut.
      inDeckCombos: inDeck,
      oneAwayCombos: [drakeLine],
      full,
      resolve: () => drake,
    });

  it('a full deck of nothing but combo pieces has no protected cut, though the row is exempt from hasCut', () => {
    const r = make([tfs, silver], true);
    expect(r.hasCut(change)).toBe(true);
    expect(r.hasProtectedCut(change)).toBe(false);
  });

  it('a full deck with a card the prompt can give up has one', () => {
    const filler = creature('Memnite', 'Artifact Creature — Construct');
    const r = make([tfs, silver, filler], true);
    expect(r.hasProtectedCut(change)).toBe(true);
  });

  it('a deck with room needs no cut', () => {
    expect(make([tfs, silver], false).hasProtectedCut(change)).toBe(true);
  });
});
