import { describe, it, expect } from 'vitest';
import { createPlaytestState } from '@/lib/playtest';
import type { BattlefieldCard, PlaytestCard } from '@/lib/playtest';
import {
  planHordeTurn,
  hordeTurnActions,
  resolveActions,
  attackSummary,
  millForDamage,
  bossesCrossed,
  hordeOutcome,
} from './turn';
import { resolveHordeSettings, type HordeSettings } from './settings';

function tok(id: string, name = 'Zombie'): PlaytestCard {
  return { id, name, typeLine: 'Zombie Creature Token', isToken: true };
}
function spell(id: string, typeLine: string, name = id): PlaytestCard {
  return { id, name, typeLine };
}
function bf(card: PlaytestCard, extra: Partial<BattlefieldCard> = {}): BattlefieldCard {
  return { card, tapped: false, counters: {}, stickers: [], x: 0, y: 0, faceDown: false, ...extra };
}

const baseSettings: HordeSettings = resolveHordeSettings('standard', 2);

describe('planHordeTurn', () => {
  it('until-nontoken: reveals tokens through the first nontoken card, inclusive', () => {
    const library = [tok('t1'), tok('t2'), spell('s1', 'Sorcery'), spell('s2', 'Sorcery')];
    const settings = { ...baseSettings, reveal: { kind: 'until-nontoken' as const } };
    const { revealed, waves } = planHordeTurn(library, settings, 1);
    expect(revealed.map((c) => c.id)).toEqual(['t1', 't2', 's1']);
    expect(waves).toBe(1);
  });

  it('until-nontoken: consumes the whole library if no nontoken ever appears', () => {
    const library = [tok('t1'), tok('t2')];
    const settings = { ...baseSettings, reveal: { kind: 'until-nontoken' as const } };
    const { revealed, waves } = planHordeTurn(library, settings, 1);
    expect(revealed).toHaveLength(2);
    expect(waves).toBe(1);
  });

  it('stops cleanly at an empty library', () => {
    const settings = { ...baseSettings, reveal: { kind: 'until-nontoken' as const } };
    const { revealed, waves } = planHordeTurn([], settings, 1);
    expect(revealed).toEqual([]);
    expect(waves).toBe(0);
  });

  it('waves: runs `perTurn` waves back to back', () => {
    const library = [
      tok('t1'),
      spell('s1', 'Sorcery'),
      tok('t2'),
      spell('s2', 'Sorcery'),
      tok('t3'),
    ];
    const settings = { ...baseSettings, reveal: { kind: 'waves' as const, perTurn: 2 } };
    const { revealed, waves } = planHordeTurn(library, settings, 1);
    expect(revealed.map((c) => c.id)).toEqual(['t1', 's1', 't2', 's2']);
    expect(waves).toBe(2);
  });

  it('waves: stops cleanly when the library empties mid-plan', () => {
    const library = [tok('t1'), spell('s1', 'Sorcery')];
    const settings = { ...baseSettings, reveal: { kind: 'waves' as const, perTurn: 3 } };
    const { revealed, waves } = planHordeTurn(library, settings, 1);
    expect(revealed.map((c) => c.id)).toEqual(['t1', 's1']);
    expect(waves).toBe(1);
  });

  it('waves-pattern: cycles perTurn by hordeTurn, 1-based', () => {
    const library = Array.from({ length: 20 }, (_, i) => spell(`s${i}`, 'Sorcery'));
    const settings = {
      ...baseSettings,
      reveal: { kind: 'waves-pattern' as const, pattern: [1, 2, 3] },
    };
    expect(planHordeTurn(library, settings, 1).waves).toBe(1);
    expect(planHordeTurn(library, settings, 2).waves).toBe(2);
    expect(planHordeTurn(library, settings, 3).waves).toBe(3);
    expect(planHordeTurn(library, settings, 4).waves).toBe(1); // cycles back
  });

  it('waves-pattern: falls back to the default pattern when given an empty one', () => {
    const library = Array.from({ length: 20 }, (_, i) => spell(`s${i}`, 'Sorcery'));
    const settings = { ...baseSettings, reveal: { kind: 'waves-pattern' as const, pattern: [] } };
    // Default pattern [1,2,3,2] -> turn 2 asks for 2 waves.
    expect(planHordeTurn(library, settings, 2).waves).toBe(2);
  });

  it('fixed: reveals a flat count, plus one per horde artifact when opted in', () => {
    const library = Array.from({ length: 10 }, (_, i) => spell(`s${i}`, 'Sorcery'));
    const settings = {
      ...baseSettings,
      reveal: { kind: 'fixed' as const, count: 2, plusPerArtifact: true },
    };
    expect(planHordeTurn(library, settings, 1, 0).revealed).toHaveLength(2);
    expect(planHordeTurn(library, settings, 1, 3).revealed).toHaveLength(5);
  });

  it('fixed: ignores hordeArtifacts when plusPerArtifact is not set', () => {
    const library = Array.from({ length: 10 }, (_, i) => spell(`s${i}`, 'Sorcery'));
    const settings = { ...baseSettings, reveal: { kind: 'fixed' as const, count: 2 } };
    expect(planHordeTurn(library, settings, 1, 5).revealed).toHaveLength(2);
  });

  it('fixed: clamps to the library size and reports zero waves when nothing is revealed', () => {
    const library = [spell('s0', 'Sorcery')];
    const settings = { ...baseSettings, reveal: { kind: 'fixed' as const, count: 5 } };
    const { revealed, waves } = planHordeTurn(library, settings, 1);
    expect(revealed).toHaveLength(1);
    expect(waves).toBe(1);

    const zero = { ...baseSettings, reveal: { kind: 'fixed' as const, count: 0 } };
    expect(planHordeTurn(library, zero, 1).waves).toBe(0);
  });
});

describe('hordeTurnActions', () => {
  it('routes tokens and non-instant/sorcery cards to the battlefield, spells to resolve', () => {
    const revealed = [
      tok('t1'),
      spell('c1', 'Artifact'),
      spell('s1', 'Sorcery'),
      spell('i1', 'Instant'),
    ];
    const { toBattlefield, toResolve } = hordeTurnActions(revealed, []);
    expect(toBattlefield).toHaveLength(2);
    expect(toBattlefield.every((a) => a.type === 'MOVE_TO_BATTLEFIELD')).toBe(true);
    expect(toBattlefield.map((a) => (a as { cardId: string }).cardId)).toEqual(['t1', 'c1']);
    expect(toResolve.map((c) => c.id)).toEqual(['s1', 'i1']);
  });

  it('treats a card with no typeLine as a permanent by default', () => {
    const revealed = [{ id: 'blank', name: 'Blank' }];
    const { toBattlefield, toResolve } = hordeTurnActions(revealed, []);
    expect(toBattlefield).toHaveLength(1);
    expect(toResolve).toHaveLength(0);
  });

  it('places successive permanents without stacking them on the same spot', () => {
    const revealed = [tok('t1'), tok('t2'), tok('t3')];
    const { toBattlefield } = hordeTurnActions(revealed, []);
    const positions = toBattlefield.map((a) => {
      const move = a as { x: number; y: number };
      return `${move.x},${move.y}`;
    });
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('honors a supplied battlefield rect instead of the fallback box (for the real table)', () => {
    const revealed = [tok('t1')];
    const narrow = hordeTurnActions(revealed, [], {
      width: 200,
      height: 200,
      cardW: 90,
      cardH: 126,
    });
    const wide = hordeTurnActions(revealed, [], {
      width: 2000,
      height: 2000,
      cardW: 90,
      cardH: 126,
    });
    const narrowX = (narrow.toBattlefield[0] as { x: number }).x;
    const wideX = (wide.toBattlefield[0] as { x: number }).x;
    // Same single card, same row — only the box changed, so its normalized
    // position (a fraction of the box width) must differ between the two.
    expect(narrowX).not.toBe(wideX);
  });
});

describe('resolveActions', () => {
  it('sends every resolved card to the graveyard', () => {
    const actions = resolveActions([spell('s1', 'Sorcery'), spell('i1', 'Instant')]);
    expect(actions).toEqual([
      { type: 'MOVE_TO_ZONE', cardId: 's1', to: 'graveyard' },
      { type: 'MOVE_TO_ZONE', cardId: 'i1', to: 'graveyard' },
    ]);
  });

  it('is a no-op for an empty list', () => {
    expect(resolveActions([])).toEqual([]);
  });
});

describe('attackSummary', () => {
  it('sums power and groups identical attackers', () => {
    const bear = (id: string): PlaytestCard => ({
      id,
      name: 'Grizzly Bears',
      typeLine: 'Creature — Bear',
      power: '2',
      toughness: '2',
    });
    const board = [bf(bear('b1')), bf(bear('b2'))];
    const summary = attackSummary(board);
    expect(summary.attackers).toBe(2);
    expect(summary.power).toBe(4);
    expect(summary.groups).toEqual([
      { name: 'Grizzly Bears', power: '2', toughness: '2', count: 2 },
    ]);
  });

  it('excludes non-creature permanents', () => {
    const board = [bf(spell('a1', 'Artifact', 'Sol Ring'))];
    const summary = attackSummary(board);
    expect(summary.attackers).toBe(0);
    expect(summary.power).toBe(0);
    expect(summary.groups).toEqual([]);
  });

  it('treats "*" or otherwise unparsable power as 0 toward the total', () => {
    const card: PlaytestCard = {
      id: 'g1',
      name: 'Tarmogoyf',
      typeLine: 'Creature — Lhurgoyf',
      power: '*',
      toughness: '*',
    };
    const board = [bf(card)];
    const summary = attackSummary(board);
    expect(summary.power).toBe(0);
    expect(summary.groups[0]).toEqual({ name: 'Tarmogoyf', power: '*', toughness: '*', count: 1 });
  });

  it('folds +1/+1 counters into the displayed power for both the total and the group key', () => {
    const card: PlaytestCard = {
      id: 'c1',
      name: 'Bear',
      typeLine: 'Creature — Bear',
      power: '2',
      toughness: '2',
    };
    const board = [bf(card, { counters: { '+1/+1': 2 } })];
    const summary = attackSummary(board);
    expect(summary.power).toBe(4);
    expect(summary.groups[0]).toEqual({ name: 'Bear', power: '4', toughness: '4', count: 1 });
  });

  it('keeps differently-modified copies of the same card in separate groups', () => {
    const printed: PlaytestCard = {
      id: 'x1',
      name: 'Bear',
      typeLine: 'Creature — Bear',
      power: '2',
      toughness: '2',
    };
    const pumped: PlaytestCard = {
      id: 'x2',
      name: 'Bear',
      typeLine: 'Creature — Bear',
      power: '2',
      toughness: '2',
    };
    const board = [bf(printed), bf(pumped, { counters: { '+1/+1': 1 } })];
    const summary = attackSummary(board);
    expect(summary.groups).toHaveLength(2);
  });
});

describe('millForDamage', () => {
  it('mills the library for the (floored, clamped) damage amount', () => {
    expect(millForDamage(5)).toEqual({ type: 'MOVE_TOP_N', n: 5, to: 'graveyard' });
    expect(millForDamage(2.7)).toEqual({ type: 'MOVE_TOP_N', n: 2, to: 'graveyard' });
    expect(millForDamage(-3)).toEqual({ type: 'MOVE_TOP_N', n: 0, to: 'graveyard' });
    expect(millForDamage(0)).toEqual({ type: 'MOVE_TOP_N', n: 0, to: 'graveyard' });
  });
});

describe('bossesCrossed', () => {
  it('reports nothing when the library has not moved', () => {
    expect(bossesCrossed(100, 100, 100, [0.5, 1])).toEqual([]);
  });

  it('fires a tick exactly once it is crossed', () => {
    expect(bossesCrossed(100, 60, 40, [0.5, 1])).toEqual([0]);
  });

  it('does not refire a tick already passed in an earlier call', () => {
    // Simulates a second call after the tick already fired: `remainingBefore`
    // now starts past the tick, so only the *next* one (1, library empty) can fire.
    expect(bossesCrossed(100, 10, 0, [0.5, 1])).toEqual([1]);
  });

  it('fires every tick a single big jump crosses', () => {
    expect(bossesCrossed(100, 100, 0, [0.25, 0.5, 0.75, 1])).toEqual([0, 1, 2, 3]);
  });

  it('is a no-op for a zero-size library', () => {
    expect(bossesCrossed(0, 0, 0, [0.5, 1])).toEqual([]);
  });
});

describe('hordeOutcome', () => {
  function makeHorde(library: PlaytestCard[], battlefield: BattlefieldCard[]) {
    const state = createPlaytestState({ library: [], seed: 1 });
    return { ...state, zones: { ...state.zones, library }, battlefield };
  }

  it('is lost at 0 or negative survivor life, regardless of board state', () => {
    const horde = makeHorde([], []);
    expect(hordeOutcome(horde, 0)).toBe('lost');
    expect(hordeOutcome(horde, -5)).toBe('lost');
  });

  it('is won once the library is empty and no creatures remain', () => {
    const horde = makeHorde([], [bf(spell('a1', 'Artifact'))]);
    expect(hordeOutcome(horde, 40)).toBe('won');
  });

  it('is not won while a creature remains, even with an empty library', () => {
    const horde = makeHorde([], [bf(spell('c1', 'Creature — Zombie'))]);
    expect(hordeOutcome(horde, 40)).toBeNull();
  });

  it('is not won while the library still has cards', () => {
    const horde = makeHorde([spell('s1', 'Sorcery')], []);
    expect(hordeOutcome(horde, 40)).toBeNull();
  });

  it('checks life before the win condition', () => {
    const horde = makeHorde([], []);
    expect(hordeOutcome(horde, 0)).toBe('lost');
  });
});
