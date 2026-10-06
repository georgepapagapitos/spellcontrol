// @vitest-environment node
//
// The shadow scorer over Meren's real page, cards and combos (the objective
// fixture): every row kind maps to a judged move, an accepted move leaves the
// deck feasible, and a row it can't score is unscored, never guessed.
import { describe, expect, it } from 'vitest';
import { checkConstraints } from '@/deck-builder/services/deckBuilder/deckObjective';
import { applyMove } from '@/deck-builder/services/deckBuilder/deckObjective/judge';
import {
  BASELINE,
  FIX,
  MEREN,
  YURIKO,
  card,
} from '@/deck-builder/services/deckBuilder/deckObjective/__fixtures__/objectiveFixture';
import type { ScryfallCard } from '@/deck-builder/types';
import { buildCoachObjective, type CoachObjectiveResult } from './coach-objective';
import {
  objectiveOrder,
  scoreCoachMoves,
  scoreCoachMovesAsync,
  type RowScore,
} from './coach-move-score';
import type { Change } from './deck-change';

const rows = new Map(Object.entries(FIX.merenPage));

function objective(cards: readonly ScryfallCard[] = BASELINE.cards): CoachObjectiveResult {
  return buildCoachObjective({
    deck: {
      format: 'commander',
      commander: MEREN,
      partnerCommander: null,
      cards: cards.map((c, i) => ({ slotId: String(i), card: c, allocatedCopyId: null })),
      generationContext: {
        selectedThemes: [],
        targetBracket: 'all',
        landCount: 37,
        collectionMode: false,
        customization: { deckFormat: 99, currency: 'USD' },
      },
      bracketOverride: null,
    },
    rows,
    roleTargets: FIX.meren.roleTargets,
    combos: FIX.meren.combos,
    pacing: FIX.meren.pacing,
    liftPools: new Map(Object.entries(FIX.lift)),
    manaSim: { games: 300 },
  });
}

const row = (over: Partial<Change> & Pick<Change, 'type' | 'name'>): Change => ({
  id: `${over.type}:${over.name}`,
  lane: 'upgrade',
  ...over,
});
const scored = (s: RowScore) => {
  if (s.status !== 'scored') throw new Error(`unscored: ${s.reason}`);
  return s;
};

// Real Meren swaps: the E510 pair's out and in cards, plus staples and off-plan picks.
const SWAPS = [
  ['Skullclamp', 'Demonic Tutor'],
  ['Dread Return', 'Kokusho, the Evening Star'],
  ['Morbid Opportunist', 'Butcher of Malakir'],
  ['Skull Prophet', 'Twilight Diviner'],
  ['Exotic Orchard', 'Phyrexian Tower'],
  ['Sheoldred, Whispering One', 'Natural Order'],
  ['Life // Death', 'Viridian Emissary'],
  ['Strionic Resonator', 'Cultivate'],
  ['Strionic Resonator', 'Gilded Lotus'],
  ['Strionic Resonator', 'Grave Pact'],
  ['Strionic Resonator', 'Enlightened Tutor'],
  ['Strionic Resonator', 'Counterspell'],
  ['Strionic Resonator', 'Hermit Druid'],
];

describe('scoreCoachMoves on Meren', { timeout: 300_000 }, () => {
  const obj = objective();
  if (!obj.ok) throw new Error(obj.reason);
  const changes: Change[] = [
    ...SWAPS.map(([out, inn]) => row({ type: 'swap', name: inn, inName: out })),
    row({ type: 'add', name: 'Cultivate', lane: 'fill-gaps' }),
    row({ type: 'add', name: 'Craterhoof Behemoth', lane: 'combos' }),
    row({ type: 'cut', name: 'Skull Prophet' }),
    row({ type: 'cut', name: 'Vampiric Tutor' }),
  ];
  const resolve = (name: string) => {
    try {
      return card(name);
    } catch {
      return undefined;
    }
  };
  const scores = scoreCoachMoves(changes, obj, { resolve, fullTop: 4 });
  const byId = (id: string) => scores.find((s) => s.id === id)!;

  it('returns one score per row, in order', () => {
    expect(scores).toHaveLength(changes.length);
    expect(scores.map((s) => s.id)).toEqual(changes.map((c) => c.id));
  });

  it('judges a swap as that swap, an add to a full deck as a swap with a cut, a cut as the cut half of a swap', () => {
    const [swap] = scores.map(scored);
    expect(swap.kind).toBe('swap');
    expect(swap.move).toEqual({ out: ['Skullclamp'], in: ['Demonic Tutor'] });
    const add = scored(byId('add:Cultivate'));
    expect(add.kind).toBe('add-paired');
    expect(add.move.in).toEqual(['Cultivate']);
    expect(add.move.out).toHaveLength(1);
    const cut = scored(byId('cut:Skull Prophet'));
    expect(cut.kind).toBe('cut-paired');
    expect(cut.move.out).toEqual(['Skull Prophet']);
    expect(cut.move.in).toHaveLength(1);
  });

  it('accepts a swap that clears its margin, and refuses one that breaks the identity', () => {
    expect(scored(byId('swap:Grave Pact'))).toMatchObject({ accepted: true, refusal: null });
    expect(scored(byId('swap:Counterspell'))).toMatchObject({
      accepted: false,
      refusal: 'breaks identity',
    });
  });

  it('refuses a cut of a protected card, with the protection named', () => {
    // Meren's Mikaeus combos: Vampiric Tutor finds a piece.
    const s = byId('cut:Vampiric Tutor');
    expect(s.status === 'scored' && s.accepted).toBe(false);
    expect(s.status === 'scored' && s.refusal).toMatch(/tutor|combo|staple|premium/i);
  });

  it('reads the top rows in full and the rest fast', () => {
    const tiers = scores.filter((s) => s.status === 'scored').map((s) => scored(s).tier);
    expect(tiers.filter((t) => t === 'full')).toHaveLength(4);
    expect(tiers.filter((t) => t === 'fast').length).toBe(tiers.length - 4);
  });

  it('leaves the deck feasible after every accepted move', () => {
    let accepted = 0;
    for (const s of scores) {
      if (s.status !== 'scored' || !s.accepted) continue;
      accepted++;
      const out = s.move.out.map((n) => BASELINE.cards.findIndex((c) => c.name === n));
      const after = applyMove(BASELINE, { out, in: s.move.in.map(card) });
      expect(checkConstraints(after, obj.ctx), s.id).toEqual([]);
      expect(s.feasibleAfter, s.id).toBe(true);
    }
    expect(accepted).toBeGreaterThan(0);
  });

  it('orders accepted rows by gain, then refused, then unscored in their own order', () => {
    const mixed: RowScore[] = [
      { status: 'unscored', id: 'u1', reason: 'card-unresolved' },
      { ...scored(scores[0]), accepted: false, delta: 5 },
      { ...scored(scores[0]), accepted: true, delta: 1 },
      { status: 'unscored', id: 'u2', reason: 'error' },
      { ...scored(scores[0]), accepted: true, delta: 2 },
    ];
    expect(objectiveOrder(mixed)).toEqual([4, 2, 1, 0, 3]);
  });

  it('gives the same scores asynchronously', async () => {
    const again = await scoreCoachMovesAsync(changes.slice(0, 3), obj, { resolve, fullTop: 1 });
    expect(again).toEqual(scoreCoachMoves(changes.slice(0, 3), obj, { resolve, fullTop: 1 }));
  });
});

describe('what the scorer will not score', () => {
  it('marks a name-only row unresolved, never guessed', () => {
    const obj = objective();
    const s = scoreCoachMoves(
      [
        row({ type: 'add', name: 'Card That Is Not In The Cache' }),
        row({ type: 'swap', name: 'Card That Is Not In The Cache', inName: 'Skullclamp' }),
      ],
      obj,
      { resolve: () => undefined }
    );
    expect(s.map((r) => r.status === 'unscored' && r.reason)).toEqual([
      'card-unresolved',
      'card-unresolved',
    ]);
  });

  it('marks a swap out of a card the deck lacks, and a cut of one', () => {
    const obj = objective();
    const s = scoreCoachMoves(
      [
        row({ type: 'swap', name: 'Cultivate', inName: 'Black Lotus' }),
        row({ type: 'cut', name: 'Black Lotus' }),
      ],
      obj,
      { resolve: card }
    );
    expect(s.map((r) => r.status === 'unscored' && r.reason)).toEqual([
      'out-not-in-deck',
      'out-not-in-deck',
    ]);
  });

  it('pairs a cut only with a replacement the deck may hold', () => {
    const obj = objective();
    // Seven blue and white cards the fast read likes, and one colourless card it likes less.
    const offIdentity = [
      'Counterspell',
      'Enlightened Tutor',
      'Cryptic Command',
      'Cyclonic Rift',
      'Austere Command',
      'Fierce Guardianship',
      'Farewell',
    ].map(card);
    const s = scoreCoachMoves([row({ type: 'cut', name: 'Strionic Resonator' })], obj, {
      resolve: card,
      candidates: [...offIdentity, card('Gilded Lotus')],
    });
    expect(scored(s[0]).move.in).toEqual(['Gilded Lotus']);
  });

  it('scores a bare cut only as a repair', () => {
    const obj = objective();
    // No incoming card anywhere in the pool: nothing to pair, and a cut from a 99-card deck repairs nothing.
    const s = scoreCoachMoves([row({ type: 'cut', name: 'Skull Prophet' })], obj, {
      resolve: card,
    });
    expect(s[0]).toMatchObject({ status: 'unscored', reason: 'bare-cut-not-a-repair' });
  });

  it('never throws on a deck with no objective, and names why', () => {
    for (const reason of ['no-page', 'thin-page', 'no-commander'] as const) {
      const s = scoreCoachMoves(
        [row({ type: 'add', name: 'Cultivate' }), row({ type: 'cut', name: 'Skullclamp' })],
        { ok: false, reason }
      );
      expect(s).toEqual([
        { status: 'unscored', id: 'add:Cultivate', reason: `no-objective:${reason}` },
        { status: 'unscored', id: 'cut:Skullclamp', reason: `no-objective:${reason}` },
      ]);
    }
  });

  it('an empty feed scores to an empty list', () => {
    expect(scoreCoachMoves([], objective())).toEqual([]);
  });
});

describe('scoreCoachMoves on Yuriko, a deck with open slots', { timeout: 120_000 }, () => {
  const yuriko = card("Yuriko, the Tiger's Shadow");
  const deckCards = YURIKO.cards.slice(0, 7);
  const obj = buildCoachObjective({
    deck: {
      format: 'commander',
      commander: yuriko,
      partnerCommander: null,
      cards: deckCards.map((c, i) => ({ slotId: String(i), card: c, allocatedCopyId: null })),
      generationContext: {
        selectedThemes: [],
        targetBracket: 'all',
        landCount: 37,
        collectionMode: false,
        customization: { deckFormat: 99, currency: 'USD' },
      },
      bracketOverride: null,
    },
    rows: new Map(Object.entries(YURIKO.page)),
    roleTargets: { ramp: 10, cardDraw: 10, removal: 8, boardwipe: 3 },
    combos: YURIKO.combos,
    manaSim: { games: 300 },
  });

  it('judges an add into an open slot as an add, and an accepted one leaves the deck feasible', () => {
    if (!obj.ok) throw new Error(obj.reason);
    const adds = [...YURIKO.cards.slice(7), card('Cultivate'), card('Path to Exile')];
    const scores = scoreCoachMoves(
      adds.map((c) => row({ type: 'add', name: c.name })),
      obj,
      { resolve: card }
    );
    let accepted = 0;
    for (const s of scores.map(scored)) {
      expect(s.kind).toBe('add');
      if (!s.accepted) continue;
      accepted++;
      const after = {
        commanders: obj.deck.commanders,
        cards: [...obj.deck.cards, card(s.move.in[0])],
      };
      expect(checkConstraints(after, { ...obj.ctx, allowPartial: true }), s.id).toEqual([]);
    }
    expect(accepted).toBeGreaterThan(0);
    // The off-colour card is refused for its identity, not guessed at.
    expect(scored(scores[scores.length - 1])).toMatchObject({
      accepted: false,
      refusal: expect.stringMatching(/identity/),
    });
  });
});
