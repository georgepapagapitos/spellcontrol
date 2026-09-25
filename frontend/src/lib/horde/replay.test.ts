import { describe, it, expect, beforeAll } from 'vitest';
import { applyAction } from '@/lib/playtest';
import type { HordeSettings, HordeStep, HordeTable } from '@/lib/game-state';
import type { SoloHordePhase } from '@/playtest/lib/horde-solo';
import { replayHorde } from './replay';
import { buildHordeLibrary, type HordeDeckDef } from './library';
import { createHordeBoard } from './board';
import { hordeTurnActions, planHordeTurn, resolveActions } from './turn';
import { resolveHordeSettings } from './settings';
import { loadHordeDeck } from './load-deck';

describe('replayHorde', () => {
  let def: HordeDeckDef;
  const seed = 987654321;

  beforeAll(async () => {
    def = await loadHordeDeck('zombies');
  });

  function baseSettings(overrides?: Partial<HordeSettings>): HordeSettings {
    return resolveHordeSettings('standard', 2, overrides);
  }

  function table(
    steps: HordeStep[],
    patch: Partial<HordeTable> = {},
    settings = baseSettings()
  ): HordeTable {
    return {
      hordeId: 'zombies',
      level: 'standard',
      settings,
      seed,
      deckRev: def.rev,
      phase: 'reveal',
      survivorTurn: 1,
      hordeTurn: steps.filter((s) => s.k === 'reveal').length,
      done: [],
      steps: steps.map((s, i) => ({ ...s, seat: i % 2, ts: i })),
      ...patch,
    };
  }

  it('is deterministic: two replays of the same table deep-equal', () => {
    const t = table([{ k: 'reveal' }, { k: 'confirm' }, { k: 'damage', n: 5 }]);
    expect(replayHorde(def, t, 80)).toEqual(replayHorde(def, t, 80));
  });

  it('is deterministic regardless of how the input objects are constructed', () => {
    const t1 = table([{ k: 'reveal' }, { k: 'confirm' }]);
    const t2: HordeTable = {
      steps: t1.steps,
      done: t1.done,
      hordeTurn: t1.hordeTurn,
      survivorTurn: t1.survivorTurn,
      phase: t1.phase,
      deckRev: t1.deckRev,
      seed: t1.seed,
      settings: { ...t1.settings },
      level: t1.level,
      hordeId: t1.hordeId,
    };
    expect(replayHorde(def, t1, 80)).toEqual(replayHorde(def, t2, 80));
  });

  it('starts with the library in buildHordeLibrary’s dealt order, never reshuffled (E432)', () => {
    const t = table([]);
    const built = buildHordeLibrary(def, t.settings, t.seed);
    const replay = replayHorde(def, t, 80);
    expect(replay.view.board.zones.library.map((c) => c.id)).toEqual(
      built.library.map((c) => c.id)
    );
    expect(replay.view.librarySizeAtStart).toBe(built.library.length);
  });

  it('reveal then confirm puts permanents on the battlefield and spells in the graveyard exactly as the engine plans', () => {
    // No boss ticks here: this test is only about the reveal/confirm placement,
    // not the boss-arrival path (covered separately below).
    const s = baseSettings({ reveal: { kind: 'fixed', count: 999 }, bossTicks: [], setupTurns: 0 });
    const t = table([{ k: 'reveal' }, { k: 'confirm' }], {}, s);

    const built = buildHordeLibrary(def, s, t.seed);
    const board0 = createHordeBoard(built.library, built.bosses, built.seed);
    const { revealed } = planHordeTurn(board0.zones.library, s, 1, 0);
    const { toBattlefield, toResolve } = hordeTurnActions(revealed, board0.battlefield);
    let expectedBoard = board0;
    for (const action of toBattlefield) expectedBoard = applyAction(expectedBoard, action);
    for (const action of resolveActions(toResolve))
      expectedBoard = applyAction(expectedBoard, action);
    // A full reveal of the whole library exercises the graveyard path for real.
    expect(toResolve.length).toBeGreaterThan(0);

    const replay = replayHorde(def, t, 80);
    expect(replay.view.board.battlefield.map((b) => b.card.id)).toEqual(
      expectedBoard.battlefield.map((b) => b.card.id)
    );
    expect(replay.view.board.zones.graveyard.map((c) => c.id)).toEqual(
      expectedBoard.zones.graveyard.map((c) => c.id)
    );
    expect(replay.view.pendingReveal).toBeNull();
    expect(replay.view.pendingAttack).not.toBeNull();
  });

  it('deals a boss on confirm when the reveal itself crosses a boss tick (E436)', () => {
    const s = baseSettings({
      librarySize: 20,
      reveal: { kind: 'fixed', count: 12 },
      bossTicks: [0.5, 1],
      setupTurns: 0,
    });
    const t = table([{ k: 'reveal' }, { k: 'confirm' }], {}, s);
    const replay = replayHorde(def, t, 80);

    expect(replay.view.bossTicksCrossed).toEqual([0]);
    expect(replay.lastArrivals).toEqual({
      stepIndex: 1,
      seat: 1,
      bosses: [{ name: def.bosses[0].name, tick: 0.5 }],
    });
    expect(replay.view.board.battlefield.some((b) => b.card.name === def.bosses[0].name)).toBe(
      true
    );
  });

  it('a damage step mills n cards, deals a due boss, and records lastDamage', () => {
    const s = baseSettings({ librarySize: 20, bossTicks: [0.5, 1], setupTurns: 0 });
    const t = table([{ k: 'damage', n: 10 }], {}, s);
    const replay = replayHorde(def, t, 80);

    expect(replay.lastDamage).not.toBeNull();
    expect(replay.lastDamage!.stepIndex).toBe(0);
    expect(replay.lastDamage!.result.amount).toBe(10);
    expect(replay.lastDamage!.result.before).toBe(20);
    expect(replay.lastDamage!.result.after).toBe(10);
    expect(replay.lastDamage!.result.milled).toHaveLength(10);
    expect(replay.lastDamage!.result.bossesEntered).toEqual([
      { name: def.bosses[0].name, tick: 0.5 },
    ]);
    expect(replay.lastArrivals).toEqual({
      stepIndex: 0,
      seat: 0,
      bosses: [{ name: def.bosses[0].name, tick: 0.5 }],
    });
    expect(replay.view.cardsMilledByDamage).toBe(10);
  });

  it('moves a horde permanent to graveyard, exile, or library, and a repeated move of the same card is a no-op', () => {
    const s = baseSettings({ reveal: { kind: 'fixed', count: 999 }, setupTurns: 0 });
    const base = replayHorde(def, table([{ k: 'reveal' }, { k: 'confirm' }], {}, s), 80);
    expect(base.view.board.battlefield.length).toBeGreaterThan(0);

    const permanent = base.view.board.battlefield.find((b) => !b.card.isToken);
    const token = base.view.board.battlefield.find((b) => b.card.isToken);
    expect(permanent).toBeDefined();
    expect(token).toBeDefined();
    const permId = permanent!.card.id;
    const tokenId = token!.card.id;

    const toGraveyard = replayHorde(
      def,
      table(
        [{ k: 'reveal' }, { k: 'confirm' }, { k: 'move', cardId: permId, to: 'graveyard' }],
        {},
        s
      ),
      80
    );
    expect(toGraveyard.view.board.zones.graveyard.some((c) => c.id === permId)).toBe(true);
    expect(toGraveyard.view.board.battlefield.some((b) => b.card.id === permId)).toBe(false);

    const toExile = replayHorde(
      def,
      table([{ k: 'reveal' }, { k: 'confirm' }, { k: 'move', cardId: permId, to: 'exile' }], {}, s),
      80
    );
    expect(toExile.view.board.zones.exile.some((c) => c.id === permId)).toBe(true);

    const toLibrary = replayHorde(
      def,
      table(
        [{ k: 'reveal' }, { k: 'confirm' }, { k: 'move', cardId: permId, to: 'library' }],
        {},
        s
      ),
      80
    );
    expect(toLibrary.view.board.zones.library[0]?.id).toBe(permId);

    // A token that already left the battlefield ceased to exist (MTG rule
    // 704.5d) — a second move of the same id finds nothing to move.
    const single = replayHorde(
      def,
      table(
        [{ k: 'reveal' }, { k: 'confirm' }, { k: 'move', cardId: tokenId, to: 'graveyard' }],
        {},
        s
      ),
      80
    );
    const doubled = replayHorde(
      def,
      table(
        [
          { k: 'reveal' },
          { k: 'confirm' },
          { k: 'move', cardId: tokenId, to: 'graveyard' },
          { k: 'move', cardId: tokenId, to: 'graveyard' },
        ],
        {},
        s
      ),
      80
    );
    expect(doubled.view.board).toEqual(single.view.board);
  });

  it('take clears the attackers and accumulates damage taken across takes', () => {
    const s = baseSettings({ reveal: { kind: 'fixed', count: 5 }, setupTurns: 0 });
    const t = table(
      [
        { k: 'reveal' },
        { k: 'confirm' },
        { k: 'take', dealt: 7 },
        { k: 'reveal' },
        { k: 'confirm' },
        { k: 'take', dealt: 3 },
      ],
      {},
      s
    );
    const replay = replayHorde(def, t, 80);
    expect(replay.view.attackingIds).toEqual([]);
    expect(replay.view.pendingAttack).toBeNull();
    expect(replay.view.damageTaken).toBe(10);
  });

  it('reads won once the library is empty and the horde controls no creatures', () => {
    const s = baseSettings({ librarySize: 0 });
    const t = table([], {}, s);
    const replay = replayHorde(def, t, 80);
    expect(replay.outcome).toBe('won');
    expect(replay.view.outcome).toBe('won');
    expect(replay.view.phase).toBe('ended');
  });

  it('reads lost at zero shared life, checked ahead of an empty library', () => {
    const s = baseSettings({ librarySize: 0 });
    const t = table([], {}, s);
    const replay = replayHorde(def, t, 0);
    expect(replay.outcome).toBe('lost');
    expect(replay.view.phase).toBe('ended');
  });

  it('maps table.phase to the solo view phase, unless the game already ended', () => {
    const cases: [HordeTable['phase'], SoloHordePhase][] = [
      ['survivors', 'waiting'],
      ['reveal', 'reveal'],
      ['combat', 'combat'],
    ];
    for (const [tablePhase, viewPhase] of cases) {
      const t = table([], { phase: tablePhase });
      expect(replayHorde(def, t, 80).view.phase).toBe(viewPhase);
    }
  });

  it('an empty reveal (library exhausted) still opens a pending reveal, with nothing to confirm', () => {
    const s = baseSettings({ librarySize: 0, setupTurns: 0 });
    const t = table([{ k: 'reveal' }], {}, s);
    const replay = replayHorde(def, t, 80);
    expect(replay.view.pendingReveal).toEqual({
      revealed: [],
      toBattlefield: [],
      toResolve: [],
      waveEndId: null,
    });
  });

  it('waves-pattern reveal cycles the pattern by hordeTurn index, not sequentially', () => {
    const s = baseSettings({ reveal: { kind: 'waves-pattern', pattern: [1, 3] }, setupTurns: 0 });

    const afterTurn1 = replayHorde(
      def,
      table([{ k: 'reveal' }, { k: 'confirm' }, { k: 'take', dealt: 0 }], {}, s),
      80
    );
    const libAfterTurn1 = afterTurn1.view.board.zones.library;

    const turn2 = replayHorde(
      def,
      table([{ k: 'reveal' }, { k: 'confirm' }, { k: 'take', dealt: 0 }, { k: 'reveal' }], {}, s),
      80
    );
    const expectedTurn2 = planHordeTurn(libAfterTurn1, s, 2, 0);
    expect(turn2.view.pendingReveal!.revealed.map((c) => c.id)).toEqual(
      expectedTurn2.revealed.map((c) => c.id)
    );

    const afterTurn2 = replayHorde(
      def,
      table(
        [
          { k: 'reveal' },
          { k: 'confirm' },
          { k: 'take', dealt: 0 },
          { k: 'reveal' },
          { k: 'confirm' },
          { k: 'take', dealt: 0 },
        ],
        {},
        s
      ),
      80
    );
    const libAfterTurn2 = afterTurn2.view.board.zones.library;

    const turn3 = replayHorde(
      def,
      table(
        [
          { k: 'reveal' },
          { k: 'confirm' },
          { k: 'take', dealt: 0 },
          { k: 'reveal' },
          { k: 'confirm' },
          { k: 'take', dealt: 0 },
          { k: 'reveal' },
        ],
        {},
        s
      ),
      80
    );
    // Turn 3 cycles the two-entry pattern back to index 0, the same slot
    // turn 1 used — not a straight sequential advance.
    const expectedTurn3 = planHordeTurn(libAfterTurn2, s, 3, 0);
    expect(turn3.view.pendingReveal!.revealed.map((c) => c.id)).toEqual(
      expectedTurn3.revealed.map((c) => c.id)
    );
  });

  it('carries bossTicksCrossed forward across steps, so each tick deals only once', () => {
    // Two damage steps in a row: the second must not re-deal the tick the
    // first already crossed, and lastArrivals reflects only the newest one.
    const s = baseSettings({ librarySize: 20, bossTicks: [0.25, 0.5, 1], setupTurns: 0 });
    const t = table(
      [
        { k: 'damage', n: 5 },
        { k: 'damage', n: 5 },
      ],
      {},
      s
    );
    const replay = replayHorde(def, t, 80);
    expect(replay.view.bossTicksCrossed).toEqual([0, 1]);
    expect(replay.lastArrivals!.bosses).toEqual([{ name: def.bosses[1].name, tick: 0.5 }]);
  });
});
