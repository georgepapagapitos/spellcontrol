import { useEffect, useRef, useState } from 'react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { getSafeViewport } from '@/lib/popover-placement';
import { usePressRepeat } from '@/lib/use-press-repeat';

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
  /** Player-scoped counters (poison/energy/experience/…) for this player. */
  counters: Record<string, number>;
  onClose(): void;
  onAdjustLife(delta: number): void;
  onAdjustCommanderDamage?(delta: number): void;
  onAdjustCounter(kind: string, delta: number): void;
}

const MARGIN = 8;
const STEPS = [-5, -1, 1, 5] as const;
/** Poison is the one alternate kill condition life/commander damage can't
 *  express; energy and experience are the other two counters a deck routinely
 *  tracks on the player. Anything else gets added by name. */
const PLAYER_COUNTER_KINDS = ['poison', 'energy', 'experience'];
const MAX_COUNTER_NAME = 20;

/** A ± step that repeats while held — see `usePressRepeat`. Split into its own
 *  component because the hook can't be called inside a `.map`. */
function StepButton({
  className = 'playtest-life-panel__step',
  label,
  onAdjust,
  children,
}: {
  className?: string;
  label: string;
  onAdjust(): void;
  children: React.ReactNode;
}) {
  const press = usePressRepeat(onAdjust);
  return (
    <button type="button" className={className} aria-label={label} {...press}>
      {children}
    </button>
  );
}

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
          <StepButton key={d} label={`${label} ${d}`} onAdjust={() => onAdjust(d)}>
            {d}
          </StepButton>
        ))}
        <span className="playtest-life-panel__value" aria-live="polite">
          {value}
        </span>
        {STEPS.slice(2).map((d) => (
          <StepButton key={d} label={`${label} +${d}`} onAdjust={() => onAdjust(d)}>
            +{d}
          </StepButton>
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
  counters,
  onClose,
  onAdjustLife,
  onAdjustCommanderDamage,
  onAdjustCounter,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [clamped, setClamped] = useState<{ left: number; top: number } | null>(null);
  const [counterText, setCounterText] = useState('');
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

  function submitCounter() {
    const kind = counterText.trim().slice(0, MAX_COUNTER_NAME);
    if (!kind) return;
    onAdjustCounter(kind, 1);
    setCounterText('');
  }

  // Presets plus any custom kind already on this player, so a counter added by
  // name stays adjustable afterwards.
  const counterKinds = [
    ...PLAYER_COUNTER_KINDS,
    ...Object.keys(counters).filter((k) => !PLAYER_COUNTER_KINDS.includes(k)),
  ];

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
      <div className="playtest-life-panel__counters">
        <div className="playtest-life-panel__counters-heading">Counters</div>
        {counterKinds.map((k) => (
          <div key={k} className="playtest-life-panel__counter">
            <span className="playtest-life-panel__counter-label">{k}</span>
            <StepButton
              label={`${k} minus 1, currently ${counters[k] ?? 0}`}
              onAdjust={() => onAdjustCounter(k, -1)}
            >
              −
            </StepButton>
            <span className="playtest-life-panel__value" aria-live="polite">
              {counters[k] ?? 0}
            </span>
            <StepButton
              label={`${k} plus 1, currently ${counters[k] ?? 0}`}
              onAdjust={() => onAdjustCounter(k, 1)}
            >
              +
            </StepButton>
          </div>
        ))}
        <div className="playtest-life-panel__counter-add">
          <input
            type="text"
            value={counterText}
            onChange={(e) => setCounterText(e.target.value)}
            placeholder="Other counter"
            maxLength={MAX_COUNTER_NAME}
            aria-label="Counter name"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCounter();
            }}
          />
          <button
            type="button"
            disabled={!counterText.trim()}
            onClick={submitCounter}
            aria-label="add counter"
          >
            Add
          </button>
        </div>
      </div>
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
