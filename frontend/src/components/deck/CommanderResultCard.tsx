import { useCardThumb } from '../../lib/card-thumbs';
import { ColorPip } from '../shared/ManaSymbol';
import { ReadinessChip } from './CommanderReadiness';
import type { ReadinessScore } from '../../lib/commander-readiness';

interface Props {
  name: string;
  /** Art URL when the caller already has it (a resolved ScryfallCard / owned
   *  printing). When omitted, the card art is resolved by name off the CDN. */
  imageUrl?: string;
  /** Color-identity letters (WUBRGC) for the pip strip. */
  colors: string[];
  typeLine?: string;
  readiness?: ReadinessScore | 'loading';
  /** Swaps the name for "Loading…" while the pick is being resolved. */
  selecting?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  /** Fired on hover/focus — used to lazily load the readiness %. */
  onPeek?: () => void;
}

/**
 * One commander in a result grid: a card-shaped art thumbnail beside the name,
 * color pips, optional type line, and the collection-readiness %. Shared by the
 * by-name search, the by-playstyle browser, the top-EDHREC suggestions, and the
 * guided build's playstyle list so every commander list reads the same. The
 * `.commander-result-grid` container reflows from a single column (phones /
 * native) to multiple columns as width allows. Styles live in deck-builder-commander.css.
 */
export function CommanderResultCard({
  name,
  imageUrl,
  colors,
  typeLine,
  readiness,
  selecting,
  disabled,
  onSelect,
  onPeek,
}: Props) {
  // Only resolve by name when we don't already have art — keeps the by-name
  // path (full ScryfallCards) off the network entirely.
  // E127: 'normal' (not 'small') — a commander pick is a decision context,
  // matching CardSearchPanel's add-cards row thumb resolution.
  const resolved = useCardThumb(imageUrl ? undefined : name, 'normal');
  const art = imageUrl ?? resolved;
  return (
    <button
      type="button"
      className="commander-result-card"
      onClick={onSelect}
      onMouseEnter={onPeek}
      onFocus={onPeek}
      disabled={disabled}
    >
      <span className="commander-result-art" aria-hidden>
        {art ? (
          <img src={art} alt="" loading="lazy" />
        ) : (
          <span className="commander-result-art-skeleton" />
        )}
      </span>
      <span className="commander-result-body">
        <span className="commander-result-headline">
          <span className="commander-result-name">{selecting ? 'Loading…' : name}</span>
          <ReadinessChip score={readiness} />
        </span>
        {colors.length > 0 && (
          <span className="commander-result-pips" aria-hidden>
            {colors.map((color) => (
              <ColorPip key={color} color={color} pip={false} />
            ))}
          </span>
        )}
        {typeLine && <span className="commander-result-type">{typeLine}</span>}
      </span>
    </button>
  );
}
