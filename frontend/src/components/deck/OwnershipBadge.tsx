import './OwnershipBadge.css';
import { CheckCircle2, Circle } from 'lucide-react';

export interface OwnershipBadgeProps {
  /** Whether the card is in the player's collection. */
  owned: boolean;
  /**
   * Render a muted "Not owned" chip for the unowned state instead of nothing.
   * Default `false` — unowned renders nothing, the implicit default in
   * "cards to add" lists. Turn on where both states carry meaning (e.g. the
   * combo one-away rows: own it = complete now vs need to buy).
   */
  showUnowned?: boolean;
  /** Extra text appended after the label, e.g. "· exact swap" or a copy count. */
  detail?: string;
  /** Tooltip override (defaults to "In your collection" / "Not in your collection").
   *  Use to surface richer context like "2 free · also in <deck>". */
  title?: string;
  /** Layout hook for the host panel. */
  className?: string;
}

/**
 * The one shared Owned / Not-owned marker. An icon + label pill in the chip
 * family (mirrors VerdictBadge): a green check for owned, a muted outline
 * circle for not-owned. Deliberately avoids a red "ban" glyph — in an MTG
 * context that reads as the banlist, not ownership.
 *
 * Presentational only. Returns `null` when unowned and `showUnowned` is off.
 */
export function OwnershipBadge({
  owned,
  showUnowned = false,
  detail,
  title,
  className,
}: OwnershipBadgeProps): JSX.Element | null {
  if (!owned && !showUnowned) return null;
  const Icon = owned ? CheckCircle2 : Circle;
  const word = owned ? 'Owned' : 'Not owned';
  const tone = owned ? 'is-owned' : 'is-unowned';
  return (
    <span
      className={`ownership-badge ${tone}${className ? ` ${className}` : ''}`}
      title={title ?? (owned ? 'In your collection' : 'Not in your collection')}
    >
      <Icon width={12} height={12} strokeWidth={2.5} aria-hidden />
      {detail ? `${word} ${detail}` : word}
    </span>
  );
}
