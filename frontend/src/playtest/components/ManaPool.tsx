import { ColorPip } from '@/components/shared/ManaSymbol';
import { usePressRepeat } from '@/lib/use-press-repeat';
import { MANA_COLORS, MANA_COLOR_LABEL, type ManaColor } from '@/lib/playtest';

interface Props {
  pool: Record<ManaColor, number>;
  onAdjust(color: ManaColor, delta: number): void;
  onEmpty(): void;
}

/** A ± step that repeats while held — same pattern as CardContextMenu's
 *  CounterStep. Own component because the hook can't be called inside a
 *  `.map`. */
function ManaStep({
  label,
  onAdjust,
  children,
}: {
  label: string;
  onAdjust(): void;
  children: React.ReactNode;
}) {
  const press = usePressRepeat(onAdjust);
  return (
    <button type="button" className="playtest-mana-chip__step" aria-label={label} {...press}>
      {children}
    </button>
  );
}

/**
 * Floating-mana tracker (display/bookkeeping only — see ADJUST_MANA in
 * reducer.ts). Six always-visible color chips, each with a ±1 stepper, plus a
 * manual "Empty" escape hatch for mid-turn resets. The pool also empties
 * automatically on NEXT_TURN; this button covers everything finer than a
 * full turn boundary without the reducer having to model steps/phases it
 * otherwise knows nothing about.
 */
export function ManaPool({ pool, onAdjust, onEmpty }: Props) {
  const total = MANA_COLORS.reduce((sum, c) => sum + pool[c], 0);
  return (
    <div className="playtest-mana-pool" role="group" aria-label="Floating mana">
      {MANA_COLORS.map((color) => (
        <div key={color} className="playtest-mana-chip">
          <ManaStep
            label={`Remove floating ${MANA_COLOR_LABEL[color]} mana, currently ${pool[color]}`}
            onAdjust={() => onAdjust(color, -1)}
          >
            −
          </ManaStep>
          <span className="playtest-mana-chip__pip">
            <ColorPip color={color} pip="md" label={MANA_COLOR_LABEL[color]} />
          </span>
          <span className="playtest-mana-chip__count" aria-hidden>
            {pool[color]}
          </span>
          <ManaStep
            label={`Add floating ${MANA_COLOR_LABEL[color]} mana, currently ${pool[color]}`}
            onAdjust={() => onAdjust(color, 1)}
          >
            +
          </ManaStep>
        </div>
      ))}
      <button
        type="button"
        className="playtest-mana-pool__empty"
        onClick={onEmpty}
        disabled={total === 0}
        title="Clear floating mana now — it also empties automatically at Next Turn"
      >
        Empty
      </button>
    </div>
  );
}
