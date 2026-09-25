import { applyAction, type PlaytestCard, type PlaytestState } from '@/lib/playtest';
import type { Rect } from '@/playtest/lib/auto-place';
import type { HordeTable } from '@/lib/game-state';
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
        break;
      }
      case 'confirm': {
        const reveal = pendingReveal;
        if (reveal) {
          for (const action of reveal.toBattlefield) board = applyAction(board, action);
          for (const action of resolveActions(reveal.toResolve)) board = applyAction(board, action);
        }
        const dealt = dealDueBosses(
          board,
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
        break;
      }
      case 'take': {
        attackingIds = [];
        pendingAttack = null;
        damageTaken += entry.dealt;
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

  return { view, outcome, lastDamage, lastArrivals };
}
