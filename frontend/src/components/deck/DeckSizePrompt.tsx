import './DeckSizePrompt.css';
import { type JSX, useCallback, useMemo, useState } from 'react';
import { ArrowLeftRight, Plus } from 'lucide-react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { useCardThumb } from '@/lib/card-thumbs';
import { WhyBreakdown } from './WhyBreakdown';
import type { WhyFactor } from '@/lib/why-factors';
import { useCardCarousel, type CarouselEntry } from './useCardCarousel';
import type { CardPreviewAction } from '../CardPreview';

export interface SizePromptOption {
  /** Stable key (slotId for cuts, name for adds). */
  key: string;
  name: string;
  /** Role label chip ("Ramp", "Card Advantage"). */
  roleLabel?: string;
  /** Short muted "why" ("same role", "weak slot", "fills the Ramp gap"). */
  hint?: string;
  /** Grounded breakdown behind the hint, for the tappable disclosure. */
  factors?: WhyFactor[];
  onPick: () => void;
}

export interface SizePromptFooterAction {
  label: string;
  onClick: () => void;
  /** Renders as the filled primary button (the safe default action). */
  primary?: boolean;
}

export interface DeckSizePromptProps {
  /** e.g. "Deck is full (100/100)" or "Cut Sol Ring". */
  title: string;
  /** e.g. "Replace a card with Smothering Tithe?" or "Add a replacement?". */
  subtitle: string;
  /** Per-row action verb ("Replace" / "Add"). */
  actionVerb: string;
  /**
   * The card on the other side of the trade — the one being added (replace-
   * when-full) or the one just cut (refill). Rendered as a tappable chip under
   * the subtitle and seeded as the preview carousel's first slide, so any
   * candidate can be compared against it with a swipe.
   */
  subject?: { name: string; label: string };
  /** Suggested options (role-matched first). */
  options: SizePromptOption[];
  /** Full fallback list, revealed by "Show all" (e.g. every deck card to cut). */
  moreOptions?: SizePromptOption[];
  /** Bottom actions (Sideboard / Add anyway / Cancel …). */
  footer: SizePromptFooterAction[];
  /** An action is in flight — disable the row buttons. */
  busy?: boolean;
  onClose: () => void;
}

/** Portrait mini-card thumbnail (CDN-resolved by name) — same recognizable
 *  full-card treatment as the add-panel rows, never an art crop. */
function Thumb({ name }: { name: string }): JSX.Element {
  const url = useCardThumb(name, 'normal');
  return (
    <span className="deck-size-prompt-thumb" aria-hidden>
      {url && <img src={url} alt="" loading="lazy" />}
    </span>
  );
}

function OptionRow({
  option,
  verb,
  busy,
  onPreview,
}: {
  option: SizePromptOption;
  verb: string;
  busy?: boolean;
  onPreview: () => void;
}): JSX.Element {
  return (
    <li className="deck-size-prompt-row">
      <button
        type="button"
        className="deck-size-prompt-peek"
        aria-label={`Preview ${option.name}`}
        title="Preview card"
        onClick={onPreview}
      >
        <Thumb name={option.name} />
      </button>
      <span className="deck-size-prompt-card">
        <span className="deck-size-prompt-name">{option.name}</span>
        <span className="deck-size-prompt-meta">
          {option.roleLabel && <span className="deck-size-prompt-role">{option.roleLabel}</span>}
          {option.hint && <span className="deck-size-prompt-hint">{option.hint}</span>}
        </span>
        {option.factors && option.factors.length > 0 && (
          <WhyBreakdown factors={option.factors} label={`Why cut ${option.name}?`} />
        )}
      </span>
      <button
        type="button"
        className="deck-size-prompt-act"
        onClick={option.onPick}
        disabled={busy}
        aria-label={`${verb} ${option.name}`}
      >
        {verb}
      </button>
    </li>
  );
}

/**
 * The deck-size guard prompt — keeps a Commander deck legal when a per-row Add
 * would overfill it (or a Cut leaves it short). Reused for both directions: on a
 * full-deck Add it lists cards to cut ("Replace"), on a Cut it lists cards to add
 * ("Add"). Uses the house card-picker overlay (bottom sheet on mobile, centered
 * ≥600px). Escape hatches live in the footer (Sideboard / Add anyway / Cancel).
 */
export function DeckSizePrompt({
  title,
  subtitle,
  actionVerb,
  subject,
  options,
  moreOptions,
  footer,
  busy,
  onClose,
}: DeckSizePromptProps): JSX.Element {
  const [showAll, setShowAll] = useState(false);
  useLockBodyScroll();

  // Tap any card's art to open the preview carousel over what's on screen —
  // the subject (incoming/cut card) leads, then the visible candidates, so
  // swiping IS the side-by-side comparison. The icon bar carries the row's
  // Replace/Add action; the subject slide gets none (nothing to act on).
  const visibleOptions = useMemo(
    () => (showAll && moreOptions ? [...options, ...moreOptions] : options),
    [showAll, moreOptions, options]
  );
  const previewEntries = useMemo<CarouselEntry[]>(() => {
    const out: CarouselEntry[] = [];
    const seen = new Set<string>();
    if (subject) {
      out.push({ name: subject.name, label: subject.label });
      seen.add(subject.name.toLowerCase());
    }
    for (const o of visibleOptions) {
      const key = o.name.toLowerCase();
      if (seen.has(key)) continue; // moreOptions repeats the suggested rows
      seen.add(key);
      out.push({ name: o.name, label: [o.roleLabel, o.hint].filter(Boolean).join(' · ') });
    }
    return out;
  }, [subject, visibleOptions]);
  const pickByName = useMemo(() => {
    const m = new Map<string, () => void>();
    for (const o of visibleOptions) {
      if (!m.has(o.name.toLowerCase())) m.set(o.name.toLowerCase(), o.onPick);
    }
    return m;
  }, [visibleOptions]);
  const carousel = useCardCarousel(title, (entry): CardPreviewAction[] => {
    const pick = pickByName.get(entry.name.toLowerCase());
    if (!pick) return [];
    return [
      {
        key: 'pick',
        icon:
          actionVerb === 'Add' ? (
            <Plus width={18} height={18} strokeWidth={2.4} aria-hidden />
          ) : (
            <ArrowLeftRight width={18} height={18} strokeWidth={2.2} aria-hidden />
          ),
        label: actionVerb,
        onClick: () => {
          if (!busy) pick();
        },
      },
    ];
  });

  // Below 1024px this is a bottom sheet with a slide-up entry, so the
  // dismiss paths the prompt owns (backdrop, Escape) play the symmetric
  // `binder-sheet-slide-out` before unmount. On desktop it's a centered
  // panel with `animation: none` — exits stay instant there. Footer and
  // option actions are parent-owned callbacks (they act, then the parent
  // unmounts the prompt), so they aren't routed through the hook.
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  const dismiss = useCallback(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) onClose();
    else beginClose();
  }, [beginClose, onClose]);
  useEscapeKey(dismiss);

  return (
    <div
      className="card-picker-root"
      onClick={(e) => {
        e.stopPropagation();
        dismiss();
      }}
      role="presentation"
    >
      <div
        className={`card-picker-sheet deck-size-prompt${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <p className="deck-size-prompt-title">{title}</p>
          <p className="deck-size-prompt-subtitle">{subtitle}</p>
          {subject && (
            <button
              type="button"
              className="deck-size-prompt-subject"
              aria-label={`Preview ${subject.name}`}
              title="Preview card"
              onClick={() => carousel.open(previewEntries, subject.name)}
            >
              <Thumb name={subject.name} />
              <span className="deck-size-prompt-subject-text">
                <span className="deck-size-prompt-name">{subject.name}</span>
                <span className="deck-size-prompt-hint">{subject.label}</span>
              </span>
            </button>
          )}
        </div>

        {options.length > 0 ? (
          <ul className="deck-size-prompt-list" role="list">
            {options.map((o) => (
              <OptionRow
                key={o.key}
                option={o}
                verb={actionVerb}
                busy={busy}
                onPreview={() => carousel.open(previewEntries, o.name)}
              />
            ))}
          </ul>
        ) : (
          <p className="deck-size-prompt-empty">No suggestions — pick a card below.</p>
        )}

        {moreOptions && moreOptions.length > 0 && (
          <div className="deck-size-prompt-more">
            {showAll ? (
              <ul className="deck-size-prompt-list" role="list">
                {moreOptions.map((o) => (
                  <OptionRow
                    key={o.key}
                    option={o}
                    verb={actionVerb}
                    busy={busy}
                    onPreview={() => carousel.open(previewEntries, o.name)}
                  />
                ))}
              </ul>
            ) : (
              <button
                type="button"
                className="deck-size-prompt-showall"
                onClick={() => setShowAll(true)}
              >
                Pick another card…
              </button>
            )}
          </div>
        )}

        <div className="card-picker-footer deck-size-prompt-footer">
          {footer.map((f) => (
            <button
              key={f.label}
              type="button"
              className={f.primary ? 'btn btn-primary' : 'btn'}
              onClick={f.onClick}
              disabled={busy}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
