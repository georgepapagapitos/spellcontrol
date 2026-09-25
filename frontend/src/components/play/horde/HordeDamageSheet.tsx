import { useState } from 'react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { usePressRepeat } from '@/lib/use-press-repeat';
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

/** '' reads as 0 (the field mid-clear, between a select-all and a fresh
 *  digit) — never NaN, and always clamped to a real mill amount. */
function clampDraft(raw: string, max: number): number {
  if (raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.floor(n)));
}

/**
 * Damage the horde (design point 5): a typeable amount (with −/+ nudges) and
 * a live "Mills N. Library X → Y." preview, then — after confirming — the
 * milled cards and any boss banner the tick crossed. A real Horde hit is
 * often 14 or 33 damage — a ±1-only stepper meant that many taps, so the
 * field is typed into directly, same as the table's life total.
 */
export function HordeDamageSheet({ libraryCount, result, onConfirm, onDone, onClose }: Props) {
  const [draft, setDraft] = useState(() => String(Math.min(1, libraryCount)));
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(result ? onDone : onClose);
  useLockBodyScroll();
  useEscapeKey(() => beginClose());

  const clamped = clampDraft(draft, libraryCount);
  const after = Math.max(0, libraryCount - clamped);

  // The functional updater form, not a value snapshotted from `draft` —
  // several rapid ticks of a held stepper button can fire before React gets
  // a chance to re-render in between (they did, under a fake-timer burst in
  // the test for this), and a closure over `draft` would apply the same
  // stale step that many times instead of accumulating.
  function stepBy(delta: number) {
    setDraft((prev) =>
      String(Math.max(0, Math.min(libraryCount, clampDraft(prev, libraryCount) + delta)))
    );
  }

  const decRepeat = usePressRepeat(() => stepBy(-1));
  const incRepeat = usePressRepeat(() => stepBy(1));

  function confirm() {
    onConfirm(clamped);
  }

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
              <div className="horde-damage-stepper">
                <label htmlFor="horde-damage-amount">Damage</label>
                <div className="play-stepper">
                  <button
                    type="button"
                    className="play-stepper-btn"
                    aria-label="Decrease"
                    disabled={clamped <= 0}
                    {...decRepeat}
                  >
                    −
                  </button>
                  <input
                    id="horde-damage-amount"
                    className="horde-damage-amount-input"
                    type="text"
                    inputMode="numeric"
                    value={draft}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw !== '' && !/^\d+$/.test(raw)) return;
                      setDraft(raw === '' ? '' : String(Math.min(libraryCount, Number(raw))));
                    }}
                    onBlur={() => {
                      if (draft === '') setDraft('0');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        confirm();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="play-stepper-btn"
                    aria-label="Increase"
                    disabled={clamped >= libraryCount}
                    {...incRepeat}
                  >
                    +
                  </button>
                </div>
              </div>
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
              <button type="button" className="btn btn-primary" onClick={confirm}>
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
