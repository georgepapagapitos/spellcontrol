import { useState, type RefObject } from 'react';
import '@/styles/horde-table.css';
// `HordeDamageSheet` reuses the Local setup form's `.play-stepper` shell
// around its own input — an explicit import so the playtest page chunks
// that mount this half actually load that stylesheet too (see
// css-chunk-ownership.test.ts).
import '@/styles/play-setup.css';
import { MeterBar } from '@/components/shared/MeterBar';
import { ZonePile } from '@/playtest/components/ZonePile';
import { HordeDamageSheet } from '@/components/play/horde/HordeDamageSheet';
import { usePlaytestStore } from '@/playtest/store';
import type { SoloHordeState } from '@/playtest/lib/horde-solo';
import {
  cardsUntilNextBoss,
  hordeLevelLabel,
  hordeStatusText,
  measureHordeRect,
} from '@/playtest/lib/horde-view';
import { HordeFelt } from './HordeFelt';
import './HordeHalf.css';

interface Props {
  horde: SoloHordeState | null;
  hordeLoad: { status: 'idle' | 'loading' | 'error'; error: string | null };
  playerTurn: number;
  feltRef: RefObject<HTMLDivElement | null>;
}

/**
 * The horde's half of the felt at >=1024px (STYLE_GUIDE "Horde table",
 * solo'd): the paper table's own status/corner/action chrome and its real
 * `Battlefield`, fixed to exactly half the board's height, on top. Reuses
 * every class the paper `HordeTable` already defines in horde-table.css.
 */
export function HordeHalf({ horde, hordeLoad, playerTurn, feltRef }: Props) {
  const damageHorde = usePlaytestStore((s) => s.damageHorde);
  const clearHordeDamageResult = usePlaytestStore((s) => s.clearHordeDamageResult);
  const retryHordeLoad = usePlaytestStore((s) => s.retryHordeLoad);
  const [damageSheetOpen, setDamageSheetOpen] = useState(false);

  if (!horde) {
    return (
      <div ref={feltRef} className="horde-half horde-half--loading playtest-battlefield-wrap">
        {hordeLoad.status === 'error' ? (
          <p className="horde-half-message">
            {hordeLoad.error ?? "Couldn't load the horde."}{' '}
            <button type="button" className="btn" onClick={() => retryHordeLoad()}>
              Try again
            </button>
          </p>
        ) : (
          <p className="horde-half-message">Loading the horde…</p>
        )}
      </div>
    );
  }

  const { board, config, bossTicksCrossed, librarySizeAtStart, attackingIds, lastDamageResult } =
    horde;
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
          {hordeLevelLabel(config.level)} · {hordeStatusText(horde, playerTurn)}
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

      <HordeFelt board={board} attackingIds={attackingIds} />

      {horde.phase !== 'ended' && (
        <div className="horde-table-actions">
          <button
            type="button"
            className="btn"
            onClick={() => setDamageSheetOpen(true)}
            disabled={board.zones.library.length === 0 && board.zones.graveyard.length === 0}
          >
            Damage the horde
          </button>
        </div>
      )}

      {damageSheetOpen && (
        <HordeDamageSheet
          libraryCount={board.zones.library.length}
          result={lastDamageResult}
          onConfirm={(amount) =>
            damageHorde(amount, feltRef.current ? measureHordeRect(feltRef.current) : null)
          }
          onDone={() => {
            clearHordeDamageResult();
            setDamageSheetOpen(false);
          }}
          onClose={() => setDamageSheetOpen(false)}
        />
      )}
    </div>
  );
}
