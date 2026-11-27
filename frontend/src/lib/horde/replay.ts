import { applyAction, type PlaytestCard, type PlaytestState } from '@/lib/playtest';
import type { Rect } from '@/playtest/lib/auto-place';
import type { HordeTable } from '@spellcontrol/game-core';
import type { SoloHordeConfig, SoloHordePhase, SoloHordeState } from '@/playtest/lib/horde-solo';
import { createHordeBoard, dealDueBosses } from './board';
import { buildHordeLibrary, type HordeDeckDef } from './library';
import {
  attackSummary,
  hordeOutcome,
  hordeTurnActions,
  millForDamage,
  planHordeTurn,
  resolveActions,
  type HordeBossArrival,
  type HordeDamageResult,
  type HordePendingAttack,
  type HordeReveal,
} from './turn';

/**
 * Rebuilds the same horde board every device sees, by replaying an online
 * co-op table's step log through the frontend's horde engine. Pure and
 * deterministic: `def`/`table`/`sharedLife` in, the same `HordeReplay` out —
 * no `Date`, no RNG beyond the seed carried in `table`, no store access.
 */
export interface HordeReplay {
  /** The shape HordeHalf/HordeBand/HordeOverlays already render. */
  view: SoloHordeState;
  /** hordeOutcome(view.board, sharedLife): 'won' once the library is empty and
   *  the horde controls no creatures; 'lost' at 0 life. */
  outcome: 'won' | 'lost' | null;
  /** The most recent `damage` step's result (for the damage sheet of the
   *  survivor who dealt it), or null when the log has none. */
  lastDamage: { stepIndex: number; seat: number; result: HordeDamageResult } | null;
  /** Bosses that entered on the most recent step, if any (a damage step or a
   *  confirm). For announcing arrivals to the table. */
  lastArrivals: { stepIndex: number; seat: number; bosses: HordeBossArrival[] } | null;
  /** While a reveal waits: confirming it would leave the horde no creature to
   *  attack with and the game still on, so the confirming device sends
   *  `{ k: 'confirm', pass: true }` and the turn passes without a combat stop
   *  (E1037). Always false outside the reveal. */
  confirmPasses: boolean;
  /** The last horde turn's confirm left nothing to attack with. Cleared by
   *  the next reveal (or a real hit); only the status line reads it. */
  nothingAttacked: boolean;
}

function isCreature(card: PlaytestCard): boolean {
  return (card.typeLine ?? '').toLowerCase().includes('creature');
}

function creatureIds(board: PlaytestState): string[] {
  return board.battlefield.filter((b) => isCreature(b.card)).map((b) => b.card.id);
}

/** Artifact permanents the horde controls, the same count every horde-turn
 *  planner already feeds into `planHordeTurn`'s `plusPerArtifact` bump. */
function artifactCount(board: PlaytestState): number {
  return board.battlefield.filter((b) => (b.card.typeLine ?? '').toLowerCase().includes('artifact'))
    .length;
}

/** What a `confirm` does to the board: the reveal lands, then any boss the
 *  library's new size calls for enters. */
function landReveal(
  board: PlaytestState,
  reveal: HordeReveal | null,
  librarySizeAtStart: number,
  bossTicks: number[],
  crossed: number[],
  rect: Rect | null | undefined
) {
  let next = board;
  if (reveal) {
    for (const action of reveal.toBattlefield) next = applyAction(next, action);
    for (const action of resolveActions(reveal.toResolve)) next = applyAction(next, action);
  }
  return dealDueBosses(next, librarySizeAtStart, bossTicks, crossed, rect);
}

const PHASE_MAP: Record<HordeTable['phase'], SoloHordePhase> = {
  survivors: 'waiting',
  reveal: 'reveal',
  combat: 'combat',
};

export function replayHorde(
  def: HordeDeckDef,
  table: HordeTable,
  sharedLife: number,
  rect?: Rect | null
): HordeReplay {
  const built = buildHordeLibrary(def, table.settings, table.seed);
  let board = createHordeBoard(built.library, built.bosses, built.seed);
  const librarySizeAtStart = built.library.length;
  let bossTicksCrossed: number[] = [];

  let hordeTurn = 0;
  let pendingReveal: HordeReveal | null = null;
  let pendingAttack: HordePendingAttack | null = null;
  let attackingIds: string[] = [];
  let damageTaken = 0;
  let cardsMilledByDamage = 0;
  let lastDamage: HordeReplay['lastDamage'] = null;
  let lastArrivals: HordeReplay['lastArrivals'] = null;
  let nothingAttacked = false;

  table.steps.forEach((entry, stepIndex) => {
    switch (entry.k) {
      case 'reveal': {
        hordeTurn += 1;
        const hordeArtifacts = artifactCount(board);
        const { revealed } = planHordeTurn(
          board.zones.library,
          table.settings,
          hordeTurn,
          hordeArtifacts
        );
        const { toBattlefield, toResolve } = hordeTurnActions(revealed, board.battlefield, rect);
        const lastNontoken = [...revealed].reverse().find((c) => !c.isToken);
        const waveEndId = lastNontoken?.id ?? revealed[revealed.length - 1]?.id ?? null;
        pendingReveal = { revealed, toBattlefield, toResolve, waveEndId };
        nothingAttacked = false;
        break;
      }
      case 'confirm': {
        const dealt = landReveal(
          board,
          pendingReveal,
          librarySizeAtStart,
          table.settings.bossTicks,
          bossTicksCrossed,
          rect
        );
        board = dealt.board;
        bossTicksCrossed = dealt.crossed;
        if (dealt.bossesEntered.length > 0) {
          lastArrivals = { stepIndex, seat: entry.seat, bosses: dealt.bossesEntered };
        }
        pendingReveal = null;
        attackingIds = creatureIds(board);
        pendingAttack = attackSummary(board.battlefield);
        nothingAttacked = attackingIds.length === 0;
        break;
      }
      case 'take': {
        attackingIds = [];
        pendingAttack = null;
        damageTaken += entry.dealt;
        if (entry.dealt > 0) nothingAttacked = false;
        break;
      }
      case 'damage': {
        const before = board.zones.library.length;
        board = applyAction(board, millForDamage(entry.n));
        const after = board.zones.library.length;
        const movedCount = before - after;
        const milled = board.zones.graveyard.slice(board.zones.graveyard.length - movedCount);
        const dealt = dealDueBosses(
          board,
          librarySizeAtStart,
          table.settings.bossTicks,
          bossTicksCrossed,
          rect
        );
        board = dealt.board;
        bossTicksCrossed = dealt.crossed;
        cardsMilledByDamage += milled.length;
        const result: HordeDamageResult = {
          amount: entry.n,
          before,
          after,
          milled,
          bossesEntered: dealt.bossesEntered,
        };
        lastDamage = { stepIndex, seat: entry.seat, result };
        if (dealt.bossesEntered.length > 0) {
          lastArrivals = { stepIndex, seat: entry.seat, bosses: dealt.bossesEntered };
        }
        break;
      }
      case 'move': {
        board = applyAction(board, {
          type: 'MOVE_TO_ZONE',
          cardId: entry.cardId,
          to: entry.to,
          toIndex: entry.to === 'library' ? 0 : undefined,
        });
        break;
      }
    }
  });

  const outcome = hordeOutcome(board, sharedLife);

  // The same landing the confirm case runs, looked ahead without logging it:
  // the paper table's rule for passing (no creature, no outcome), so every
  // device agrees on it from the same log.
  let confirmPasses = false;
  // Cast: the forEach above assigns it, which control-flow narrowing can't see.
  const waiting = pendingReveal as HordeReveal | null;
  if (table.phase === 'reveal' && waiting && outcome === null) {
    const landed = landReveal(
      board,
      waiting,
      librarySizeAtStart,
      table.settings.bossTicks,
      bossTicksCrossed,
      rect
    );
    confirmPasses =
      creatureIds(landed.board).length === 0 && hordeOutcome(landed.board, sharedLife) === null;
  }
  const phase: SoloHordePhase = outcome !== null ? 'ended' : PHASE_MAP[table.phase];

  const config: SoloHordeConfig = {
    hordeId: table.hordeId,
    hordeName: def.name,
    level: table.level,
    overrides: {},
    settings: table.settings,
  };

  const view: SoloHordeState = {
    config,
    board,
    librarySizeAtStart,
    bossTicksCrossed,
    armedAtTurn: 1,
    hordeTurn: table.hordeTurn,
    phase,
    pendingReveal,
    pendingAttack,
    attackingIds,
    lastDamageResult: null,
    outcome,
    damageTaken,
    cardsMilledByDamage,
  };

  return { view, outcome, lastDamage, lastArrivals, confirmPasses, nothingAttacked };
}
