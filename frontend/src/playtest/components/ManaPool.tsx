import { useCallback } from 'react';
import { ColorPip } from '@/components/shared/ManaSymbol';
import { useLongPress } from '@/lib/use-long-press';
import { MANA_COLORS, MANA_COLOR_LABEL, type ManaColor } from '@/lib/playtest';

interface Props {
  /**
   * `row` is the narrow tier's strip. `column` is the table tier's dock: a
   * vertical list at the board's left edge, which is the shape that fits
   * beside a hand rather than across the top of one.
   */
  layout?: 'row' | 'column';
  pool: Record<ManaColor, number>;
  onAdjust(color: ManaColor, delta: number): void;
  onEmpty(): void;
}

/**
 * One color's floating count: a pip and a number, and nothing else.
 *
 * The old chip wrapped every color in a bordered box with its own − and +
 * buttons — six boxes, eighteen controls, a strip you could not read at a
 * glance during a turn. Tapping the pip is the whole control now:
 *
 * - click / tap → +1
 * - right-click, or a long-press on touch → −1
 * - arrow keys (and + / −) while focused → ±1
 *
 * Every path is reachable without a pointer, and −1 never needs a second
 * target, which is what bought the row back its size.
 */
function ManaPip({
  color,
  count,
  onAdjust,
}: {
  color: ManaColor;
  count: number;
  onAdjust(delta: number): void;
}) {
  const label = MANA_COLOR_LABEL[color];
  // `consumedClick` is a callback, not a DOM handler — it must not reach the
  // element in the spread below.
  const { consumedClick, ...touch } = useLongPress({ onLongPress: () => onAdjust(-1) });

  const onClick = useCallback(() => {
    // The long-press already decremented; the synthesized click must not
    // turn straight around and add it back.
    if (consumedClick()) return;
    onAdjust(1);
  }, [consumedClick, onAdjust]);

  return (
    <button
      type="button"
      className={`playtest-mana-pip${count === 0 ? ' is-zero' : ''}`}
      // The count is in the label rather than read off the adjacent span, so
      // a screen reader hears the value change on every press.
      aria-label={`${label} mana, ${count} floating`}
      title={`${label}: click to add, right-click to remove`}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onAdjust(-1);
      }}
      onKeyDown={(e) => {
        const delta =
          e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === '+' || e.key === '='
            ? 1
            : e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === '-'
              ? -1
              : 0;
        if (delta === 0) return;
        e.preventDefault();
        onAdjust(delta);
      }}
      {...touch}
    >
      <ColorPip color={color} pip="md" />
      <span className="playtest-mana-pip__count">{count}</span>
    </button>
  );
}

/**
 * Floating-mana tracker (display/bookkeeping only — see ADJUST_MANA in
 * reducer.ts). Six color pips, plus a manual "Empty" escape hatch for
 * mid-turn resets. The pool also empties automatically on NEXT_TURN; this
 * button covers everything finer than a full turn boundary without the
 * reducer having to model steps/phases it otherwise knows nothing about.
 */
export function ManaPool({ layout = 'row', pool, onAdjust, onEmpty }: Props) {
  const total = MANA_COLORS.reduce((sum, c) => sum + pool[c], 0);
  return (
    <div
      className={`playtest-mana-pool${layout === 'column' ? ' playtest-mana-pool--column' : ''}`}
      role="group"
      aria-label="Floating mana"
    >
      {MANA_COLORS.map((color) => (
        <ManaPip
          key={color}
          color={color}
          count={pool[color]}
          onAdjust={(delta) => onAdjust(color, delta)}
        />
      ))}
      <button
        type="button"
        className="playtest-mana-pool__empty"
        onClick={onEmpty}
        disabled={total === 0}
        title="Also empties automatically at Next Turn"
      >
        Empty
      </button>
    </div>
  );
}
