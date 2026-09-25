import { useEffect, useRef, useState } from 'react';
import { DndContext } from '@dnd-kit/core';
import { Minimize2 } from 'lucide-react';
import '@/styles/playtest.css';
import '@/styles/horde-table.css';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useMediaQuery } from '@/lib/use-media-query';
import { OverflowMenu } from '@/components/OverflowMenu';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Modal } from '@/components/Modal';
import { LifeStrip } from '@/playtest/components/LifeStrip';
import { ZonePile } from '@/playtest/components/ZonePile';
import { Battlefield } from '@/playtest/components/Battlefield';
import { MeterBar } from '@/components/shared/MeterBar';
import { RotatePrompt } from '@/playtest/components/RotatePrompt';
import type { Rect } from '@/playtest/lib/auto-place';
import { useHordeGameStore } from '@/store/horde-game';
import { HordeRevealSheet } from './HordeRevealSheet';
import { HordeAttackBanner } from './HordeAttackBanner';
import { HordeDamageSheet } from './HordeDamageSheet';
import { HordeEndSheet } from './HordeEndSheet';
import { HordeCardMenu } from './HordeCardMenu';

const EMPTY_SET: ReadonlySet<string> = new Set();

/** A tablet in portrait, same gate as `RotatePrompt`'s phone one but wider —
 *  the table's corner chrome is built landscape-first (design point 3). */
const PORTRAIT_TABLET = '(orientation: portrait) and (min-width: 768px) and (pointer: coarse)';

function levelLabel(level: string): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

/** How many cards still need to leave the library before the next
 *  not-yet-crossed `bossTicks` fraction fires (design point 3's "next boss
 *  in N"). `null` once every tick is crossed (or the horde has none). */
function cardsUntilNextBoss(
  librarySizeAtStart: number,
  remaining: number,
  bossTicks: readonly number[],
  crossed: readonly number[]
): number | null {
  const nextIndex = bossTicks.findIndex((_, i) => !crossed.includes(i));
  if (nextIndex === -1) return null;
  const nextRemaining = Math.ceil(librarySizeAtStart * (1 - bossTicks[nextIndex]));
  return Math.max(0, remaining - nextRemaining);
}

/** Reads the live battlefield box for `autoPlace`: the felt's pixel size plus
 *  the card box the CSS density var currently resolves to. Reserved
 *  fractions are ponytail-level constants (the horde table's own corner
 *  chrome, not the main board's) rather than a measured value — good enough
 *  for keeping a fresh permanent out from under the status/action clusters. */
function measureRect(el: HTMLElement): Rect {
  const box = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const cardW = parseFloat(style.getPropertyValue('--pt-card-w'));
  const cardH = parseFloat(style.getPropertyValue('--pt-card-h'));
  return {
    width: box.width,
    height: box.height,
    cardW: Number.isFinite(cardW) && cardW > 0 ? cardW : undefined,
    cardH: Number.isFinite(cardH) && cardH > 0 ? cardH : undefined,
    reservedTop: 0.18,
    reservedBottom: 0.24,
  };
}

/**
 * The full-screen Local Horde table (design points 3-6): survivors' shared
 * life, the horde's status, its library/graveyard, its real battlefield, and
 * the two actions that run its turn and take damage off its library.
 */
export function HordeTable() {
  const config = useHordeGameStore((s) => s.config);
  const board = useHordeGameStore((s) => s.board);
  const survivorsLife = useHordeGameStore((s) => s.survivorsLife);
  const librarySizeAtStart = useHordeGameStore((s) => s.librarySizeAtStart);
  const survivorTurn = useHordeGameStore((s) => s.survivorTurn);
  const hordeTurn = useHordeGameStore((s) => s.hordeTurn);
  const phase = useHordeGameStore((s) => s.phase);
  const pendingReveal = useHordeGameStore((s) => s.pendingReveal);
  const pendingAttack = useHordeGameStore((s) => s.pendingAttack);
  const lastDamageResult = useHordeGameStore((s) => s.lastDamageResult);
  const attackingIds = useHordeGameStore((s) => s.attackingIds);
  const outcome = useHordeGameStore((s) => s.outcome);
  const damageTaken = useHordeGameStore((s) => s.damageTaken);
  const cardsMilledByDamage = useHordeGameStore((s) => s.cardsMilledByDamage);
  const undoCount = useHordeGameStore((s) => s.past.length);
  const bossTicksCrossed = useHordeGameStore((s) => s.bossTicksCrossed);

  const endSurvivorTurn = useHordeGameStore((s) => s.endSurvivorTurn);
  const startHordeTurn = useHordeGameStore((s) => s.startHordeTurn);
  const confirmReveal = useHordeGameStore((s) => s.confirmReveal);
  const resolveAttack = useHordeGameStore((s) => s.resolveAttack);
  const damageHorde = useHordeGameStore((s) => s.damageHorde);
  const clearLastDamageResult = useHordeGameStore((s) => s.clearLastDamageResult);
  const moveHordeCard = useHordeGameStore((s) => s.moveHordeCard);
  const undo = useHordeGameStore((s) => s.undo);
  const concede = useHordeGameStore((s) => s.concede);
  const leaveGame = useHordeGameStore((s) => s.leaveGame);
  const hideBoard = useHordeGameStore((s) => s.hideBoard);

  useLockBodyScroll();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [damageSheetOpen, setDamageSheetOpen] = useState(false);
  const [cardMenuId, setCardMenuId] = useState<string | null>(null);
  const [pendingLeave, setPendingLeave] = useState<'discard' | 'end' | null>(null);
  const [portraitSkipped, setPortraitSkipped] = useState(false);
  const isPortraitTablet = useMediaQuery(PORTRAIT_TABLET);

  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== 'undefined' && document.fullscreenElement !== null
  );
  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  if (!config || !board) return null;

  const menuCard = cardMenuId
    ? board.battlefield.find((b) => b.card.id === cardMenuId)?.card
    : null;

  function statusLine(): string {
    if (phase === 'setup')
      return `survivors' turn ${survivorTurn} of ${config!.settings.setupTurns} setup`;
    if (phase === 'live') return `horde turn ${hordeTurn + 1} next`;
    if (phase === 'reveal') return 'the horde reveals';
    if (phase === 'combat') return 'the horde attacks';
    return outcome === 'won' ? 'the horde is gone' : 'overrun';
  }

  function handleHordeTurn() {
    const rect = wrapRef.current ? measureRect(wrapRef.current) : undefined;
    startHordeTurn(rect);
  }

  const bossesBeaten = board.zones.graveyard.filter((c) => c.id.startsWith('horde-boss-')).length;
  const libraryRemaining = board.zones.library.length;
  const nextBossIn = cardsUntilNextBoss(
    librarySizeAtStart,
    libraryRemaining,
    config.settings.bossTicks,
    bossTicksCrossed
  );

  if (isPortraitTablet && !portraitSkipped) {
    return (
      <div className="horde-table-page">
        <Modal onClose={() => setPortraitSkipped(true)} labelledBy="horde-rotate-title">
          <h2 id="horde-rotate-title">Turn your tablet sideways</h2>
          <p>The horde's table needs the width.</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setPortraitSkipped(true)}
          >
            Continue anyway
          </button>
        </Modal>
      </div>
    );
  }

  return (
    <div className="horde-table-page">
      <RotatePrompt fullscreen={isFullscreen} />
      <div ref={wrapRef} className="horde-table-wrap playtest-battlefield-wrap">
        <div className="horde-table-life">
          <span className="horde-table-life-label">Survivors · {config.survivors.length}</span>
          <LifeStrip
            life={survivorsLife}
            isNarrow={false}
            monarch={false}
            initiative={false}
            citysBlessing={false}
            playerCounters={{}}
            onAdjustLife={(delta) => {
              // A direct life edit outside a resolved attack — reuse resolveAttack's
              // math by folding it into the next attack step would be wrong here
              // (there's no attack in progress), so this is its own tiny store write.
              useHordeGameStore.setState((s) => ({
                survivorsLife: Math.max(0, s.survivorsLife + delta),
              }));
            }}
            onAdjustCounter={() => {}}
            onlineTable={null}
            variant="table"
          />
        </div>

        <div className="horde-table-status">
          <span className="horde-table-status-name">{config.hordeName}</span>
          <span className="horde-table-status-line">
            {levelLabel(config.level)} · {statusLine()}
          </span>
          {phase === 'setup' && (
            <button type="button" className="horde-table-next-turn" onClick={endSurvivorTurn}>
              Next turn
            </button>
          )}
        </div>

        <div className="horde-table-corner">
          <div className="horde-table-corner-top">
            <div className="horde-table-meter-block">
              <span className="horde-table-meter-label">
                Horde library · {libraryRemaining} / {librarySizeAtStart}
              </span>
              <div className="horde-table-meter-wrap">
                <MeterBar
                  className="horde-table-meter"
                  value={libraryRemaining}
                  max={librarySizeAtStart}
                />
                {config.settings.bossTicks.map((tick, i) => (
                  <span
                    key={tick}
                    className={`horde-table-meter-tick${bossTicksCrossed.includes(i) ? ' is-crossed' : ''}`}
                    style={{ left: `${(1 - tick) * 100}%` }}
                    aria-hidden
                  />
                ))}
              </div>
              {nextBossIn != null && (
                <span className="horde-table-meter-next">Next boss in {nextBossIn}</span>
              )}
            </div>
            <button
              type="button"
              className="overflow-menu-trigger"
              aria-label="Minimize the table"
              title="Minimize the table"
              onClick={hideBoard}
            >
              <Minimize2 width={16} height={16} strokeWidth={2} aria-hidden />
            </button>
            <OverflowMenu
              ariaLabel="Horde game menu"
              items={[
                { label: 'Undo', onClick: undo, disabled: undoCount === 0 },
                ...(phase !== 'ended'
                  ? [{ label: 'End game', onClick: () => setPendingLeave('end'), danger: true }]
                  : []),
                {
                  label: 'Leave the table',
                  onClick: () => (phase === 'ended' ? leaveGame() : setPendingLeave('discard')),
                },
              ]}
            />
          </div>
          <div className="horde-table-piles">
            <ZonePile
              zone="library"
              label="Library"
              cards={board.zones.library}
              click={{ label: 'Horde library', onClick: () => {}, disabled: true }}
              onMenu={() => {}}
            />
            <ZonePile
              zone="graveyard"
              label="Graveyard"
              cards={board.zones.graveyard}
              click={{ label: 'View graveyard', onClick: () => {}, disabled: true }}
              onMenu={() => {}}
            />
          </div>
        </div>

        <DndContext>
          <Battlefield
            cards={board.battlefield}
            selectedIds={EMPTY_SET}
            stackIds={EMPTY_SET}
            attackingIds={new Set(attackingIds)}
            dropId="horde-battlefield"
            cardsDraggable={false}
            onBackgroundClick={() => {}}
            onCardClick={(cardId) => setCardMenuId(cardId)}
            onCardContextMenu={(cardId, e) => {
              e.preventDefault();
              setCardMenuId(cardId);
            }}
            onCardLongPress={(cardId) => setCardMenuId(cardId)}
          />
        </DndContext>

        <div className="horde-table-actions">
          <button
            type="button"
            className="btn"
            onClick={() => setDamageSheetOpen(true)}
            disabled={board.zones.library.length === 0 && board.zones.graveyard.length === 0}
          >
            Damage the horde
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleHordeTurn}
            disabled={phase !== 'live'}
          >
            {phase === 'setup'
              ? `Horde arrives after turn ${config.settings.setupTurns}`
              : 'Horde turn'}
          </button>
        </div>

        {pendingAttack && phase === 'combat' && (
          <HordeAttackBanner
            attackers={pendingAttack.attackers}
            power={pendingAttack.power}
            groups={pendingAttack.groups}
            onTake={resolveAttack}
          />
        )}
      </div>

      {pendingReveal && (
        <HordeRevealSheet
          revealed={pendingReveal.revealed}
          toResolveIds={new Set(pendingReveal.toResolve.map((c) => c.id))}
          waveEndId={pendingReveal.waveEndId}
          onConfirm={confirmReveal}
        />
      )}

      {damageSheetOpen && (
        <HordeDamageSheet
          libraryCount={board.zones.library.length}
          result={lastDamageResult}
          onConfirm={damageHorde}
          onDone={() => {
            clearLastDamageResult();
            setDamageSheetOpen(false);
          }}
          onClose={() => setDamageSheetOpen(false)}
        />
      )}

      {menuCard && (
        <HordeCardMenu
          card={menuCard}
          onMove={(to) => moveHordeCard(menuCard.id, to)}
          onClose={() => setCardMenuId(null)}
        />
      )}

      {outcome && (
        <HordeEndSheet
          outcome={outcome}
          hordeId={config.hordeId}
          hordeTurns={hordeTurn}
          damageTaken={damageTaken}
          cardsMilledByDamage={cardsMilledByDamage}
          bossesBeaten={bossesBeaten}
          onPlayAgain={leaveGame}
          onDone={leaveGame}
        />
      )}

      {pendingLeave && (
        <ConfirmDialog
          title={pendingLeave === 'end' ? 'End this game?' : 'Discard this game?'}
          body={
            pendingLeave === 'end'
              ? "Ends the game as a loss. This can't be undone."
              : 'The current game will be removed without saving to history.'
          }
          confirmLabel={pendingLeave === 'end' ? 'End game' : 'Discard'}
          danger
          onConfirm={() => {
            if (pendingLeave === 'end') concede();
            else leaveGame();
            setPendingLeave(null);
          }}
          onCancel={() => setPendingLeave(null)}
        />
      )}
    </div>
  );
}
