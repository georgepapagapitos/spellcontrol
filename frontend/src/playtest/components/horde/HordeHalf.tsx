import type { RefObject } from 'react';
import '@/styles/horde-table.css';
import { MeterBar } from '@/components/shared/MeterBar';
import { ZonePile } from '@/playtest/components/ZonePile';
import type { SoloHordeState } from '@/playtest/lib/horde-solo';
import { cardsUntilNextBoss, hordeLevelLabel, hordeStatusText } from '@/playtest/lib/horde-view';
import { useHordeActions } from './horde-actions';
import { HordeFelt } from './HordeFelt';
import { HordeDamageControl } from './HordeDamageControl';
import './HordeHalf.css';
import { Button } from '@/components/shared/Button';

interface Props {
  horde: SoloHordeState | null;
  hordeLoad: { status: 'idle' | 'loading' | 'error'; error: string | null };
  playerTurn: number;
  feltRef: RefObject<HTMLDivElement | null>;
  /** Requests the board-level card menu / damage sheet (see `HordeOverlays`
   *  for why neither renders inside this half). */
  onCardMenu(cardId: string): void;
  onOpenDamage(): void;
  /** Replaces the status line's "· <status>" half — an online table's own
   *  team-turn/waiting-on wording instead of the solo `hordeStatusText`. */
  statusText?: string;
  /** Replaces the felt with a message + button (same markup as the
   *  load-error state) — an online table's app-version skew. */
  blocked?: { message: string; actionLabel: string; onAction(): void };
  /** Hides "Damage the horde" and stops card taps — a spectator's view. */
  readOnly?: boolean;
}

/**
 * The horde's half of the felt at >=1024px (STYLE_GUIDE "Horde table",
 * solo'd): the paper table's own status/corner/action chrome and its real
 * `Battlefield`, fixed to exactly half the board's height, on top. Reuses
 * every class the paper `HordeTable` already defines in horde-table.css.
 */
export function HordeHalf({
  horde,
  hordeLoad,
  playerTurn,
  feltRef,
  onCardMenu,
  onOpenDamage,
  statusText,
  blocked,
  readOnly,
}: Props) {
  const { retryLoad } = useHordeActions();

  if (blocked) {
    return (
      <div ref={feltRef} className="horde-half horde-half--loading playtest-battlefield-wrap">
        <p className="horde-half-message">
          {blocked.message} <Button onClick={blocked.onAction}>{blocked.actionLabel}</Button>
        </p>
      </div>
    );
  }

  if (!horde) {
    return (
      <div ref={feltRef} className="horde-half horde-half--loading playtest-battlefield-wrap">
        {hordeLoad.status === 'error' ? (
          <p className="horde-half-message">
            {hordeLoad.error ?? "Couldn't load the horde."}{' '}
            <button type="button" className="btn" onClick={() => retryLoad()}>
              Try again
            </button>
          </p>
        ) : (
          <p className="horde-half-message">Loading the horde…</p>
        )}
      </div>
    );
  }

  const { board, config, bossTicksCrossed, librarySizeAtStart, attackingIds } = horde;
  const libraryRemaining = board.zones.library.length;
  const nextBossIn = cardsUntilNextBoss(
    librarySizeAtStart,
    libraryRemaining,
    config.settings.bossTicks,
    bossTicksCrossed
  );

  return (
    <div ref={feltRef} className="horde-half playtest-battlefield-wrap">
      <div className="horde-table-status">
        <span className="horde-table-status-name">{config.hordeName}</span>
        <span className="horde-table-status-line">
          {hordeLevelLabel(config.level)} · {statusText ?? hordeStatusText(horde, playerTurn)}
        </span>
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

      <HordeFelt
        board={board}
        attackingIds={attackingIds}
        onCardMenu={readOnly ? () => {} : onCardMenu}
      />

      {horde.phase !== 'ended' && !readOnly && (
        <div className="horde-table-actions">
          <HordeDamageControl
            libraryCount={board.zones.library.length}
            graveyardCount={board.zones.graveyard.length}
            onOpen={onOpenDamage}
            className="btn"
            label="Damage the horde"
          />
        </div>
      )}
    </div>
  );
}
