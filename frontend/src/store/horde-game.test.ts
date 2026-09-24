// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { useHordeGameStore, type HordeSurvivor } from './horde-game';
import { resolveHordeSettings } from '@/lib/horde';
import { usePlayStore } from '@/store/play';

const SURVIVORS: HordeSurvivor[] = [
  { name: 'Alice', deckId: null, deckName: null },
  { name: 'Bo', deckId: null, deckName: null },
];

beforeEach(() => {
  localStorage.clear();
  useHordeGameStore.setState({
    config: null,
    boardVisible: true,
    status: 'idle',
    loadError: null,
    pendingStart: null,
    seed: 0,
    survivorsLife: 0,
    board: null,
    librarySizeAtStart: 0,
    bossesRemaining: 0,
    bossTicksCrossed: [],
    survivorTurn: 1,
    hordeTurn: 0,
    phase: 'setup',
    pendingReveal: null,
    pendingAttack: null,
    lastDamageResult: null,
    attackingIds: [],
    outcome: null,
    startedAt: null,
    cardsMilledByDamage: 0,
    damageTaken: 0,
    past: [],
    finished: [],
  });
  usePlayStore.setState({ local: null, online: null, history: [], pendingResults: [] });
});

async function start(overrides?: Parameters<typeof resolveHordeSettings>[2]) {
  await useHordeGameStore.getState().startHorde('zombies', 'standard', overrides, SURVIVORS);
}

describe('startHorde', () => {
  it('loads the fixture deck and sets up the board', async () => {
    await start();
    const s = useHordeGameStore.getState();
    const settings = resolveHordeSettings('standard', 2);
    expect(s.status).toBe('idle');
    expect(s.config?.hordeName).toBe('Zombies');
    expect(s.board?.zones.library.length).toBe(settings.librarySize);
    expect(s.survivorsLife).toBe(settings.life);
    expect(s.phase).toBe('setup');
    expect(s.survivorTurn).toBe(1);
    expect(s.hordeTurn).toBe(0);
    expect(s.board?.zones.hand).toEqual([]);
    expect(s.past).toEqual([]);
  });

  it('reports a load failure and lets a retry recover', async () => {
    await useHordeGameStore
      .getState()
      .startHorde('not-a-real-horde', 'standard', undefined, SURVIVORS);
    expect(useHordeGameStore.getState().status).toBe('error');
    expect(useHordeGameStore.getState().config).toBeNull();
    // Fix the pending request in place (as if the caller retried a real id)
    // and confirm retryLoad replays it.
    useHordeGameStore.setState((s) => ({
      pendingStart: s.pendingStart ? { ...s.pendingStart, hordeId: 'zombies' } : null,
    }));
    useHordeGameStore.getState().retryLoad();
    await new Promise((r) => setTimeout(r, 0));
    expect(useHordeGameStore.getState().status).toBe('idle');
    expect(useHordeGameStore.getState().config?.hordeId).toBe('zombies');
  });

  it('skips setup entirely when setupTurns is overridden to 0', async () => {
    await start({ setupTurns: 0 });
    expect(useHordeGameStore.getState().phase).toBe('live');
  });
});

describe('setup turns', () => {
  it('gates the horde turn until every setup turn has passed', async () => {
    await start(); // standard: setupTurns = 3
    const store = useHordeGameStore.getState();
    expect(store.phase).toBe('setup');
    store.startHordeTurn(); // no-op: not live yet
    expect(useHordeGameStore.getState().phase).toBe('setup');

    useHordeGameStore.getState().endSurvivorTurn();
    useHordeGameStore.getState().endSurvivorTurn();
    expect(useHordeGameStore.getState().phase).toBe('setup');
    expect(useHordeGameStore.getState().survivorTurn).toBe(3);

    useHordeGameStore.getState().endSurvivorTurn();
    expect(useHordeGameStore.getState().phase).toBe('live');
    expect(useHordeGameStore.getState().survivorTurn).toBe(4);
  });
});

describe('a horde turn', () => {
  async function readyLiveGame() {
    await start({ setupTurns: 0 });
  }

  it('reveals cards into a pending sheet without touching the battlefield yet', async () => {
    await readyLiveGame();
    const before = useHordeGameStore.getState().board!;
    useHordeGameStore.getState().startHordeTurn();
    const s = useHordeGameStore.getState();
    expect(s.phase).toBe('reveal');
    expect(s.pendingReveal).not.toBeNull();
    expect(s.pendingReveal!.revealed.length).toBeGreaterThan(0);
    // Nothing has moved yet — same battlefield/library as before the plan.
    expect(s.board).toBe(before);
    expect(s.hordeTurn).toBe(1);
  });

  it('confirming places permanents, resolves spells, and opens combat', async () => {
    await readyLiveGame();
    useHordeGameStore.getState().startHordeTurn();
    const revealedIds = new Set(
      useHordeGameStore.getState().pendingReveal!.revealed.map((c) => c.id)
    );
    useHordeGameStore.getState().confirmReveal();
    const s = useHordeGameStore.getState();
    expect(s.pendingReveal).toBeNull();
    expect(['combat', 'ended']).toContain(s.phase);
    // Every revealed card left the library either onto the battlefield or
    // into the graveyard (resolved spells) — none vanish.
    const onBoard = new Set(s.board!.battlefield.map((b) => b.card.id));
    const inGrave = new Set(s.board!.zones.graveyard.map((c) => c.id));
    for (const id of revealedIds) {
      expect(onBoard.has(id) || inGrave.has(id)).toBe(true);
    }
  });

  it('an attack reduces shared life and returns to the survivors', async () => {
    await readyLiveGame();
    useHordeGameStore.getState().startHordeTurn();
    useHordeGameStore.getState().confirmReveal();
    const beforeLife = useHordeGameStore.getState().survivorsLife;
    if (useHordeGameStore.getState().phase !== 'combat') return; // no creatures revealed this run
    const attack = useHordeGameStore.getState().pendingAttack!;
    useHordeGameStore.getState().resolveAttack(attack.power);
    const s = useHordeGameStore.getState();
    expect(s.survivorsLife).toBe(Math.max(0, beforeLife - attack.power));
    expect(s.damageTaken).toBe(attack.power);
    expect(s.pendingAttack).toBeNull();
    expect(s.attackingIds).toEqual([]);
    expect(['live', 'ended']).toContain(s.phase);
  });
});

describe('damaging the horde', () => {
  it('mills the library and tracks the running total', async () => {
    await start();
    const before = useHordeGameStore.getState().board!.zones.library.length;
    useHordeGameStore.getState().damageHorde(5);
    const s = useHordeGameStore.getState();
    expect(s.board!.zones.library.length).toBe(before - 5);
    expect(s.cardsMilledByDamage).toBe(5);
    expect(s.lastDamageResult?.milled.length).toBe(5);
  });

  it('crosses a boss tick and puts the boss onto the battlefield exactly once', async () => {
    await start({ librarySize: 10, bossTicks: [0.5] });
    useHordeGameStore.getState().damageHorde(5); // exactly half
    const s = useHordeGameStore.getState();
    expect(s.bossTicksCrossed).toEqual([0]);
    expect(s.lastDamageResult?.bossesEntered.length).toBe(1);
    const bossOnBoard = s.board!.battlefield.filter((b) => b.card.id.startsWith('horde-boss-'));
    expect(bossOnBoard.length).toBe(1);

    // Milling further never re-fires the same tick.
    useHordeGameStore.getState().damageHorde(1);
    expect(useHordeGameStore.getState().bossTicksCrossed).toEqual([0]);
  });
});

describe('outcome', () => {
  it('is a loss the moment shared life hits zero', async () => {
    await start({ setupTurns: 0 });
    useHordeGameStore.getState().startHordeTurn();
    if (useHordeGameStore.getState().phase === 'reveal')
      useHordeGameStore.getState().confirmReveal();
    useHordeGameStore.setState({ survivorsLife: 1 });
    if (useHordeGameStore.getState().phase === 'combat') {
      useHordeGameStore.getState().resolveAttack(1);
      expect(useHordeGameStore.getState().outcome).toBe('lost');
      expect(useHordeGameStore.getState().phase).toBe('ended');
      expect(useHordeGameStore.getState().finished[0]?.outcome).toBe('lost');
    }
  });

  it('is a win once the library is empty and no horde creature remains', async () => {
    await start({ librarySize: 4, bossTicks: [] });
    // Drain the library entirely and clear the battlefield by hand — the
    // fixture's own draws would otherwise leave creatures out.
    useHordeGameStore.setState((s) => ({
      board: { ...s.board!, battlefield: [] },
    }));
    useHordeGameStore.getState().damageHorde(4);
    const s = useHordeGameStore.getState();
    expect(s.board!.zones.library.length).toBe(0);
    expect(s.outcome).toBe('won');
    expect(s.phase).toBe('ended');
  });
});

describe('moveHordeCard', () => {
  it('lets a defeated boss leave the battlefield, clearing the way to a win', async () => {
    await start({ librarySize: 4, bossTicks: [0.5] });
    useHordeGameStore.getState().damageHorde(2); // crosses the tick, boss enters
    let s = useHordeGameStore.getState();
    const boss = s.board!.battlefield.find((b) => b.card.id.startsWith('horde-boss-'));
    expect(boss).toBeDefined();
    // Emptying the rest of the library while the boss still stands is not a win.
    useHordeGameStore.getState().damageHorde(2);
    expect(useHordeGameStore.getState().outcome).toBeNull();
    useHordeGameStore.getState().moveHordeCard(boss!.card.id, 'graveyard');
    s = useHordeGameStore.getState();
    expect(s.board!.battlefield.some((b) => b.card.id === boss!.card.id)).toBe(false);
    expect(s.outcome).toBe('won');
  });
});

describe('undo', () => {
  it('reverts the last mutating action in one step', async () => {
    await start();
    const beforeLibrary = useHordeGameStore.getState().board!.zones.library.length;
    useHordeGameStore.getState().damageHorde(3);
    expect(useHordeGameStore.getState().board!.zones.library.length).toBe(beforeLibrary - 3);
    useHordeGameStore.getState().undo();
    expect(useHordeGameStore.getState().board!.zones.library.length).toBe(beforeLibrary);
    expect(useHordeGameStore.getState().cardsMilledByDamage).toBe(0);
  });

  it('is a no-op with nothing to undo', async () => {
    await start();
    const s = useHordeGameStore.getState();
    useHordeGameStore.getState().undo();
    expect(useHordeGameStore.getState()).toEqual(s);
  });
});

describe('leaveGame / concede', () => {
  it('leaveGame clears the whole game back to the initial shape', async () => {
    await start();
    useHordeGameStore.getState().leaveGame();
    const s = useHordeGameStore.getState();
    expect(s.config).toBeNull();
    expect(s.board).toBeNull();
    expect(s.phase).toBe('setup');
    expect(s.past).toEqual([]);
  });

  it('concede records a loss without clearing the board', async () => {
    await start();
    useHordeGameStore.getState().concede();
    const s = useHordeGameStore.getState();
    expect(s.outcome).toBe('lost');
    expect(s.phase).toBe('ended');
    expect(s.finished[0]?.outcome).toBe('lost');
    expect(s.config).not.toBeNull();
  });
});

describe('posting the result (T118: same durable path as a real local game)', () => {
  it('a finished game lands in Play history as a co-op record, and queues for post', async () => {
    await start();
    useHordeGameStore.getState().concede();
    const finishedId = useHordeGameStore.getState().finished[0]?.id;
    const play = usePlayStore.getState();
    const record = play.history.find((r) => r.id === finishedId);
    expect(record).toBeDefined();
    expect(record?.format).toBe('horde');
    expect(record?.coopOutcome).toBe('lost');
    expect(record?.hordeId).toBe('zombies');
    expect(record?.winnerSeat).toBeNull();
    expect(record?.players).toHaveLength(2);
    // Guest (the test default): flushPendingResults no-ops, so the game
    // stays queued rather than silently dropped.
    expect(play.pendingResults.some((g) => g.id === finishedId)).toBe(true);
  });

  it('every survivor posts with the shared life total at the end', async () => {
    await start();
    useHordeGameStore.setState({ survivorsLife: 17 });
    useHordeGameStore.getState().concede();
    const finishedId = useHordeGameStore.getState().finished[0]?.id;
    const game = usePlayStore.getState().pendingResults.find((g) => g.id === finishedId);
    expect(game?.players.every((p) => p.life === 17)).toBe(true);
    expect(game?.players).toHaveLength(2);
    expect(game?.status).toBe('finished');
    expect(game?.mode).toBe('local');
  });
});

describe('persistence', () => {
  it('round-trips the whole game through localStorage', async () => {
    await start();
    useHordeGameStore.getState().damageHorde(2);
    const raw = localStorage.getItem('spellcontrol-horde-game');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.config.hordeId).toBe('zombies');
    expect(parsed.state.board.zones.library.length).toBe(
      useHordeGameStore.getState().board!.zones.library.length
    );
  });
});
