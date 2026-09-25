import { useEffect, useRef, useState, type RefObject } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { VARIABLE_POWER_CEILING, variablePowerCount, type AttackerGroup } from '@/lib/horde';
import type { SoloHordeState } from '@/playtest/lib/horde-solo';
import { hordeBandLine } from '@/playtest/lib/horde-view';
import { useHordeActions } from './horde-actions';
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
  /** Replaces the folded line's setup-case wording — an online table's own
   *  team-turn/waiting-on status. */
  statusText?: string;
  /** Replaces the field with a message + button (same markup as the
   *  load-error state) — an online table's app-version skew. */
  blocked?: { message: string; actionLabel: string; onAction(): void };
  /** Hides Damage and stops card taps — a spectator's view. */
  readOnly?: boolean;
  /** A bar button beside Damage — an online table's "Go now" (start without
   *  the rest of the team). */
  extraAction?: { label: string; ariaLabel: string; onClick(): void };
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
  statusText,
  blocked,
  readOnly,
  extraAction,
}: Props) {
  const { take, retryLoad } = useHordeActions();
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

  if (blocked) {
    return (
      <section className="horde-band is-open" aria-label="The horde">
        <div className="horde-band__bar">
          <span className="horde-band__line">
            {blocked.message}{' '}
            <button type="button" className="horde-band__retry" onClick={blocked.onAction}>
              {blocked.actionLabel}
            </button>
          </span>
        </div>
      </section>
    );
  }

  if (!horde) {
    return (
      <section className="horde-band is-open" aria-label="The horde">
        <div className="horde-band__bar">
          {hordeLoad.status === 'error' ? (
            <span className="horde-band__line">
              Couldn't load the horde.{' '}
              <button type="button" className="horde-band__retry" onClick={() => retryLoad()}>
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
  const canDamage = horde.phase !== 'combat' && horde.phase !== 'ended' && !readOnly;

  return (
    <section className={`horde-band${open ? ' is-open' : ''}`} aria-label="The horde">
      <div className="horde-band__bar">
        {inCombat && horde.pendingAttack ? (
          <CombatBar
            power={horde.pendingAttack.power}
            groups={horde.pendingAttack.groups}
            onTake={take}
          />
        ) : (
          <>
            <button
              type="button"
              className="horde-band__toggle"
              aria-expanded={open}
              onClick={() => setManualOpen(!open)}
            >
              <span className="horde-band__line">
                {statusText ?? hordeBandLine(horde, playerTurn)}
              </span>
              {open ? (
                <ChevronUp width={16} height={16} aria-hidden />
              ) : (
                <ChevronDown width={16} height={16} aria-hidden />
              )}
            </button>
            {extraAction && (
              <button
                type="button"
                className="btn horde-band__damage"
                aria-label={extraAction.ariaLabel}
                onClick={extraAction.onClick}
              >
                {extraAction.label}
              </button>
            )}
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
            onCardMenu={readOnly ? () => {} : onCardMenu}
          />
        </div>
      )}
    </section>
  );
}
