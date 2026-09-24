import { useState } from 'react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { Stepper } from '../SetupControls';
import { PlaytestCardFace } from '@/playtest/components/PlaytestCardFace';
import type { HordeDamageResult } from '@/store/horde-game';
import './horde-sheets.css';

interface Props {
  libraryCount: number;
  /** Set once `onConfirm` has applied the mill — the sheet switches to
   *  showing what came off the top (and any boss that joined). */
  result: HordeDamageResult | null;
  onConfirm(amount: number): void;
  onDone(): void;
  onClose(): void;
}

/** The banner's opening clause, derived from the crossed `bossTicks`
 *  fraction rather than hard-coded to "Half" — Casual/Standard/Brutal (and
 *  any Customise override) can cross a quarter, three quarters, or the
 *  library emptying outright. */
function bossTickPhrase(tick: number): string {
  if (tick >= 1) return "The horde's library is empty.";
  if (tick === 0.75) return 'Three quarters of the horde is gone.';
  if (tick === 0.5) return 'Half the horde is gone.';
  if (tick === 0.25) return 'A quarter of the horde is gone.';
  return `${Math.round(tick * 100)}% of the horde is gone.`;
}

/**
 * Damage the horde (design point 5): a stepper, a live "Mills N. Library
 * X → Y." preview, then — after confirming — the milled cards and any boss
 * banner the tick crossed.
 */
export function HordeDamageSheet({ libraryCount, result, onConfirm, onDone, onClose }: Props) {
  const [amount, setAmount] = useState(1);
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(result ? onDone : onClose);
  useLockBodyScroll();
  useEscapeKey(() => beginClose());

  const clamped = Math.min(amount, libraryCount);
  const after = Math.max(0, libraryCount - clamped);

  return (
    <div className="card-picker-root">
      <div
        className="card-picker-backdrop"
        role="presentation"
        onClick={() => (result ? undefined : beginClose())}
      />
      <div
        className={`card-picker-sheet horde-damage-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Damage the horde"
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">Damage the horde</h2>
        </div>
        <div className="card-picker-list horde-damage-body">
          {!result ? (
            <>
              <Stepper
                value={amount}
                min={0}
                max={libraryCount}
                ariaLabelledBy="horde-damage-amount-label"
                onChange={setAmount}
              />
              <p id="horde-damage-amount-label">
                Mills {clamped}. Library {libraryCount} → {after}.
              </p>
            </>
          ) : (
            <>
              {result.bossesEntered.map((boss) => (
                <p key={boss.name} className="horde-damage-boss-banner" role="status">
                  {bossTickPhrase(boss.tick)} {boss.name} joins the battlefield.
                </p>
              ))}
              {result.milled.length > 0 ? (
                <>
                  <p className="horde-damage-milled-heading">Milled {result.milled.length}.</p>
                  <ul className="horde-damage-milled">
                    {result.milled.map((card) => (
                      <li key={card.id}>
                        <PlaytestCardFace card={card} size="sm" />
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>The library was already empty.</p>
              )}
            </>
          )}
        </div>
        <div className="card-picker-footer">
          {!result ? (
            <>
              <button type="button" className="btn" onClick={() => beginClose()}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => onConfirm(amount)}>
                Confirm
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => beginClose()}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
