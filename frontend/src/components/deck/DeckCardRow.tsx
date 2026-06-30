import type { JSX } from 'react';
import './DeckCardRow.css';
import { ArrowLeftRight, ArrowRight, Loader2, Minus, Plus } from 'lucide-react';
import { OwnershipBadge } from './OwnershipBadge';
import { VerdictBadge, type VerdictTone } from './VerdictBadge';
import { WhyBreakdown } from './WhyBreakdown';
import type { Change } from '@/lib/deck-change';

/** Budget-swap confidence tier → badge tone + word (STYLE_GUIDE: success/info/warn).
 *  How close the cheaper suggestion is to the card it replaces. */
const CONFIDENCE_BADGE: Record<string, { tone: VerdictTone; label: string }> = {
  'drop-in': { tone: 'success', label: 'Drop-in' },
  sidegrade: { tone: 'info', label: 'Sidegrade' },
  budget: { tone: 'warn', label: 'Budget' },
};
import { useCardThumb } from '@/lib/card-thumbs';
import { formatMoney } from '@/lib/format-money';

/** Card art, or a placeholder while it resolves (thin EDHREC/synergy rows arrive
 *  name-only and resolve their CDN art lazily — never a bare img against the
 *  rate-limited API host). */
function Thumb({ url }: { url: string | undefined }): JSX.Element {
  return url ? (
    <img src={url} alt="" loading="lazy" />
  ) : (
    <span className="deck-card-row-art-ph" aria-hidden />
  );
}

/**
 * Inclusion-% → a hue, so a glance reads "how-staple is this". Red is reserved
 * for genuine fringe picks (<10%) — mid percentages are common, healthy
 * inclusions and must NOT collide with red = remove (the Cut verdict tone):
 *
 *   <10%    → red (0–12)            fringe pick
 *   10–50%  → amber→yellow (35–60)  ordinary inclusion, reads neutral/caution
 *   ≥50%    → yellow→green (60–120) staple ramp (unchanged from the old scale)
 *
 * The 12→35 jump at 10% is deliberate: "fringe" is a discrete signal, not the
 * bottom of a smooth gradient. Pure + exported for unit tests.
 */
export function inclusionColor(pct: number): string {
  const p = Math.max(0, Math.min(100, pct));
  let hue: number;
  if (p < 10) {
    hue = (p / 10) * 12;
  } else if (p < 50) {
    hue = 35 + ((p - 10) / 40) * 25;
  } else {
    hue = (p / 100) * 120;
  }
  return `hsl(${Math.round(hue)} 60% 45%)`;
}

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
  /** Tap the offender (out) thumbnail on a swap → preview the card being CUT.
   *  Omit to leave the out thumb non-interactive. */
  onPreviewOut?: (change: Change) => void;
  /** The row's primary action (Add / Cut / Swap in). Omit for a read-only row. */
  onAct?: (change: Change) => void;
  /** Override the action button label. Defaults to the verb for `change.type`. */
  actLabel?: string;
  /** Action in flight — disables the button and shows a spinner. */
  acting?: boolean;
  /** Marks the row for the desktop hover-peek (`useDeckHoverPeek` reads
   *  `[data-peek-name]`). Omit to opt the row out of hover-peek. */
  peekName?: string;
  /**
   * Optional secondary action rendered as a small outline button just before
   * the primary action. Keep the API generic (label + onClick) — callers supply
   * their own semantics. The button gets a minimum 36px touch target on coarse
   * pointers and a real aria-label from `ariaLabel`.
   */
  secondaryAction?: {
    label: string;
    ariaLabel: string;
    onClick: () => void;
  };
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
  onPreviewOut,
  onAct,
  actLabel,
  acting,
  peekName,
  secondaryAction,
}: DeckCardRowProps): JSX.Element {
  const { name, reason, ownership, inclusion, synergy, roleLabel, deltaPrice } = change;
  // Prefer an imageUrl already carried by the Change; otherwise resolve the
  // card's CDN art by name (cached + batched), never the rate-limited API host.
  const resolved = useCardThumb(change.imageUrl ? undefined : name);
  const thumb = change.imageUrl || resolved;
  const preview = onPreview ? () => onPreview(change) : undefined;
  const previewOut = onPreviewOut ? () => onPreviewOut(change) : undefined;
  const ActIcon = ACT_ICON[change.type];
  const label = actLabel ?? ACT_VERB[change.type];
  // On a swap the row's primary card is the one coming IN; `inName` is the card
  // being CUT. Show the offender's art (dimmed) → arrow → the incoming card, so
  // the trade reads visually instead of only living in the reason text.
  const outName = change.type === 'swap' ? change.inName : undefined;
  const outThumb = useCardThumb(outName);

  const inThumb = (
    <button
      type="button"
      className="deck-card-row-art"
      data-peek-name={peekName}
      onClick={preview}
      disabled={!preview}
      aria-label={preview ? `Preview ${name}` : `${name} art`}
    >
      <Thumb url={thumb} />
    </button>
  );

  // Inclusion read-out, or "Off-meta" for a genuinely off-meta synergy pick. The
  // percentage itself is tinted by how staple the card is (red only below ~10% —
  // see inclusionColor), so the "how-staple" signal lives in the number instead
  // of a separate unlabeled bar.
  //
  // Combos-lane rows never have an inclusion %, so suppress the "Off-meta"
  // label for them — a proven combo completion is not off-meta by definition.
  const inclusionNode =
    typeof inclusion === 'number' ? (
      <span className="deck-card-row-incl">
        In{' '}
        <span className="deck-card-row-incl-pct" style={{ color: inclusionColor(inclusion) }}>
          {Math.round(inclusion)}%
        </span>{' '}
        of {commanderName ? `${commanderName} ` : ''}decks
      </span>
    ) : change.lane === 'combos' ? null : (
      <span className="deck-card-row-incl is-offmeta">Off-meta</span>
    );

  return (
    <li className="deck-card-row">
      {/* Only the incoming-card thumbnail is the preview affordance — tap opens
          the carousel, hover (desktop) floats the peek. The body is
          non-interactive text so a stray tap/hover doesn't trigger either. On a
          swap, the offender (card being cut) art sits left of an arrow, dimmed. */}
      {outName ? (
        <div className="deck-card-row-swap-art">
          <button
            type="button"
            className="deck-card-row-out"
            data-peek-name={previewOut ? outName : undefined}
            onClick={previewOut}
            disabled={!previewOut}
            aria-label={
              previewOut ? `Preview ${outName} (being cut)` : `${outName} art (being cut)`
            }
            title={`Cut ${outName}`}
          >
            <Thumb url={outThumb} />
          </button>
          <ArrowRight className="deck-card-row-swap-arrow" aria-hidden />
          {inThumb}
        </div>
      ) : (
        inThumb
      )}

      <div className="deck-card-row-body">
        <span className="deck-card-row-title">
          <span className="deck-card-row-name">{name}</span>
          {/* Tags are shared VerdictBadge chips (tone + label, per the finer-scale
              convention) so the row speaks the Tune-board vocabulary instead of
              hand-rolled pills: warn = bracket-relevant caution, accent = theme
              fit (matches the old accent tag), neutral = informational. */}
          {change.isGameChanger && (
            <VerdictBadge
              tone="warn"
              label="Game Changer"
              title="Game Changer — high-power, bracket-relevant"
            />
          )}
          {roleLabel && <VerdictBadge tone="neutral" label={roleLabel} />}
          {change.isThemeSynergy && <VerdictBadge tone="accent" label="Synergy" />}
          {ownership === 'owned' && <OwnershipBadge owned />}
          {ownership === 'in-other-deck' && (
            <VerdictBadge
              tone="neutral"
              label="In other deck"
              title="Owned, but every copy is in another deck"
            />
          )}
          {ownership === 'in-cube' && (
            <VerdictBadge
              tone="neutral"
              label="In a cube"
              title="Owned, but every copy is committed to a physical cube"
            />
          )}
          {change.lane === 'budget' && change.confidence && CONFIDENCE_BADGE[change.confidence] && (
            <VerdictBadge
              tone={CONFIDENCE_BADGE[change.confidence].tone}
              label={CONFIDENCE_BADGE[change.confidence].label}
            />
          )}
          {change.lane === 'combos' && (
            <VerdictBadge
              tone="info"
              label="Combo"
              title="Adding this card completes a combo already in your deck"
            />
          )}
        </span>
        <span className="deck-card-row-meta">
          {inclusionNode}
          {typeof synergy === 'number' && synergy > 0 && (
            <span className="deck-card-row-syn">+{Math.round(synergy)}% synergy</span>
          )}
          {typeof deltaPrice === 'number' && (
            <span className="deck-card-row-price">
              {deltaPrice >= 0 ? '+' : '−'}
              {formatMoney(Math.abs(deltaPrice))}
            </span>
          )}
        </span>
        {reason && <span className="deck-card-row-reason">{reason}</span>}
        {change.whyFactors && change.whyFactors.length > 0 && (
          <WhyBreakdown
            factors={change.whyFactors}
            label={change.type === 'cut' ? 'Why cut this?' : 'Why this?'}
          />
        )}
      </div>

      {secondaryAction && (
        <button
          type="button"
          className="deck-card-row-secondary-act"
          onClick={secondaryAction.onClick}
          aria-label={secondaryAction.ariaLabel}
        >
          {secondaryAction.label}
        </button>
      )}

      {onAct && (
        <button
          type="button"
          className={`deck-card-row-act${change.type === 'cut' ? ' is-cut' : ''}`}
          onClick={() => onAct(change)}
          disabled={acting}
          aria-label={acting ? `${label}ing ${name}` : `${label} ${name}`}
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
