import './DeckCardRow.css';
import { Loader2, Plus } from 'lucide-react';
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

export interface DeckCardRowProps {
  change: Change;
  /** Threaded so the inclusion line reads "In N% of {commanderName} decks". */
  commanderName?: string;
  /** Tap the thumbnail/body → open the card carousel (the complement view). */
  onPreview?: (change: Change) => void;
  /** The row's primary action (Add / Swap in). Omit for a read-only row. */
  onAct?: (change: Change) => void;
  /** Action button label. */
  actLabel?: string;
  /** Action in flight — disables the button and shows a spinner. */
  acting?: boolean;
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
  actLabel = 'Add',
  acting,
}: DeckCardRowProps): JSX.Element {
  const { name, reason, ownership, inclusion, synergy, roleLabel, deltaPrice } = change;
  const thumb = change.imageUrl || fallbackThumb(name);
  const preview = onPreview ? () => onPreview(change) : undefined;

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
      <button
        type="button"
        className="deck-card-row-art"
        onClick={preview}
        disabled={!preview}
        aria-label={preview ? `Preview ${name}` : undefined}
      >
        <img src={thumb} alt="" loading="lazy" />
        {change.isGameChanger && (
          <span className="deck-card-row-gc" title="Game changer">
            GC
          </span>
        )}
      </button>

      <button
        type="button"
        className="deck-card-row-body"
        onClick={preview}
        disabled={!preview}
        aria-label={preview ? `Preview ${name}` : undefined}
      >
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
      </button>

      {onAct && (
        <button
          type="button"
          className="deck-card-row-act"
          onClick={() => onAct(change)}
          disabled={acting}
        >
          {acting ? (
            <Loader2 className="deck-card-row-spinner" aria-hidden />
          ) : (
            <Plus width={14} height={14} aria-hidden />
          )}
          {actLabel}
        </button>
      )}
    </li>
  );
}
