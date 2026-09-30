import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { rankReplacementCuts } from '@/lib/coach/intelligent-cuts';
import {
  card,
  COMMANDER,
  loadTaggerSnapshot,
  NONBASIC_LANDS,
  SPELLS,
} from '../__fixtures__/invariant-deck';
import {
  applyCoachMoves,
  auditMoves,
  orderedCoachMoves,
  type ApplyEnv,
  type CoachMove,
  type DeckSettings,
  type EvalDeckState,
} from './applyCoachMoves';
import type { CoachView } from './coachView';

beforeAll(loadTaggerSnapshot);
afterAll(() => vi.unstubAllGlobals());

/** The clean Tatyova deck from the invariant kit, padded to 99 with basics. */
function tatyova(): EvalDeckState {
  const cards = [...SPELLS, ...NONBASIC_LANDS].map((n) => card(n));
  while (cards.length < 99) cards.push(card(cards.length % 2 ? 'Forest' : 'Island'));
  return { commander: card(COMMANDER), partner: null, cards };
}

function settings(over: Partial<DeckSettings> = {}): DeckSettings {
  return {
    colorIdentity: ['G', 'U'],
    deckBudget: null,
    maxCardPrice: null,
    targetBracket: null,
    gameChangerLimit: 'unlimited',
    maxRarity: null,
    collectionMode: false,
    collectionStrategy: 'full',
    collectionOwnedPercent: 75,
    ignoreOwnedBudget: false,
    ignoreOwnedRarity: false,
    ownedNames: new Set(),
    ...over,
  };
}

/** Cuts offered in a fixed order: the kit's weakest-looking spells first. */
function env(over: Partial<ApplyEnv> = {}): ApplyEnv {
  const order = ['Negate', 'Aetherize', 'Evacuation', 'Pongify'];
  return {
    resolve: (name) => {
      try {
        return card(name);
      } catch {
        return undefined;
      }
    },
    rankCuts: (_add, cards) =>
      order
        .filter((n) => cards.some((c) => c.name === n))
        .map((name) => ({ name, reason: 'Weakest copy' })),
    bracketOf: () => 2,
    isGameChanger: (name) => ['Cyclonic Rift', 'Rhystic Study'].includes(name),
    ...over,
  };
}

function add(name: string, rank = 1, surface = 'fill-gaps'): CoachMove {
  return { rank, source: 'feed', surface, type: 'add', name };
}

const names = (cards: readonly ScryfallCard[]) => cards.map((c) => c.name);

describe('orderedCoachMoves', () => {
  it('puts the hero card rows first, skips advice rows, and keeps one row per idea', () => {
    const view = {
      nbm: [
        { id: 'land-count', tier: 2, title: 'Add 2 lands', detail: 'Basics work.' },
        {
          id: 'roles-cardDraw',
          tier: 2,
          title: 'Add card draw',
          detail: 'x',
          cardName: 'Harmonize',
        },
      ],
      feed: [
        {
          tier: 3,
          change: { id: 'fill-gaps:Harmonize', type: 'add', lane: 'fill-gaps', name: 'Harmonize' },
        },
        {
          tier: 3,
          change: {
            id: 'b',
            type: 'swap',
            lane: 'budget',
            name: 'Fact or Fiction',
            inName: 'Mulldrifter',
          },
        },
      ],
    } as unknown as Pick<CoachView, 'nbm' | 'feed'>;
    const moves = orderedCoachMoves(view);
    expect(moves.map((m) => [m.rank, m.source, m.surface, m.type, m.name, m.outName])).toEqual([
      [1, 'nbm', 'nbm:roles', 'add', 'Harmonize', undefined],
      [2, 'feed', 'budget', 'swap', 'Fact or Fiction', 'Mulldrifter'],
    ]);
  });
});

describe('applyCoachMoves', () => {
  it('fills a full deck through the replace-when-full prompt, first suggested cut', () => {
    const r = applyCoachMoves(tatyova(), [add('Rhystic Study')], settings(), env(), 5);
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0]).toMatchObject({
      added: 'Rhystic Study',
      cut: 'Negate',
      cutSource: 'replace-when-full',
    });
    expect(r.deck.cards).toHaveLength(99);
    expect(names(r.deck.cards)).not.toContain('Negate');
  });

  it('with the real prompt, cuts a card related to the one coming in', () => {
    const real = env({
      rankCuts: (addCard, cards) =>
        rankReplacementCuts({
          addCard,
          deckCards: cards.map((c, i) => ({ slotId: String(i), card: c })),
        }).map((c) => ({ name: c.card.name, reason: c.reason })),
    });
    const r = applyCoachMoves(tatyova(), [add('Counterspell', 1)], settings(), real, 1);
    // Counterspell is already in the deck: never duplicated.
    expect(r.skipped[0].violations).toEqual(['in-deck']);
    const r2 = applyCoachMoves(tatyova(), [add('Fact or Fiction')], settings(), real, 1);
    expect(r2.applied[0].cut).toBeDefined();
    expect(r2.deck.cards).toHaveLength(99);
  });

  it('makes a swap on its own outgoing card, and skips a swap whose card is gone', () => {
    const swap: CoachMove = {
      rank: 1,
      source: 'feed',
      surface: 'budget',
      type: 'swap',
      name: 'Fact or Fiction',
      outName: 'Harmonize',
    };
    const r = applyCoachMoves(
      tatyova(),
      [swap, { ...swap, rank: 2, name: 'Mulldrifter' }],
      settings(),
      env(),
      5
    );
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0]).toMatchObject({
      added: 'Fact or Fiction',
      cut: 'Harmonize',
      cutSource: 'swap',
    });
    expect(r.skipped[0].violations).toEqual(['in-deck']);
  });

  it("skips what breaks the deck's own settings and takes the next move", () => {
    const deck = tatyova();
    const moves = [add('Lightning Bolt', 1), add('Cyclonic Rift', 2), add('Fact or Fiction', 3)];
    const r = applyCoachMoves(deck, moves, settings({ maxRarity: 'uncommon' }), env(), 1);
    expect(r.skipped.map((s) => [s.move.name, s.violations])).toEqual([
      ['Lightning Bolt', ['off-identity']],
      ['Cyclonic Rift', ['over-rarity']],
    ]);
    expect(r.applied.map((a) => a.added)).toEqual(['Fact or Fiction']);
  });

  it('holds a budget, a Game Changer limit and a target bracket', () => {
    const deck = tatyova();
    const total = deck.cards.reduce((s, c) => s + (Number(c.prices?.usd) || 0), 0);
    const budget = applyCoachMoves(
      deck,
      [add('Rhystic Study')],
      settings({ deckBudget: total + 10 }),
      env(),
      1
    );
    expect(budget.skipped[0].violations).toContain('over-budget');

    const gc = applyCoachMoves(
      deck,
      [add('Cyclonic Rift')],
      settings({ gameChangerLimit: 'none' }),
      env(),
      1
    );
    expect(gc.skipped[0].violations).toContain('game-changer-limit');

    const bracket = env({
      bracketOf: (cards) => (cards.some((c) => c.name === 'Cyclonic Rift') ? 4 : 2),
    });
    const b = applyCoachMoves(
      deck,
      [add('Cyclonic Rift')],
      settings({ targetBracket: 2 }),
      bracket,
      1
    );
    expect(b.skipped[0].violations).toContain('over-bracket');
  });

  it('keeps an only-my-cards deck to owned cards, and a partial deck to its owned share', () => {
    const deck = tatyova();
    const full = settings({ collectionMode: true, collectionStrategy: 'full' });
    expect(
      applyCoachMoves(deck, [add('Rhystic Study')], full, env(), 1).skipped[0].violations
    ).toEqual(['unowned']);
    const owned = settings({
      collectionMode: true,
      collectionStrategy: 'full',
      ownedNames: new Set(['Rhystic Study']),
    });
    expect(applyCoachMoves(deck, [add('Rhystic Study')], owned, env(), 1).applied).toHaveLength(1);

    // Every nonland card owned but the one coming in; a 100% target can't take it.
    const allOwned = new Set(deck.cards.map((c) => c.name));
    const partial = settings({
      collectionMode: true,
      collectionStrategy: 'partial',
      collectionOwnedPercent: 100,
      ownedNames: allOwned,
    });
    expect(
      applyCoachMoves(deck, [add('Rhystic Study')], partial, env(), 1).skipped[0].violations
    ).toEqual(['owned-share']);
  });

  it('skips an add when the prompt offers no cut, and stops at n', () => {
    const none = env({ rankCuts: () => [] });
    expect(
      applyCoachMoves(tatyova(), [add('Harmonize')], settings(), none, 1).skipped[0]
    ).toBeDefined();
    const r = applyCoachMoves(
      tatyova(),
      [add('Rhystic Study', 1), add('Fact or Fiction', 2), add('Burgeoning', 3)],
      settings(),
      env(),
      2
    );
    expect(r.applied.map((a) => a.added)).toEqual(['Rhystic Study', 'Fact or Fiction']);
  });

  it('applies a cut row as a plain removal', () => {
    const cut: CoachMove = {
      rank: 1,
      source: 'feed',
      surface: 'upgrade',
      type: 'cut',
      name: 'Negate',
    };
    const r = applyCoachMoves(tatyova(), [cut], settings(), env(), 1);
    expect(r.deck.cards).toHaveLength(98);
    expect(r.applied[0]).toMatchObject({ cut: 'Negate', cutSource: 'cut-row' });
  });
});

describe('auditMoves', () => {
  it('judges each move alone against the unedited deck', () => {
    const audit = auditMoves(
      tatyova(),
      [add('Rhystic Study', 1), add('Lightning Bolt', 2), add('Fact or Fiction', 3)],
      settings(),
      env(),
      2
    );
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ cut: 'Negate', violations: [] });
    expect(audit[1]).toMatchObject({ cut: 'Negate', violations: ['off-identity'] });
  });
});
