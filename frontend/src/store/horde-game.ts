import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  applyAction,
  createPlaytestState,
  type PlaytestCard,
  type PlaytestState,
} from '@/lib/playtest';
import { autoPlace, type Rect } from '@/playtest/lib/auto-place';
import {
  attackSummary,
  bossesCrossed,
  buildHordeLibrary,
  hordeOutcome,
  hordeTurnActions,
  loadHordeDeck,
  millForDamage,
  planHordeTurn,
  resolveActions,
  resolveHordeSettings,
  type HordeBossArrival,
  type HordeDamageResult,
  type HordeLevel,
  type HordePendingAttack,
  type HordeReveal,
  type HordeSettings,
} from '@/lib/horde';
import { genId } from '@/lib/id';
import { createGameState, gameToRecord, makePlayer, type GameState } from '@/lib/game-state';
import { usePlayStore } from '@/store/play';

export interface HordeSurvivor {
  name: string;
  deckId: string | null;
  deckName: string | null;
}

export interface HordeConfig {
  hordeId: string;
  hordeName: string;
  level: HordeLevel;
  settings: HordeSettings;
  survivors: HordeSurvivor[];
}

export type HordePhase = 'setup' | 'live' | 'reveal' | 'combat' | 'ended';

export type { HordeBossArrival, HordeDamageResult, HordePendingAttack, HordeReveal };

export interface HordeFinishedRecord {
  id: string;
  hordeId: string;
  hordeName: string;
  level: HordeLevel;
  survivors: string[];
  outcome: 'won' | 'lost';
  survivorTurns: number;
  hordeTurns: number;
  damageTaken: number;
  cardsMilledByDamage: number;
  bossesBeaten: number;
  finishedAt: number;
}

interface PendingStart {
  hordeId: string;
  level: HordeLevel;
  overrides?: Partial<HordeSettings>;
  survivors: HordeSurvivor[];
}

/** Every field that gets snapshotted for undo — the whole game EXCEPT the
 *  undo stack and the cross-game history, which are never themselves undone. */
interface HordeData {
  config: HordeConfig | null;
  /** Mirrors the local game's minimize/resume — leaving the full-screen table
   *  without ending the game (see GameBoard's `onMinimize`). */
  boardVisible: boolean;
  status: 'idle' | 'loading' | 'error';
  loadError: string | null;
  pendingStart: PendingStart | null;
  seed: number;
  survivorsLife: number;
  board: PlaytestState | null;
  librarySizeAtStart: number;
  bossesRemaining: number;
  bossTicksCrossed: number[];
  survivorTurn: number;
  hordeTurn: number;
  phase: HordePhase;
  pendingReveal: HordeReveal | null;
  pendingAttack: HordePendingAttack | null;
  lastDamageResult: HordeDamageResult | null;
  attackingIds: string[];
  outcome: 'won' | 'lost' | null;
  startedAt: number | null;
  cardsMilledByDamage: number;
  damageTaken: number;
}

const MAX_HORDE_UNDO = 30;

function initialData(): HordeData {
  return {
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
  };
}

function isCreature(card: PlaytestCard): boolean {
  return (card.typeLine ?? '').toLowerCase().includes('creature');
}

function creatureIds(board: PlaytestState): string[] {
  return board.battlefield.filter((b) => isCreature(b.card)).map((b) => b.card.id);
}

interface HordeStore extends HordeData {
  past: HordeData[];
  finished: HordeFinishedRecord[];

  /** Async: fetches the horde's deck JSON, builds the library and starts the
   *  game. Sets `status: 'error'` on failure — the setup screen shows a retry. */
  startHorde(
    hordeId: string,
    level: HordeLevel,
    overrides: Partial<HordeSettings> | undefined,
    survivors: HordeSurvivor[]
  ): Promise<void>;
  retryLoad(): void;
  /** Advances the survivor-turn counter without a horde turn — the only way
   *  to move through the setup turns before the horde can act. */
  endSurvivorTurn(): void;
  /** Plans a horde turn (reveal) off the current library. `rect` is the
   *  table's live battlefield box, for `autoPlace`. */
  startHordeTurn(rect?: Rect | null): void;
  /** Confirms the open reveal: permanents onto the battlefield, resolved
   *  spells to the graveyard, then combat. */
  confirmReveal(): void;
  /** Applies (or skips, at 0) the horde's attack to shared life. */
  resolveAttack(damageDealt: number): void;
  damageHorde(amount: number): void;
  clearLastDamageResult(): void;
  /** Moves one horde permanent off the battlefield — the survivors' own
   *  removal/combat kills, since this board never simulates their side. */
  moveHordeCard(cardId: string, to: 'graveyard' | 'exile' | 'library'): void;
  undo(): void;
  /** Concede — counts as a loss, same as running out of life. */
  concede(): void;
  /** Clears the whole game and returns to setup. */
  leaveGame(): void;
  /** Leaves the full-screen table without ending the game. */
  hideBoard(): void;
  showBoard(): void;
}

function captureData(s: HordeStore): HordeData {
  return {
    config: s.config,
    boardVisible: s.boardVisible,
    status: s.status,
    loadError: s.loadError,
    pendingStart: s.pendingStart,
    seed: s.seed,
    survivorsLife: s.survivorsLife,
    board: s.board,
    librarySizeAtStart: s.librarySizeAtStart,
    bossesRemaining: s.bossesRemaining,
    bossTicksCrossed: s.bossTicksCrossed,
    survivorTurn: s.survivorTurn,
    hordeTurn: s.hordeTurn,
    phase: s.phase,
    pendingReveal: s.pendingReveal,
    pendingAttack: s.pendingAttack,
    lastDamageResult: s.lastDamageResult,
    attackingIds: s.attackingIds,
    outcome: s.outcome,
    startedAt: s.startedAt,
    cardsMilledByDamage: s.cardsMilledByDamage,
    damageTaken: s.damageTaken,
  };
}

/**
 * Builds the shared-shape `GameState` a finished Horde game posts through —
 * the same durable local-result path a real local game uses (see
 * `store/play.ts`'s `recordIfFinished`): queued into `pendingResults` if
 * offline/signed out, flushed when possible, and idempotent on `id`. Built
 * directly with `status: 'finished'` rather than dispatched through `start`/
 * `end` — this record is a fact about a game that already happened on this
 * board, not one this app will keep playing through the online reducer.
 */
function buildHordeGameState(s: HordeStore, id: string, outcome: 'won' | 'lost'): GameState {
  const config = s.config!;
  const now = Date.now();
  const players = config.survivors.map((survivor, i) =>
    makePlayer({
      id: `local_${i}`,
      userId: null,
      seat: i,
      name: survivor.name,
      deckId: survivor.deckId,
      deckName: survivor.deckName,
      startingLife: config.settings.life,
      isHost: i === 0,
    })
  );
  // Every survivor shares one life total — the shared pool at the moment the
  // game ended, on every seat, since the row builder reads life per player.
  for (const p of players) p.life = s.survivorsLife;
  const base = createGameState({
    id,
    code: '',
    mode: 'local',
    hostUserId: null,
    format: 'horde',
    startingLife: config.settings.life,
    commanderDamageEnabled: false,
    poisonEnabled: false,
    players,
    ts: s.startedAt ?? now,
  });
  return {
    ...base,
    status: 'finished',
    startedAt: s.startedAt,
    endedAt: now,
    updatedAt: now,
    winnerSeat: null,
    coopOutcome: outcome,
    hordeId: config.hordeId,
  };
}

/** Posts a finished Horde game into Play history the same way a real local
 *  game does: a record in `usePlayStore.history` plus a queued/flushed
 *  `pendingResults` entry. Both writes are deduped on `id`, so a repeat call
 *  (there should never be one — every caller transitions `phase` to `ended`
 *  first) can never double-post. */
function postHordeResult(s: HordeStore, id: string, outcome: 'won' | 'lost'): void {
  const game = buildHordeGameState(s, id, outcome);
  const play = usePlayStore.getState();
  if (play.history.some((r) => r.id === game.id)) return;
  usePlayStore.setState((p) => ({
    history: [gameToRecord(game, game.endedAt!), ...p.history].slice(0, 500),
    pendingResults: p.pendingResults.some((g) => g.id === game.id)
      ? p.pendingResults
      : [...p.pendingResults, game],
  }));
  void usePlayStore.getState().flushPendingResults();
}

function recordFinished(s: HordeStore, outcome: 'won' | 'lost'): HordeFinishedRecord | null {
  if (!s.config || !s.board) return null;
  const bossesBeaten = s.board.zones.graveyard.filter((c) => c.id.startsWith('horde-boss-')).length;
  const id = genId('horde');
  postHordeResult(s, id, outcome);
  return {
    id,
    hordeId: s.config.hordeId,
    hordeName: s.config.hordeName,
    level: s.config.level,
    survivors: s.config.survivors.map((p) => p.name),
    outcome,
    survivorTurns: s.survivorTurn,
    hordeTurns: s.hordeTurn,
    damageTaken: s.damageTaken,
    cardsMilledByDamage: s.cardsMilledByDamage,
    bossesBeaten,
    finishedAt: Date.now(),
  };
}

export const useHordeGameStore = create<HordeStore>()(
  persist(
    (set, get) => ({
      ...initialData(),
      past: [],
      finished: [],

      async startHorde(hordeId, level, overrides, survivors) {
        set({
          status: 'loading',
          loadError: null,
          pendingStart: { hordeId, level, overrides, survivors },
        });
        try {
          const def = await loadHordeDeck(hordeId);
          const settings = resolveHordeSettings(level, survivors.length, overrides);
          const startSeed = Math.floor(Math.random() * 0xffffffff) >>> 0;
          const { library, bosses, seed } = buildHordeLibrary(def, settings, startSeed);
          const board = createPlaytestState({ library, command: bosses, seed, openingHandSize: 0 });
          set({
            ...initialData(),
            status: 'idle',
            pendingStart: null,
            config: { hordeId, hordeName: def.name, level, settings, survivors },
            seed,
            survivorsLife: settings.life,
            board,
            librarySizeAtStart: library.length,
            bossesRemaining: bosses.length,
            phase: settings.setupTurns > 0 ? 'setup' : 'live',
            startedAt: Date.now(),
          });
        } catch (err) {
          set({
            status: 'error',
            loadError: err instanceof Error ? err.message : "Couldn't load that horde.",
          });
        }
      },

      retryLoad() {
        const pending = get().pendingStart;
        if (!pending) return;
        void get().startHorde(pending.hordeId, pending.level, pending.overrides, pending.survivors);
      },

      endSurvivorTurn() {
        const s = get();
        if (!s.board || s.phase !== 'setup') return;
        const past = [...s.past, captureData(s)].slice(-MAX_HORDE_UNDO);
        const nextTurn = s.survivorTurn + 1;
        const setupTurns = s.config?.settings.setupTurns ?? 0;
        set({ past, survivorTurn: nextTurn, phase: nextTurn > setupTurns ? 'live' : 'setup' });
      },

      startHordeTurn(rect) {
        const s = get();
        if (!s.board || !s.config || s.phase !== 'live') return;
        const past = [...s.past, captureData(s)].slice(-MAX_HORDE_UNDO);
        const nextHordeTurn = s.hordeTurn + 1;
        const hordeArtifacts = s.board.battlefield.filter((b) =>
          (b.card.typeLine ?? '').toLowerCase().includes('artifact')
        ).length;
        const { revealed } = planHordeTurn(
          s.board.zones.library,
          s.config.settings,
          nextHordeTurn,
          hordeArtifacts
        );

        if (revealed.length === 0) {
          // Nothing left to reveal — the horde still attacks with whatever it
          // already controls.
          set({
            past,
            hordeTurn: nextHordeTurn,
            phase: 'combat',
            pendingReveal: null,
            attackingIds: creatureIds(s.board),
            pendingAttack: attackSummary(s.board.battlefield),
          });
          return;
        }

        const { toBattlefield, toResolve } = hordeTurnActions(revealed, s.board.battlefield, rect);
        const lastNontoken = [...revealed].reverse().find((c) => !c.isToken);
        const waveEndId = lastNontoken?.id ?? revealed[revealed.length - 1]?.id ?? null;
        set({
          past,
          hordeTurn: nextHordeTurn,
          phase: 'reveal',
          pendingReveal: { revealed, toBattlefield, toResolve, waveEndId },
        });
      },

      confirmReveal() {
        const s = get();
        if (!s.board || !s.pendingReveal || s.phase !== 'reveal') return;
        const past = [...s.past, captureData(s)].slice(-MAX_HORDE_UNDO);
        let board = s.board;
        for (const action of s.pendingReveal.toBattlefield) board = applyAction(board, action);
        for (const action of resolveActions(s.pendingReveal.toResolve))
          board = applyAction(board, action);
        const outcome = hordeOutcome(board, s.survivorsLife);
        const attackingIds = outcome ? [] : creatureIds(board);
        const pendingAttack = outcome ? null : attackSummary(board.battlefield);
        set({
          past,
          board,
          phase: outcome ? 'ended' : 'combat',
          pendingReveal: null,
          attackingIds,
          pendingAttack,
          outcome,
        });
        if (outcome) {
          const record = recordFinished(get(), outcome);
          if (record) set({ finished: [record, ...get().finished].slice(0, 20) });
        }
      },

      resolveAttack(damageDealt) {
        const s = get();
        if (!s.board || !s.config || s.phase !== 'combat') return;
        const past = [...s.past, captureData(s)].slice(-MAX_HORDE_UNDO);
        const dealt = Math.max(0, Math.floor(damageDealt));
        const nextLife = Math.max(0, s.survivorsLife - dealt);
        const outcome = hordeOutcome(s.board, nextLife);
        set({
          past,
          survivorsLife: nextLife,
          damageTaken: s.damageTaken + dealt,
          attackingIds: [],
          pendingAttack: null,
          phase: outcome ? 'ended' : 'live',
          survivorTurn: s.survivorTurn + 1,
          outcome,
        });
        if (outcome) {
          const record = recordFinished(get(), outcome);
          if (record) set({ finished: [record, ...get().finished].slice(0, 20) });
        }
      },

      damageHorde(amount) {
        const s = get();
        if (!s.board || !s.config) return;
        const past = [...s.past, captureData(s)].slice(-MAX_HORDE_UNDO);
        const clamped = Math.max(0, Math.floor(amount));
        const before = s.board.zones.library.length;
        let board = applyAction(s.board, millForDamage(clamped));
        const after = board.zones.library.length;
        const movedCount = before - after;
        const milled = board.zones.graveyard.slice(board.zones.graveyard.length - movedCount);

        const crossed = bossesCrossed(
          s.librarySizeAtStart,
          before,
          after,
          s.config.settings.bossTicks
        ).filter((i) => !s.bossTicksCrossed.includes(i));
        const bossesEntered: HordeBossArrival[] = [];
        let bossesRemaining = s.bossesRemaining;
        for (const tickIndex of crossed) {
          const boss = board.zones.command[0];
          if (!boss) continue;
          const { x, y } = autoPlace(boss, board.battlefield);
          board = applyAction(board, { type: 'MOVE_TO_BATTLEFIELD', cardId: boss.id, x, y });
          bossesEntered.push({ name: boss.name, tick: s.config.settings.bossTicks[tickIndex] });
          bossesRemaining = Math.max(0, bossesRemaining - 1);
        }

        const outcome = hordeOutcome(board, s.survivorsLife);
        set({
          past,
          board,
          cardsMilledByDamage: s.cardsMilledByDamage + milled.length,
          bossTicksCrossed: [...s.bossTicksCrossed, ...crossed],
          bossesRemaining,
          lastDamageResult: { amount: clamped, before, after, milled, bossesEntered },
          outcome,
          phase: outcome ? 'ended' : s.phase,
        });
        if (outcome) {
          const record = recordFinished(get(), outcome);
          if (record) set({ finished: [record, ...get().finished].slice(0, 20) });
        }
      },

      clearLastDamageResult() {
        set({ lastDamageResult: null });
      },

      moveHordeCard(cardId, to) {
        const s = get();
        if (!s.board) return;
        const past = [...s.past, captureData(s)].slice(-MAX_HORDE_UNDO);
        const board = applyAction(s.board, {
          type: 'MOVE_TO_ZONE',
          cardId,
          to,
          toIndex: to === 'library' ? 0 : undefined,
        });
        const outcome = hordeOutcome(board, s.survivorsLife);
        set({
          past,
          board,
          attackingIds: s.attackingIds.filter((id) => id !== cardId),
          outcome,
          phase: outcome ? 'ended' : s.phase,
        });
        if (outcome) {
          const record = recordFinished(get(), outcome);
          if (record) set({ finished: [record, ...get().finished].slice(0, 20) });
        }
      },

      undo() {
        const s = get();
        const prev = s.past[s.past.length - 1];
        if (!prev) return;
        set({ ...prev, past: s.past.slice(0, -1) });
      },

      concede() {
        const s = get();
        if (!s.board || !s.config) return;
        set({ outcome: 'lost', phase: 'ended' });
        const record = recordFinished(get(), 'lost');
        if (record) set({ finished: [record, ...get().finished].slice(0, 20) });
      },

      leaveGame() {
        set({ ...initialData(), past: [] });
      },

      hideBoard() {
        set({ boardVisible: false });
      },

      showBoard() {
        set({ boardVisible: true });
      },
    }),
    {
      name: 'spellcontrol-horde-game',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // An interrupted load (reload mid-fetch) leaves no game to resume —
        // land back on setup rather than a stuck spinner.
        if (state.status === 'loading' && !state.config) {
          state.status = 'idle';
        }
      },
      // `past` (undo) and `pendingStart` (retry-only) are worth keeping across
      // a reload too — a mid-game refresh should resume exactly where it was.
      partialize: (s) => ({
        config: s.config,
        boardVisible: s.boardVisible,
        status: s.status,
        loadError: s.loadError,
        pendingStart: s.pendingStart,
        seed: s.seed,
        survivorsLife: s.survivorsLife,
        board: s.board,
        librarySizeAtStart: s.librarySizeAtStart,
        bossesRemaining: s.bossesRemaining,
        bossTicksCrossed: s.bossTicksCrossed,
        survivorTurn: s.survivorTurn,
        hordeTurn: s.hordeTurn,
        phase: s.phase,
        pendingReveal: s.pendingReveal,
        pendingAttack: s.pendingAttack,
        lastDamageResult: s.lastDamageResult,
        attackingIds: s.attackingIds,
        outcome: s.outcome,
        startedAt: s.startedAt,
        cardsMilledByDamage: s.cardsMilledByDamage,
        damageTaken: s.damageTaken,
        past: s.past,
        finished: s.finished,
      }),
    }
  )
);
