// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createPlaytestState, type PlaytestCard, type PlaytestState } from '@/lib/playtest';
import {
  applyResistance,
  createResistanceState,
  DEFAULT_RESISTANCE_OPTIONS,
  gameChangersForBracket,
  LEGACY_RESISTANCE_OPTIONS,
  levelForBracket,
  loadResistanceOptions,
  normalizeResistanceOptions,
  RESISTANCE_EFFECTS,
  RESISTANCE_PRESETS,
  RESISTANCE_PRESSURE,
  resistanceRespond,
  saveResistanceOptions,
  summarizeEffects,
  type ResistanceBoard,
  type ResistanceConfig,
  type ResistanceEffect,
  type ResistanceEvent,
  type ResistanceOptions,
  type ResistanceResponse,
  type ResistanceState,
} from './resistance';

const STANDARD = RESISTANCE_PRESETS.standard;

function card(id: string, overrides: Partial<PlaytestCard> = {}): PlaytestCard {
  return { id, name: `Card ${id}`, ...overrides };
}

const bigThreat = card('threat', {
  name: 'Ulamog, the Ceaseless Hunger',
  manaValue: 10,
  typeLine: 'Legendary Creature — Eldrazi',
});

function board(cards: PlaytestCard[]) {
  return { battlefield: cards.map((c) => ({ card: c })) };
}

const emptyBoard = board([]);

/** Run a fixed event sequence under `config`, collecting (response | null) per step. */
function run(
  seed: number,
  events: Array<{ event: ResistanceEvent; battlefield?: PlaytestCard[] }>,
  config: ResistanceConfig = STANDARD
): Array<ResistanceResponse | null> {
  let state = createResistanceState(seed);
  const out: Array<ResistanceResponse | null> = [];
  for (const { event, battlefield } of events) {
    const r = resistanceRespond(
      state,
      event,
      battlefield ? board(battlefield) : emptyBoard,
      config
    );
    state = r.state;
    out.push(r.response);
  }
  return out;
}

describe('createResistanceState', () => {
  it('starts with no wipes/responses spent', () => {
    const s = createResistanceState(123);
    expect(s).toEqual({ seed: 123, wipesUsed: 0, responsesThisTurn: 0 });
  });

  it('coerces the seed to a uint32 and randomizes when omitted', () => {
    expect(createResistanceState(-1).seed).toBe(0xffffffff);
    expect(createResistanceState().seed).toBeGreaterThanOrEqual(0);
  });
});

describe('resistanceRespond — determinism', () => {
  it('same seed, event sequence, and config produce the same responses', () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      i % 3 === 2
        ? { event: { kind: 'turnStart', turn: i } as ResistanceEvent }
        : { event: { kind: 'played', card: bigThreat } as ResistanceEvent }
    );
    expect(run(77, events)).toEqual(run(77, events));
    expect(run(77, events, RESISTANCE_PRESETS.ruthless)).toEqual(
      run(77, events, RESISTANCE_PRESETS.ruthless)
    );
  });

  it('every call that rolls advances the seed', () => {
    const s0 = createResistanceState(5);
    const r1 = resistanceRespond(s0, { kind: 'played', card: bigThreat }, emptyBoard, STANDARD);
    expect(r1.state.seed).not.toBe(s0.seed);
  });
});

describe('resistanceRespond — played events', () => {
  it('never responds to lands, across many seeds', () => {
    const land = card('l1', { name: 'Command Tower', typeLine: 'Land', manaValue: 0 });
    for (let seed = 1; seed <= 300; seed++) {
      const { response } = resistanceRespond(
        createResistanceState(seed),
        { kind: 'played', card: land },
        emptyBoard,
        STANDARD
      );
      expect(response).toBeNull();
    }
  });

  it('never responds to tokens, across many seeds', () => {
    const token = card('t1', { name: 'Beast', typeLine: 'Token Creature — Beast', isToken: true });
    for (let seed = 1; seed <= 300; seed++) {
      const { response } = resistanceRespond(
        createResistanceState(seed),
        { kind: 'played', card: token },
        emptyBoard,
        STANDARD
      );
      expect(response).toBeNull();
    }
  });

  it('responds at most once per turn; the budget resets on turnStart', () => {
    // Find a seed whose first play draws a response, then keep playing.
    for (let seed = 1; seed <= 2000; seed++) {
      let state = createResistanceState(seed);
      const first = resistanceRespond(
        state,
        { kind: 'played', card: bigThreat },
        emptyBoard,
        STANDARD
      );
      if (!first.response) continue;
      state = first.state;
      // Same turn: no further responses no matter how many plays follow.
      for (let i = 0; i < 10; i++) {
        const again = resistanceRespond(
          state,
          { kind: 'played', card: bigThreat },
          emptyBoard,
          STANDARD
        );
        expect(again.response).toBeNull();
        state = again.state;
      }
      // New turn: the opponent may respond again (budget reset observable).
      const reset = resistanceRespond(state, { kind: 'turnStart', turn: 2 }, emptyBoard, STANDARD);
      expect(reset.state.responsesThisTurn).toBe(0);
      return;
    }
    throw new Error('no seed in 1..2000 produced a response to a high threat');
  });

  it('counter/destroy/bounce target exactly the just-played card', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const { response } = resistanceRespond(
        createResistanceState(seed),
        { kind: 'played', card: bigThreat },
        emptyBoard,
        STANDARD
      );
      if (!response) continue;
      expect(response.targetIds).toEqual([bigThreat.id]);
      return;
    }
    throw new Error('no responding seed found');
  });

  it('reaches counter, destroy, and bounce across seeds, with messages naming the target', () => {
    const seen = new Map<ResistanceResponse['effect'], ResistanceResponse>();
    for (let seed = 1; seed <= 5000 && seen.size < 3; seed++) {
      const { response } = resistanceRespond(
        createResistanceState(seed),
        { kind: 'played', card: bigThreat },
        emptyBoard,
        STANDARD
      );
      if (response) seen.set(response.effect, response);
    }
    expect([...seen.keys()].sort()).toEqual(['bounce', 'counter', 'destroy']);
    expect(seen.get('counter')!.message).toBe(
      `Opponent casts ${seen.get('counter')!.spellName}: ${bigThreat.name} is countered`
    );
    expect(seen.get('destroy')!.message).toBe(
      `Opponent casts ${seen.get('destroy')!.spellName}: ${bigThreat.name} is destroyed`
    );
    expect(seen.get('bounce')!.message).toBe(
      `Opponent casts ${seen.get('bounce')!.spellName}: ${bigThreat.name} is returned to hand`
    );
  });

  it('responds more often to high threats than low ones (empirical over seeds)', () => {
    const cheap = card('c', { name: 'Llanowar Elves', manaValue: 1, typeLine: 'Creature — Elf' });
    let high = 0;
    let low = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      if (
        resistanceRespond(
          createResistanceState(seed),
          { kind: 'played', card: bigThreat },
          emptyBoard,
          STANDARD
        ).response
      )
        high++;
      if (
        resistanceRespond(
          createResistanceState(seed),
          { kind: 'played', card: cheap },
          emptyBoard,
          STANDARD
        ).response
      )
        low++;
    }
    expect(high).toBeGreaterThan(low);
    // Sanity band around the documented 45% / 12% chances.
    expect(high / 1000).toBeGreaterThan(0.3);
    expect(low / 1000).toBeLessThan(0.25);
  });

  it('treats unknown typeLine as a nonland spell (can respond)', () => {
    const unknown = card('u', { name: 'Mystery', manaValue: 8 });
    let responded = false;
    for (let seed = 1; seed <= 2000 && !responded; seed++) {
      responded = !!resistanceRespond(
        createResistanceState(seed),
        { kind: 'played', card: unknown },
        emptyBoard,
        STANDARD
      ).response;
    }
    expect(responded).toBe(true);
  });
});

describe('resistanceRespond — turnStart / board wipe', () => {
  const permanents = Array.from({ length: 6 }, (_, i) =>
    card(`p${i}`, { name: `Permanent ${i}`, typeLine: 'Creature — Human', manaValue: 3 })
  );

  function findWipeSeed(config: ResistanceConfig = STANDARD): number {
    for (let seed = 1; seed <= 2000; seed++) {
      const { response } = resistanceRespond(
        createResistanceState(seed),
        { kind: 'turnStart', turn: 2 },
        board(permanents),
        config
      );
      if (response?.effect === 'wipe') return seed;
    }
    throw new Error('no wipe seed found in 1..2000');
  }

  it('never wipes with fewer than 5 nonland, non-token permanents', () => {
    const four = permanents.slice(0, 4);
    for (let seed = 1; seed <= 500; seed++) {
      const { response } = resistanceRespond(
        createResistanceState(seed),
        { kind: 'turnStart', turn: 2 },
        board(four),
        STANDARD
      );
      expect(response).toBeNull();
    }
  });

  it('lands and tokens do not count toward (or die to) the wipe', () => {
    const mixed = [
      ...permanents.slice(0, 4),
      card('land', { name: 'Forest', typeLine: 'Basic Land — Forest' }),
      card('tok', { name: 'Soldier', typeLine: 'Token Creature — Soldier', isToken: true }),
    ];
    // 4 wipeable permanents + land + token = still under the 5 threshold.
    for (let seed = 1; seed <= 500; seed++) {
      const { response } = resistanceRespond(
        createResistanceState(seed),
        { kind: 'turnStart', turn: 2 },
        board(mixed),
        STANDARD
      );
      expect(response).toBeNull();
    }
    // Above threshold, targets exclude the land and token.
    const seed = findWipeSeed();
    const { response } = resistanceRespond(
      createResistanceState(seed),
      { kind: 'turnStart', turn: 2 },
      board([...permanents, card('land2', { typeLine: 'Land — Island' })]),
      STANDARD
    );
    expect(response?.effect).toBe('wipe');
    expect(response?.targetIds.sort()).toEqual(permanents.map((p) => p.id).sort());
  });

  it('wipes at most `wipesPerGame` times and announces without a card name', () => {
    const seed = findWipeSeed();
    let state: ResistanceState = createResistanceState(seed);
    const first = resistanceRespond(
      state,
      { kind: 'turnStart', turn: 2 },
      board(permanents),
      STANDARD
    );
    expect(first.response?.effect).toBe('wipe');
    expect(first.response?.message).toBe(
      `Opponent casts ${first.response?.spellName}: the board is wiped`
    );
    expect(first.state.wipesUsed).toBe(1);
    // Every later turnStart, regardless of board size, never wipes again
    // (standard's budget is 1).
    state = first.state;
    for (let turn = 3; turn <= 30; turn++) {
      const later = resistanceRespond(
        state,
        { kind: 'turnStart', turn },
        board(permanents),
        STANDARD
      );
      expect(later.response).toBeNull();
      state = later.state;
    }
  });

  it('a wipe spends the turn budget', () => {
    const seed = findWipeSeed();
    const wiped = resistanceRespond(
      createResistanceState(seed),
      { kind: 'turnStart', turn: 2 },
      board(permanents),
      STANDARD
    );
    expect(wiped.state.responsesThisTurn).toBe(1);
    const play = resistanceRespond(
      wiped.state,
      { kind: 'played', card: bigThreat },
      emptyBoard,
      STANDARD
    );
    expect(play.response).toBeNull();
  });

  it('all four effects are reachable across seeds', () => {
    const effects = new Set<string>();
    for (let seed = 1; seed <= 5000 && effects.size < 4; seed++) {
      const played = resistanceRespond(
        createResistanceState(seed),
        { kind: 'played', card: bigThreat },
        emptyBoard,
        STANDARD
      ).response;
      if (played) effects.add(played.effect);
      const wiped = resistanceRespond(
        createResistanceState(seed),
        { kind: 'turnStart', turn: 2 },
        board(permanents),
        STANDARD
      ).response;
      if (wiped) effects.add(wiped.effect);
    }
    expect([...effects].sort()).toEqual(['bounce', 'counter', 'destroy', 'wipe']);
  });

  it('ruthless allows a second wipe once the first is spent', () => {
    const config = RESISTANCE_PRESETS.ruthless;
    const seed = findWipeSeed(config);
    let state = createResistanceState(seed);
    const first = resistanceRespond(
      state,
      { kind: 'turnStart', turn: 2 },
      board(permanents),
      config
    );
    expect(first.response?.effect).toBe('wipe');
    expect(first.state.wipesUsed).toBe(1);
    state = first.state;

    // Keep advancing turns until a second wipe fires, or fail within a bound.
    let secondWiped = false;
    for (let turn = 3; turn <= 5000 && !secondWiped; turn++) {
      const r = resistanceRespond(state, { kind: 'turnStart', turn }, board(permanents), config);
      state = r.state;
      if (r.response?.effect === 'wipe') secondWiped = true;
    }
    expect(secondWiped).toBe(true);
    expect(state.wipesUsed).toBe(2);

    // The budget (2) is now exhausted — no third wipe, ever.
    for (let turn = 5001; turn <= 5100; turn++) {
      const r = resistanceRespond(state, { kind: 'turnStart', turn }, board(permanents), config);
      expect(r.response?.effect).not.toBe('wipe');
      state = r.state;
    }
  });
});

describe('preset behavior differences', () => {
  it('standard preset is byte-for-byte the legacy hardcoded constants', () => {
    expect(STANDARD).toEqual({
      responseChance: { high: 0.45, medium: 0.3, low: 0.12 },
      counterShare: 0.5,
      destroyShare: 0.35,
      wipeChance: 0.25,
      wipeMinPermanents: 5,
      wipesPerGame: 1,
      maxResponsesPerTurn: 1,
    });
  });

  it('casual responds less often than standard, which responds less often than ruthless', () => {
    function responseRate(config: ResistanceConfig, threat: PlaytestCard, seeds: number): number {
      let hits = 0;
      for (let seed = 1; seed <= seeds; seed++) {
        if (
          resistanceRespond(
            createResistanceState(seed),
            { kind: 'played', card: threat },
            emptyBoard,
            config
          ).response
        )
          hits++;
      }
      return hits / seeds;
    }
    const casual = responseRate(RESISTANCE_PRESETS.casual, bigThreat, 2000);
    const standard = responseRate(RESISTANCE_PRESETS.standard, bigThreat, 2000);
    const ruthless = responseRate(RESISTANCE_PRESETS.ruthless, bigThreat, 2000);
    expect(casual).toBeLessThan(standard);
    expect(standard).toBeLessThan(ruthless);
  });

  it("ruthless's maxResponsesPerTurn allows two responses in the same turn", () => {
    const config = RESISTANCE_PRESETS.ruthless;
    const threats = [bigThreat, { ...bigThreat, id: 'threat-2' }, { ...bigThreat, id: 'threat-3' }];
    for (let seed = 1; seed <= 2000; seed++) {
      let state = createResistanceState(seed);
      let hits = 0;
      for (const t of threats) {
        const r = resistanceRespond(state, { kind: 'played', card: t }, emptyBoard, config);
        state = r.state;
        if (r.response) hits++;
      }
      if (hits === 2) return; // found a seed with two responses in one turn — budget honored
      expect(hits).toBeLessThanOrEqual(config.maxResponsesPerTurn);
    }
    throw new Error('no seed in 1..2000 produced two ruthless responses in one turn');
  });
});

/* ── E533: turn gate, answer switches, attacks, discard, Game Changers ──── */

const fiveOnBoard = Array.from({ length: 5 }, (_, i) =>
  card(`p${i}`, { typeLine: 'Artifact', manaValue: 2 })
);
const hand = [card('h1', { name: 'Sol Ring' }), card('h2', { name: 'Island' }), card('h3')];

function opts(patch: Partial<ResistanceOptions> = {}): ResistanceOptions {
  return { ...DEFAULT_RESISTANCE_OPTIONS, ...patch };
}

function effectsOnly(...on: ResistanceEffect[]): ResistanceOptions['effects'] {
  return Object.fromEntries(RESISTANCE_EFFECTS.map((e) => [e, on.includes(e)])) as Record<
    ResistanceEffect,
    boolean
  >;
}

describe('E533 — first-answer turn', () => {
  it('never answers a play before the first turn, and spends no roll doing so', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const state = createResistanceState(seed);
      const r = resistanceRespond(
        state,
        { kind: 'played', card: bigThreat, turn: 2 },
        emptyBoard,
        RESISTANCE_PRESETS.ruthless,
        opts({ firstTurn: 3 })
      );
      expect(r.response).toBeNull();
      expect(r.state).toBe(state);
    }
  });

  it('a turn start before the first turn only resets the per-turn budget', () => {
    const state = { ...createResistanceState(5), responsesThisTurn: 1 };
    const r = resistanceRespond(
      state,
      { kind: 'turnStart', turn: 2 },
      { battlefield: fiveOnBoard.map((c) => ({ card: c })), hand },
      RESISTANCE_PRESETS.ruthless,
      opts({ firstTurn: 3 })
    );
    expect(r.response).toBeNull();
    expect(r.state).toEqual({ ...state, responsesThisTurn: 0 });
  });

  it('answers from the first turn on', () => {
    const hit = Array.from({ length: 300 }, (_, i) => i + 1).some(
      (seed) =>
        resistanceRespond(
          createResistanceState(seed),
          { kind: 'played', card: bigThreat, turn: 3 },
          emptyBoard,
          STANDARD,
          opts({ firstTurn: 3 })
        ).response !== null
    );
    expect(hit).toBe(true);
  });
});

describe('E533 — answer switches', () => {
  it('only the answers left on ever fire at a play', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 1500; seed++) {
      const r = resistanceRespond(
        createResistanceState(seed),
        { kind: 'played', card: bigThreat, turn: 5 },
        emptyBoard,
        RESISTANCE_PRESETS.ruthless,
        opts({ effects: effectsOnly('destroy', 'bounce') })
      );
      if (r.response) seen.add(r.response.effect);
    }
    expect([...seen].sort()).toEqual(['bounce', 'destroy']);
  });

  it('with counters, removal and bounce all off, a play draws nothing and no roll', () => {
    const state = createResistanceState(9);
    const r = resistanceRespond(
      state,
      { kind: 'played', card: bigThreat, turn: 5 },
      emptyBoard,
      RESISTANCE_PRESETS.ruthless,
      opts({ effects: effectsOnly('wipe', 'attack') })
    );
    expect(r).toEqual({ state, response: null });
  });

  it('wipes off: a full board is never wiped', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const r = resistanceRespond(
        createResistanceState(seed),
        { kind: 'turnStart', turn: 6 },
        { battlefield: fiveOnBoard.map((c) => ({ card: c })) },
        RESISTANCE_PRESETS.ruthless,
        opts({ effects: effectsOnly('counter') })
      );
      expect(r.response).toBeNull();
    }
  });

  it('a bounce returns the card to hand; a counter or removal to the graveyard', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const r = resistanceRespond(
        createResistanceState(seed),
        { kind: 'played', card: bigThreat, turn: 5 },
        emptyBoard,
        RESISTANCE_PRESETS.ruthless,
        opts()
      ).response;
      if (!r) continue;
      expect(r.to).toBe(r.effect === 'bounce' ? 'hand' : 'graveyard');
      expect(r.lifeLoss).toBe(0);
    }
  });
});

describe('E533 — pressure between your turns', () => {
  function betweenTurns(
    seed: number,
    turn: number,
    options: ResistanceOptions,
    board: ResistanceBoard = { battlefield: [], hand }
  ) {
    return resistanceRespond(
      createResistanceState(seed),
      { kind: 'turnStart', turn },
      board,
      STANDARD,
      options,
      RESISTANCE_PRESSURE.standard
    ).response;
  }

  it('an attack loses life inside the turn band, and moves no cards', () => {
    let attacks = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const r = betweenTurns(seed, 6, opts({ effects: effectsOnly('attack') }));
      if (!r) continue;
      attacks++;
      expect(r.effect).toBe('attack');
      expect(r.targetIds).toEqual([]);
      // Turn 6 at Standard in a 40-life game: 4 to 8.
      expect(r.lifeLoss).toBeGreaterThanOrEqual(4);
      expect(r.lifeLoss).toBeLessThanOrEqual(8);
      expect(r.message).toBe(`Opponent attacks: you lose ${r.lifeLoss} life`);
    }
    // Standard's 40% attack chance over 500 seeds.
    expect(attacks).toBeGreaterThan(150);
    expect(attacks).toBeLessThan(250);
  });

  it('attacks hit a 20-life game about half as hard', () => {
    let max = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const r = betweenTurns(seed, 6, opts({ effects: effectsOnly('attack') }), {
        battlefield: [],
        startingLife: 20,
      });
      if (r) max = Math.max(max, r.lifeLoss);
    }
    expect(max).toBe(4);
  });

  it('discard takes distinct cards from your hand, at random, named in the message', () => {
    let discards = 0;
    for (let seed = 1; seed <= 800; seed++) {
      const r = betweenTurns(seed, 5, opts({ effects: effectsOnly('discard') }));
      if (!r) continue;
      discards++;
      expect(r.effect).toBe('discard');
      expect(r.to).toBe('graveyard');
      expect(new Set(r.targetIds).size).toBe(r.targetIds.length);
      expect(r.targetIds.length).toBe(r.spellName === 'Hymn to Tourach' ? 2 : 1);
      for (const id of r.targetIds) expect(hand.map((c) => c.id)).toContain(id);
      expect(r.message).toMatch(/: you discard .+ at random$/);
    }
    expect(discards).toBeGreaterThan(0);
  });

  it('never discards from an empty hand', () => {
    for (let seed = 1; seed <= 300; seed++) {
      expect(
        betweenTurns(seed, 5, opts({ effects: effectsOnly('discard') }), { battlefield: [] })
      ).toBeNull();
    }
  });

  it('a wipe that fires takes the turn: no attack on top of it', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const r = resistanceRespond(
        createResistanceState(seed),
        { kind: 'turnStart', turn: 6 },
        { battlefield: fiveOnBoard.map((c) => ({ card: c })), hand },
        { ...STANDARD, wipeChance: 1 },
        opts()
      ).response;
      expect(r?.effect).toBe('wipe');
    }
  });

  it('Ruthless attacks more often than Casual', () => {
    const rate = (level: 'casual' | 'ruthless') => {
      let hits = 0;
      for (let seed = 1; seed <= 1000; seed++) {
        const r = resistanceRespond(
          createResistanceState(seed),
          { kind: 'turnStart', turn: 6 },
          { battlefield: [] },
          RESISTANCE_PRESETS[level],
          opts({ effects: effectsOnly('attack') }),
          RESISTANCE_PRESSURE[level]
        ).response;
        if (r) hits++;
      }
      return hits;
    };
    expect(rate('casual')).toBeLessThan(rate('ruthless'));
  });
});

describe('E533 — Game Changers', () => {
  const GAME_CHANGERS = ['Cyclonic Rift', 'Force of Will', 'Fierce Guardianship'];

  function names(options: ResistanceOptions): Set<string> {
    const out = new Set<string>();
    for (let seed = 1; seed <= 3000; seed++) {
      const play = resistanceRespond(
        createResistanceState(seed),
        { kind: 'played', card: bigThreat, turn: 5 },
        emptyBoard,
        RESISTANCE_PRESETS.ruthless,
        options
      ).response;
      if (play) out.add(play.spellName);
      const wipe = resistanceRespond(
        createResistanceState(seed),
        { kind: 'turnStart', turn: 6 },
        { battlefield: fiveOnBoard.map((c) => ({ card: c })) },
        RESISTANCE_PRESETS.ruthless,
        options
      ).response;
      if (wipe) out.add(wipe.spellName);
    }
    return out;
  }

  it('off: no Game Changer is ever cast', () => {
    const seen = names(opts({ gameChangers: false }));
    for (const gc of GAME_CHANGERS) expect(seen.has(gc)).toBe(false);
  });

  it('on: they turn up, and an overloaded Rift sends the board to hand', () => {
    const seen = names(opts({ gameChangers: true }));
    for (const gc of GAME_CHANGERS) expect(seen.has(gc)).toBe(true);
    for (let seed = 1; seed <= 3000; seed++) {
      const r = resistanceRespond(
        createResistanceState(seed),
        { kind: 'turnStart', turn: 6 },
        { battlefield: fiveOnBoard.map((c) => ({ card: c })) },
        { ...RESISTANCE_PRESETS.ruthless, wipeChance: 1 },
        opts({ gameChangers: true })
      ).response;
      if (r?.spellName !== 'Cyclonic Rift') continue;
      expect(r.effect).toBe('wipe');
      expect(r.to).toBe('hand');
      expect(r.message).toBe('Opponent overloads Cyclonic Rift: your board returns to hand');
      return;
    }
    throw new Error('no seed overloaded a Rift');
  });
});

describe('E533 — bracket, summaries and stored options', () => {
  it('maps a bracket to the level that fits it', () => {
    expect([1, 2, 3, 4, 5].map(levelForBracket)).toEqual([
      'casual',
      'casual',
      'standard',
      'ruthless',
      'ruthless',
    ]);
    expect(levelForBracket(null)).toBeNull();
    expect(levelForBracket(undefined)).toBeNull();
  });

  it('Game Changers default on from bracket 3, off below it and when unknown', () => {
    expect([1, 2, 3, 4, 5].map(gameChangersForBracket)).toEqual([false, false, true, true, true]);
    expect(gameChangersForBracket(null)).toBe(false);
  });

  it('summarizes the answers in play', () => {
    expect(summarizeEffects(DEFAULT_RESISTANCE_OPTIONS.effects)).toBe('All 6');
    expect(summarizeEffects({ ...DEFAULT_RESISTANCE_OPTIONS.effects, discard: false })).toBe(
      'No discard'
    );
    expect(summarizeEffects(effectsOnly('counter', 'wipe'))).toBe('2 of 6');
    expect(summarizeEffects(effectsOnly())).toBe('None');
  });

  it('normalizes a stored shape field by field', () => {
    expect(normalizeResistanceOptions(null, LEGACY_RESISTANCE_OPTIONS)).toBe(
      LEGACY_RESISTANCE_OPTIONS
    );
    expect(
      normalizeResistanceOptions(
        { firstTurn: 9, effects: { attack: true, counter: 'yes' }, gameChangers: true },
        LEGACY_RESISTANCE_OPTIONS
      )
    ).toEqual({
      firstTurn: 1,
      effects: { ...LEGACY_RESISTANCE_OPTIONS.effects, attack: true },
      gameChangers: true,
    });
  });

  it('remembers timing and answers on the device, never Game Changers', () => {
    localStorage.clear();
    expect(loadResistanceOptions(false)).toEqual(DEFAULT_RESISTANCE_OPTIONS);
    saveResistanceOptions(opts({ firstTurn: 4, gameChangers: true }));
    expect(loadResistanceOptions(false)).toEqual(opts({ firstTurn: 4, gameChangers: false }));
    expect(loadResistanceOptions(true).gameChangers).toBe(true);
  });
});

describe('E533 — applyResistance', () => {
  function playState(overrides: Partial<PlaytestState> = {}): PlaytestState {
    return { ...createPlaytestState({ library: [], seed: 1, life: 40 }), ...overrides };
  }

  it('applies an attack as one life change, listed in `applied`', () => {
    const prev = playState({ turn: 5 });
    const next = playState({ turn: 6 });
    for (let seed = 1; seed <= 200; seed++) {
      const r = applyResistance(
        createResistanceState(seed),
        prev,
        next,
        { type: 'NEXT_TURN' },
        STANDARD,
        opts({ effects: effectsOnly('attack') })
      );
      if (!r.message) continue;
      expect(r.applied).toHaveLength(1);
      expect(r.applied[0].action.type).toBe('ADJUST_LIFE');
      expect(r.state.life).toBeLessThan(40);
      expect(r.state.past).toHaveLength(next.past.length + 1);
      return;
    }
    throw new Error('no seed attacked');
  });
});
