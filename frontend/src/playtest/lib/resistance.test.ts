import { describe, expect, it } from 'vitest';
import type { PlaytestCard } from '@/lib/playtest';
import {
  createResistanceState,
  resistanceRespond,
  type ResistanceEvent,
  type ResistanceResponse,
  type ResistanceState,
} from './resistance';

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

/** Run a fixed event sequence, collecting (response | null) per step. */
function run(
  seed: number,
  events: Array<{ event: ResistanceEvent; battlefield?: PlaytestCard[] }>
): Array<ResistanceResponse | null> {
  let state = createResistanceState(seed);
  const out: Array<ResistanceResponse | null> = [];
  for (const { event, battlefield } of events) {
    const r = resistanceRespond(state, event, battlefield ? board(battlefield) : emptyBoard);
    state = r.state;
    out.push(r.response);
  }
  return out;
}

describe('createResistanceState', () => {
  it('starts with the wipe available and no response spent', () => {
    const s = createResistanceState(123);
    expect(s).toEqual({ seed: 123, wipeUsed: false, respondedThisTurn: false });
  });

  it('coerces the seed to a uint32 and randomizes when omitted', () => {
    expect(createResistanceState(-1).seed).toBe(0xffffffff);
    expect(createResistanceState().seed).toBeGreaterThanOrEqual(0);
  });
});

describe('resistanceRespond — determinism', () => {
  it('same seed and event sequence produce the same responses', () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      i % 3 === 2
        ? { event: { kind: 'turnStart', turn: i } as ResistanceEvent }
        : { event: { kind: 'played', card: bigThreat } as ResistanceEvent }
    );
    expect(run(77, events)).toEqual(run(77, events));
  });

  it('every call that rolls advances the seed', () => {
    const s0 = createResistanceState(5);
    const r1 = resistanceRespond(s0, { kind: 'played', card: bigThreat }, emptyBoard);
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
        emptyBoard
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
        emptyBoard
      );
      expect(response).toBeNull();
    }
  });

  it('responds at most once per turn; the budget resets on turnStart', () => {
    // Find a seed whose first play draws a response, then keep playing.
    for (let seed = 1; seed <= 2000; seed++) {
      let state = createResistanceState(seed);
      const first = resistanceRespond(state, { kind: 'played', card: bigThreat }, emptyBoard);
      if (!first.response) continue;
      state = first.state;
      // Same turn: no further responses no matter how many plays follow.
      for (let i = 0; i < 10; i++) {
        const again = resistanceRespond(state, { kind: 'played', card: bigThreat }, emptyBoard);
        expect(again.response).toBeNull();
        state = again.state;
      }
      // New turn: the opponent may respond again (budget reset observable).
      const reset = resistanceRespond(state, { kind: 'turnStart', turn: 2 }, emptyBoard);
      expect(reset.state.respondedThisTurn).toBe(false);
      return;
    }
    throw new Error('no seed in 1..2000 produced a response to a high threat');
  });

  it('counter/destroy/bounce target exactly the just-played card', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const { response } = resistanceRespond(
        createResistanceState(seed),
        { kind: 'played', card: bigThreat },
        emptyBoard
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
        emptyBoard
      );
      if (response) seen.set(response.effect, response);
    }
    expect([...seen.keys()].sort()).toEqual(['bounce', 'counter', 'destroy']);
    expect(seen.get('counter')!.message).toBe(
      `Opponent casts ${seen.get('counter')!.spellName} — ${bigThreat.name} is countered`
    );
    expect(seen.get('destroy')!.message).toBe(
      `Opponent casts ${seen.get('destroy')!.spellName} — ${bigThreat.name} is destroyed`
    );
    expect(seen.get('bounce')!.message).toBe(
      `Opponent casts ${seen.get('bounce')!.spellName} — ${bigThreat.name} is returned to hand`
    );
  });

  it('responds more often to high threats than low ones (empirical over seeds)', () => {
    const cheap = card('c', { name: 'Llanowar Elves', manaValue: 1, typeLine: 'Creature — Elf' });
    let high = 0;
    let low = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      if (resistanceRespond(createResistanceState(seed), { kind: 'played', card: bigThreat }, emptyBoard).response)
        high++;
      if (resistanceRespond(createResistanceState(seed), { kind: 'played', card: cheap }, emptyBoard).response)
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
        emptyBoard
      ).response;
    }
    expect(responded).toBe(true);
  });
});

describe('resistanceRespond — turnStart / board wipe', () => {
  const permanents = Array.from({ length: 6 }, (_, i) =>
    card(`p${i}`, { name: `Permanent ${i}`, typeLine: 'Creature — Human', manaValue: 3 })
  );

  function findWipeSeed(): number {
    for (let seed = 1; seed <= 2000; seed++) {
      const { response } = resistanceRespond(
        createResistanceState(seed),
        { kind: 'turnStart', turn: 2 },
        board(permanents)
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
        board(four)
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
        board(mixed)
      );
      expect(response).toBeNull();
    }
    // Above threshold, targets exclude the land and token.
    const seed = findWipeSeed();
    const { response } = resistanceRespond(
      createResistanceState(seed),
      { kind: 'turnStart', turn: 2 },
      board([...permanents, card('land2', { typeLine: 'Land — Island' })])
    );
    expect(response?.effect).toBe('wipe');
    expect(response?.targetIds.sort()).toEqual(permanents.map((p) => p.id).sort());
  });

  it('wipes at most once per game and announces without a card name', () => {
    const seed = findWipeSeed();
    let state: ResistanceState = createResistanceState(seed);
    const first = resistanceRespond(state, { kind: 'turnStart', turn: 2 }, board(permanents));
    expect(first.response?.effect).toBe('wipe');
    expect(first.response?.message).toBe(
      `Opponent casts ${first.response?.spellName} — the board is wiped`
    );
    expect(first.state.wipeUsed).toBe(true);
    // Every later turnStart, regardless of board size, never wipes again.
    state = first.state;
    for (let turn = 3; turn <= 30; turn++) {
      const later = resistanceRespond(state, { kind: 'turnStart', turn }, board(permanents));
      expect(later.response).toBeNull();
      state = later.state;
    }
  });

  it('a wipe spends the one response for that turn', () => {
    const seed = findWipeSeed();
    const wiped = resistanceRespond(
      createResistanceState(seed),
      { kind: 'turnStart', turn: 2 },
      board(permanents)
    );
    expect(wiped.state.respondedThisTurn).toBe(true);
    const play = resistanceRespond(wiped.state, { kind: 'played', card: bigThreat }, emptyBoard);
    expect(play.response).toBeNull();
  });

  it('all four effects are reachable across seeds', () => {
    const effects = new Set<string>();
    for (let seed = 1; seed <= 5000 && effects.size < 4; seed++) {
      const played = resistanceRespond(
        createResistanceState(seed),
        { kind: 'played', card: bigThreat },
        emptyBoard
      ).response;
      if (played) effects.add(played.effect);
      const wiped = resistanceRespond(
        createResistanceState(seed),
        { kind: 'turnStart', turn: 2 },
        board(permanents)
      ).response;
      if (wiped) effects.add(wiped.effect);
    }
    expect([...effects].sort()).toEqual(['bounce', 'counter', 'destroy', 'wipe']);
  });
});
