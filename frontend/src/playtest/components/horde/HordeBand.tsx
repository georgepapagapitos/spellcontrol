import { useEffect, useRef, useState, type RefObject } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { usePlaytestStore } from '@/playtest/store';
import { VARIABLE_POWER_CEILING, variablePowerCount, type AttackerGroup } from '@/lib/horde';
import type { SoloHordeState } from '@/playtest/lib/horde-solo';
import { hordeBandLine } from '@/playtest/lib/horde-view';
import { HordeFelt } from './HordeFelt';
import { HordeDamageControl } from './HordeDamageControl';
import './HordeBand.css';

interface Props {
  horde: SoloHordeState | null;
  hordeLoad: { status: 'idle' | 'loading' | 'error'; error: string | null };
  playerTurn: number;
  feltRef: RefObject<HTMLDivElement | null>;
  /** Requests the board-level card menu / damage sheet (see `HordeOverlays`
   *  for why neither renders inside this band). */
  onCardMenu(cardId: string): void;
  onOpenDamage(): void;
}

/** '' reads as 0, same rule as the damage sheet's own draft field — never
 *  NaN, always clamped to a real damage amount. */
function clampDamage(raw: string, max: number): number {
  if (raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.floor(n)));
}

/**
 * The combat total, typed into the band's bar instead of a banner floating
 * over either board (design point 2). Same clamp/prefill/Take-Skip rule as
 * the desktop `HordeAttackBanner`, in the band's own compact wording — a
 * `*`/`*` attacker (Soulless One) only clamps to a sane ceiling, never to
 * `power` (which counts it as 0), same reasoning as the banner (#2178).
 */
function CombatBar({
  power,
  groups,
  onTake,
}: {
  power: number;
  groups: readonly AttackerGroup[];
  onTake(amount: number): void;
}) {
  const [draft, setDraft] = useState(() => String(power));
  const variable = variablePowerCount(groups);
  const max = variable > 0 ? VARIABLE_POWER_CEILING : power;
  const value = clampDamage(draft, max);
  return (
    <div className="horde-band__combat">
      <span className="horde-band__combat-label">
        Attacks · {power} power{variable > 0 ? ` + ${variable} variable` : ''}
      </span>
      <label className="horde-band__combat-field">
        <span className="horde-band__combat-field-label">Damage</span>
        <input
          type="number"
          min={0}
          max={max}
          value={draft}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      <button type="button" className="btn btn-primary" onClick={() => onTake(value)}>
        {value === 0 ? 'Skip' : `Take ${value}`}
      </button>
    </div>
  );
}

/**
 * The horde folded into a one-line band above the board at <1024px
 * (STYLE_GUIDE "Horde table", solo'd): opens by itself on the horde's turn
 * and folds on yours, and the player can still toggle it. In combat the
 * damage total lives in the bar itself, so nothing floats over either board.
 */
export function HordeBand({
  horde,
  hordeLoad,
  playerTurn,
  feltRef,
  onCardMenu,
  onOpenDamage,
}: Props) {
  const resolveHordeAttack = usePlaytestStore((s) => s.resolveHordeAttack);
  const retryHordeLoad = usePlaytestStore((s) => s.retryHordeLoad);
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const prevPhase = useRef(horde?.phase ?? null);

  useEffect(() => {
    const phase = horde?.phase ?? null;
    if (prevPhase.current !== phase) {
      prevPhase.current = phase;
      // A phase change forgets any manual override — the auto default
      // (open on reveal/combat, folded on waiting) applies again, and the
      // player can still re-toggle within the new phase.
      setManualOpen(null);
    }
  }, [horde?.phase]);

  if (!horde) {
    return (
      <section className="horde-band is-open" aria-label="The horde">
        <div className="horde-band__bar">
          {hordeLoad.status === 'error' ? (
            <span className="horde-band__line">
              Couldn't load the horde.{' '}
              <button type="button" className="horde-band__retry" onClick={() => retryHordeLoad()}>
                Try again
              </button>
            </span>
          ) : (
            <span className="horde-band__line">Loading the horde…</span>
          )}
        </div>
      </section>
    );
  }

  const autoOpen = horde.phase === 'reveal' || horde.phase === 'combat';
  const open = manualOpen ?? autoOpen;
  const inCombat = horde.phase === 'combat' && horde.pendingAttack !== null;
  // A phone player needs the same way to mill the horde's library a desktop
  // player has — absent only while there's an attack total to resolve or the
  // fight is over (E387 PR 5 follow-up: the band shipped with no way to win).
  const canDamage = horde.phase !== 'combat' && horde.phase !== 'ended';

  return (
    <section className={`horde-band${open ? ' is-open' : ''}`} aria-label="The horde">
      <div className="horde-band__bar">
        {inCombat && horde.pendingAttack ? (
          <CombatBar
            power={horde.pendingAttack.power}
            groups={horde.pendingAttack.groups}
            onTake={resolveHordeAttack}
          />
        ) : (
          <>
            <button
              type="button"
              className="horde-band__toggle"
              aria-expanded={open}
              onClick={() => setManualOpen(!open)}
            >
              <span className="horde-band__line">{hordeBandLine(horde, playerTurn)}</span>
              {open ? (
                <ChevronUp width={16} height={16} aria-hidden />
              ) : (
                <ChevronDown width={16} height={16} aria-hidden />
              )}
            </button>
            {canDamage && (
              <HordeDamageControl
                libraryCount={horde.board.zones.library.length}
                graveyardCount={horde.board.zones.graveyard.length}
                onOpen={onOpenDamage}
                className="btn horde-band__damage"
                label="Damage"
                ariaLabel="Damage the horde"
              />
            )}
          </>
        )}
      </div>
      {open && (
        <div ref={feltRef} className="horde-band__field playtest-battlefield-wrap">
          <HordeFelt
            board={horde.board}
            attackingIds={horde.attackingIds}
            onCardMenu={onCardMenu}
          />
        </div>
      )}
    </section>
  );
}
