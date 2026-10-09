import '@/styles/deck-builder-commander.css';
import './CommanderResultCard.css';
import { formatCount } from '@/lib/util/format-count';
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useCardThumb } from '@/lib/cards/card-thumbs';
import { ColorPip } from '../shared/ManaSymbol';
import { Chip } from '../shared/Chip';
import { MeterBar } from '../shared/MeterBar';
import type { ReadinessScore } from '@/lib/deck/commander-readiness';
import type { MatchReason } from '@/lib/deck/commander-finder';

interface Props {
  name: string;
  /** Art URL when the caller already has it (a resolved ScryfallCard / owned
   *  printing). When omitted, the card art is resolved by name off the CDN. */
  imageUrl?: string;
  /** Color-identity letters (WUBRGC) for the pip strip. */
  colors: string[];
  /** The identity couldn't be looked up: say so instead of showing pips or "Colorless". */
  colorsUnknown?: boolean;
  /**
   * The color combination in words ("Golgari", "Mono-black"), printed beside
   * the pips. Pips name themselves on hover only; touch has no hover, so the
   * word is what tells a newer player which colors these are.
   */
  comboName?: string;
  typeLine?: string;
  /**
   * How much of this commander's deck the collection covers: a fact chip
   * ("You own 58%") by default, or with `coverageBar` a bar and a "You own 52
   * of its 90 staples" line, for the "Most of the deck owned" sort.
   */
  readiness?: ReadinessScore | 'loading';
  coverageBar?: boolean;
  /** Why a plain-words search matched, quoted under the name. */
  reason?: MatchReason | null;
  /** The commander is in the player's collection. */
  owned?: boolean;
  /** Playstyle labels this commander plays like, strongest first. */
  playstyles?: string[];
  /** EDHREC deck count, when the source list carries one. */
  numDecks?: number;
  /** Swaps the name for "Loading…" while the pick is being resolved. */
  selecting?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  /** Fired on hover/focus — used to lazily load the readiness %. */
  onPeek?: () => void;
  /**
   * SpellControl's own platform deck count for this commander (social W4).
   * Undefined renders nothing, as does a below-threshold commander.
   */
  platformDeckCount?: number;
  /** Extra rows under everything else. */
  detail?: ReactNode;
}

/** "31k decks", "4.7k decks", "812 decks". */
export function formatDeckCount(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'deck' : 'decks'}`;
}

function ReasonLine({ reason }: { reason: MatchReason }) {
  return (
    <span className="commander-result-reason">
      {reason.field === 'type' ? 'Type' : 'Rules text'}: {reason.text.slice(0, reason.start)}
      <mark>{reason.text.slice(reason.start, reason.end)}</mark>
      {reason.text.slice(reason.end)}
    </span>
  );
}

function ReadinessFact({ score }: { score: ReadinessScore | 'loading' }) {
  if (score === 'loading') {
    return (
      <Chip
        className="commander-result-fact"
        tone="neutral"
        icon={<Loader2 className="commander-readiness-spin" width={12} height={12} />}
      >
        Checking
      </Chip>
    );
  }
  if (!score.available) {
    return (
      <Chip className="commander-result-fact" tone="neutral">
        No staple data
      </Chip>
    );
  }
  return (
    <Chip className="commander-result-fact" tone="neutral" labelTitle={score.explainerLine}>
      You own {score.percent}%
    </Chip>
  );
}

/**
 * One commander in a result grid: a card-shaped art thumbnail beside the
 * name, color pips with the combination's name, and the facts that help pick
 * one (why it matched, whether you own it, how much of its deck you own, how
 * it plays, how many decks run it). Every commander list renders this, so
 * every list reads the same. The `.commander-result-grid` container reflows
 * from one column on a phone to several as width allows. Styles live in
 * deck-builder-commander.css.
 */
export function CommanderResultCard({
  name,
  imageUrl,
  colors,
  colorsUnknown,
  comboName,
  typeLine,
  readiness,
  coverageBar,
  reason,
  owned,
  playstyles,
  numDecks,
  selecting,
  disabled,
  onSelect,
  onPeek,
  platformDeckCount,
  detail,
}: Props) {
  // Only resolve by name when we don't already have art — keeps the by-name
  // path (full ScryfallCards) off the network entirely.
  // E127: 'normal' (not 'small') — a commander pick is a decision context,
  // matching CardSearchPanel's add-cards row thumb resolution.
  const resolved = useCardThumb(imageUrl ? undefined : name, 'normal');
  const art = imageUrl ?? resolved;
  const scored = readiness && readiness !== 'loading' && readiness.available ? readiness : null;
  const showBar = coverageBar === true && readiness !== undefined;
  const showReadinessFact = readiness !== undefined && !showBar;
  const styles = playstyles?.slice(0, 2) ?? [];
  const decks = numDecks ?? 0;
  const hasFacts =
    owned || showReadinessFact || styles.length > 0 || decks > 0 || platformDeckCount !== undefined;
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
        <span className="commander-result-name">{selecting ? 'Loading…' : name}</span>
        {colorsUnknown ? (
          <span className="commander-result-colors">
            <span className="commander-result-combo">Colors unavailable</span>
          </span>
        ) : (
          colors.length > 0 && (
            <span className="commander-result-colors">
              <span className="commander-result-pips" aria-hidden>
                {colors.map((color) => (
                  <ColorPip key={color} color={color} pip={false} />
                ))}
              </span>
              {comboName && <span className="commander-result-combo">{comboName}</span>}
            </span>
          )
        )}
        {typeLine && <span className="commander-result-type">{typeLine}</span>}
        {reason && reason.field !== 'name' && <ReasonLine reason={reason} />}
        {showBar && (
          <span className="commander-result-coverage">
            <MeterBar
              value={scored?.ownedCount ?? 0}
              max={scored?.totalCount || 1}
              indeterminate={readiness === 'loading'}
              color={scored && scored.percent < 45 ? 'var(--warn-border)' : 'var(--success)'}
              className="commander-result-coverage-bar"
            />
            <span className="commander-result-coverage-line">
              {readiness === 'loading'
                ? 'Checking your collection…'
                : scored
                  ? `You own ${scored.ownedCount} of its ${scored.totalCount} staples`
                  : 'No staple data for this commander'}
            </span>
          </span>
        )}
        {hasFacts && (
          <span className="commander-result-facts">
            {owned && (
              <Chip className="commander-result-fact" tone="success">
                In collection
              </Chip>
            )}
            {showReadinessFact && <ReadinessFact score={readiness} />}
            {styles.length > 0 && (
              <Chip className="commander-result-fact" tone="neutral">
                {styles.join(' · ')}
              </Chip>
            )}
            {decks > 0 && (
              <Chip className="commander-result-fact" tone="neutral">
                {formatDeckCount(decks)}
              </Chip>
            )}
            {platformDeckCount !== undefined && (
              <Chip className="commander-result-fact commander-result-platform-count" tone="info">
                {platformDeckCount.toLocaleString()} on SpellControl
              </Chip>
            )}
          </span>
        )}
        {detail}
      </span>
    </button>
  );
}
