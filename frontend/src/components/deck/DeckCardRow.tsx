import './DeckCardRow.css';
import { ArrowLeftRight, Loader2, Minus, Plus } from 'lucide-react';
import { OwnershipBadge } from './OwnershipBadge';
import { VerdictBadge, type Verdict } from './VerdictBadge';
import type { Change } from '@/lib/deck-change';

/** Scryfall named-card image endpoint — a CDN-cached redirect, no JS API call.
 *  Used when the thin EDHREC/synergy row didn't carry an `imageUrl`. */
function fallbackThumb(name: string): string {
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`;
}

/** Inclusion-% → a red→amber→green hue, so a glance reads "how-staple is this". */
function inclusionColor(pct: number): string {
  const hue = Math.max(0, Math.min(120, (pct / 100) * 120));
  return `hsl(${hue} 60% 45%)`;
}

/** type → the canonical verdict word/tone. */
const VERDICT_FOR_TYPE: Record<Change['type'], Verdict> = {
  add: 'add',
  cut: 'cut',
  swap: 'substitute',
};

/** type → the action button's leading icon + default verb (icon size 14, per
 *  STYLE_GUIDE action-button anatomy). An explicit `actLabel` still wins. */
const ACT_ICON = { add: Plus, cut: Minus, swap: ArrowLeftRight } as const;
const ACT_VERB: Record<Change['type'], string> = { add: 'Add', cut: 'Cut', swap: 'Swap' };

export interface DeckCardRowProps {
  change: Change;
  /** Threaded so the inclusion line reads "In N% of {commanderName} decks". */
  commanderName?: string;
  /** Tap the thumbnail/body → open the card carousel (the complement view). */
  onPreview?: (change: Change) => void;
  /** The row's primary action (Add / Cut / Swap in). Omit for a read-only row. */
  onAct?: (change: Change) => void;
  /** Override the action button label. Defaults to the verb for `change.type`. */
  actLabel?: string;
  /** Action in flight — disables the button and shows a spinner. */
  acting?: boolean;
  /** Marks the row for the desktop hover-peek (`useDeckHoverPeek` reads
   *  `[data-peek-name]`). Omit to opt the row out of hover-peek. */
  peekName?: string;
}

/**
 * The one shared Tune-tab card row. Renders any add/swap-candidate `Change`
 * (the relocated Engine "Synergy picks", the in-context carousel "Swap this
 * card" alternatives) with a unified ownership badge, verdict chip, inclusion
 * read-out, and optional acquire-price — so a lane and the card-preview can
 * never disagree. Presentational; all copy/numbers come from `change`.
 */
export function DeckCardRow({
  change,
  commanderName,
  onPreview,
  onAct,
  actLabel,
  acting,
  peekName,
}: DeckCardRowProps): JSX.Element {
  const { name, reason, ownership, inclusion, synergy, roleLabel, deltaPrice } = change;
  const thumb = change.imageUrl || fallbackThumb(name);
  const preview = onPreview ? () => onPreview(change) : undefined;
  const ActIcon = ACT_ICON[change.type];
  const label = actLabel ?? ACT_VERB[change.type];

  // Inclusion read-out, or "Off-meta" for a genuinely off-meta synergy pick.
  const inclusionNode =
    typeof inclusion === 'number' ? (
      <span className="deck-card-row-incl">
        In {Math.round(inclusion)}% of {commanderName ? `${commanderName} ` : ''}decks
        <span className="deck-card-row-incl-bar" aria-hidden>
          <span
            className="deck-card-row-incl-fill"
            style={{ width: `${Math.min(100, inclusion)}%`, background: inclusionColor(inclusion) }}
          />
        </span>
      </span>
    ) : (
      <span className="deck-card-row-incl is-offmeta">Off-meta</span>
    );

  return (
    <li className="deck-card-row">
      {/* Only the thumbnail is the preview affordance — tap opens the carousel,
          hover (desktop) floats the peek. The body is non-interactive text so a
          stray tap/hover on the name or badges doesn't trigger either. */}
      <button
        type="button"
        className="deck-card-row-art"
        data-peek-name={peekName}
        onClick={preview}
        disabled={!preview}
        aria-label={preview ? `Preview ${name}` : `${name} art`}
      >
        <img src={thumb} alt="" loading="lazy" />
        {change.isGameChanger && (
          <span className="deck-card-row-gc" title="Game changer">
            GC
          </span>
        )}
      </button>

      <div className="deck-card-row-body">
        <span className="deck-card-row-title">
          <span className="deck-card-row-name">{name}</span>
          {roleLabel && <span className="deck-card-row-role">{roleLabel}</span>}
          {change.isThemeSynergy && <span className="deck-card-row-synergy-tag">Synergy</span>}
          {ownership === 'owned' && <OwnershipBadge owned />}
          {ownership === 'in-other-deck' && (
            <span className="deck-card-row-other" title="Owned, but every copy is in another deck">
              In other deck
            </span>
          )}
        </span>
        <span className="deck-card-row-meta">
          {inclusionNode}
          {typeof synergy === 'number' && synergy > 0 && (
            <span className="deck-card-row-syn">+{Math.round(synergy)}% synergy</span>
          )}
          {typeof deltaPrice === 'number' && (
            <span className="deck-card-row-price">
              {deltaPrice >= 0 ? '+' : '−'}${Math.abs(deltaPrice).toFixed(2)}
            </span>
          )}
        </span>
        <VerdictBadge
          verdict={VERDICT_FOR_TYPE[change.type]}
          reason={reason}
          className="deck-card-row-verdict"
        />
      </div>

      {onAct && (
        <button
          type="button"
          className={`deck-card-row-act${change.type === 'cut' ? ' is-cut' : ''}`}
          onClick={() => onAct(change)}
          disabled={acting}
          aria-label={acting ? `${label}ing ${name}` : `${label} ${name}`}
          // The hover-peek floats from the thumbnail toward this right-aligned
          // action; suppress so aiming at it clears the peek (matches the deck list).
          data-peek-suppress
        >
          {acting ? (
            <Loader2 className="deck-card-row-spinner" aria-hidden />
          ) : (
            <ActIcon width={14} height={14} aria-hidden />
          )}
          {label}
        </button>
      )}
    </li>
  );
}
