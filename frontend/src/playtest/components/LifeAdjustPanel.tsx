import { useEffect, useRef, useState } from 'react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { getSafeViewport } from '@/lib/popover-placement';

interface Props {
  variant: 'floating' | 'sheet';
  /** Trigger chip's rect (floating variant only) — anchors the popover under it. */
  anchorRect: DOMRect | null;
  title: string;
  life: number;
  /** Present only for an opponent — self has no commander-damage track. */
  commanderDamage?: number;
  commanderDamageThreshold: number;
  defeated: boolean;
  onClose(): void;
  onAdjustLife(delta: number): void;
  onAdjustCommanderDamage?(delta: number): void;
}

const MARGIN = 8;
const STEPS = [-5, -1, 1, 5] as const;

function Stepper({
  label,
  value,
  onAdjust,
}: {
  label: string;
  value: number;
  onAdjust(delta: number): void;
}) {
  return (
    <div className="playtest-life-panel__stepper">
      <span className="playtest-life-panel__stepper-label">{label}</span>
      <div className="playtest-life-panel__stepper-row">
        {STEPS.slice(0, 2).map((d) => (
          <button
            key={d}
            type="button"
            className="playtest-life-panel__step"
            onClick={() => onAdjust(d)}
            aria-label={`${label} ${d}`}
          >
            {d}
          </button>
        ))}
        <span className="playtest-life-panel__value" aria-live="polite">
          {value}
        </span>
        {STEPS.slice(2).map((d) => (
          <button
            key={d}
            type="button"
            className="playtest-life-panel__step"
            onClick={() => onAdjust(d)}
            aria-label={`${label} +${d}`}
          >
            +{d}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Life/commander-damage adjustment popover for one player (LifeStrip chip).
 * Mirrors `CardContextMenu`'s dual floating/sheet chrome: a cursor-anchored
 * popover on wide viewports, the shared card-picker bottom sheet on narrow
 * ones (both variant-agnostic content).
 */
export function LifeAdjustPanel({
  variant,
  anchorRect,
  title,
  life,
  commanderDamage,
  commanderDamageThreshold,
  defeated,
  onClose,
  onAdjustLife,
  onAdjustCommanderDamage,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [clamped, setClamped] = useState<{ left: number; top: number } | null>(null);
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');

  useLockBodyScroll();
  useEscapeKey(variant === 'sheet' ? beginClose : onClose);

  useEffect(() => {
    if (variant !== 'floating') return;
    const el = panelRef.current;
    if (!el || !anchorRect) return;
    const rect = el.getBoundingClientRect();
    const safe = getSafeViewport();
    const left = Math.max(MARGIN, Math.min(anchorRect.left, safe.right - rect.width - MARGIN));
    const top = Math.max(
      MARGIN,
      Math.min(anchorRect.bottom + 6, safe.bottom - rect.height - MARGIN)
    );
    setClamped({ left, top });
  }, [anchorRect, variant]);

  const body = (
    <>
      <Stepper label="Life" value={life} onAdjust={onAdjustLife} />
      {commanderDamage !== undefined && onAdjustCommanderDamage && (
        <div className="playtest-life-panel__cmdr">
          <Stepper
            label="Commander damage"
            value={commanderDamage}
            onAdjust={onAdjustCommanderDamage}
          />
          <p className="playtest-life-panel__cmdr-note">
            {commanderDamageThreshold - commanderDamage > 0
              ? `${commanderDamageThreshold - commanderDamage} more is lethal`
              : 'Lethal commander damage'}
          </p>
        </div>
      )}
      {defeated && (
        <p className="playtest-life-panel__defeated">Defeated — heal to bring them back</p>
      )}
    </>
  );

  if (variant === 'sheet') {
    return (
      <div className="card-picker-root" role="presentation" onClick={() => beginClose()}>
        <div className="card-picker-backdrop" />
        <div
          className={`card-picker-sheet playtest-life-panel-sheet${isClosing ? ' is-closing' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(e) => e.stopPropagation()}
          onAnimationEnd={onAnimationEnd}
        >
          <div className="card-picker-handle" aria-hidden />
          <div className="card-picker-header">
            <h2 className="card-picker-title">{title}</h2>
          </div>
          <div className="playtest-life-panel">{body}</div>
          <div className="card-picker-footer">
            <button type="button" className="btn" onClick={() => beginClose()}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="playtest-ctx__backdrop" onClick={onClose} />
      <div
        ref={panelRef}
        className="playtest-life-panel-floating"
        style={{
          left: clamped?.left ?? anchorRect?.left ?? 0,
          top: clamped?.top ?? anchorRect?.bottom ?? 0,
          visibility: clamped ? 'visible' : 'hidden',
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="playtest-life-panel__title">{title}</div>
        <div className="playtest-life-panel">{body}</div>
      </div>
    </>
  );
}
