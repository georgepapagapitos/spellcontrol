import './DeckSizePrompt.css';
import { useState } from 'react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';

export interface SizePromptOption {
  /** Stable key (slotId for cuts, name for adds). */
  key: string;
  name: string;
  /** Role label chip ("Ramp", "Card Advantage"). */
  roleLabel?: string;
  /** Short muted "why" ("same role", "weak slot", "fills the Ramp gap"). */
  hint?: string;
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

function OptionRow({
  option,
  verb,
  busy,
}: {
  option: SizePromptOption;
  verb: string;
  busy?: boolean;
}): JSX.Element {
  return (
    <li className="deck-size-prompt-row">
      <span className="deck-size-prompt-card">
        <span className="deck-size-prompt-name">{option.name}</span>
        <span className="deck-size-prompt-meta">
          {option.roleLabel && <span className="deck-size-prompt-role">{option.roleLabel}</span>}
          {option.hint && <span className="deck-size-prompt-hint">{option.hint}</span>}
        </span>
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
  options,
  moreOptions,
  footer,
  busy,
  onClose,
}: DeckSizePromptProps): JSX.Element {
  const [showAll, setShowAll] = useState(false);
  useLockBodyScroll();
  useEscapeKey(onClose);

  return (
    <div
      className="card-picker-root"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      role="presentation"
    >
      <div
        className="card-picker-sheet deck-size-prompt"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <p className="deck-size-prompt-title">{title}</p>
          <p className="deck-size-prompt-subtitle">{subtitle}</p>
        </div>

        {options.length > 0 ? (
          <ul className="deck-size-prompt-list" role="list">
            {options.map((o) => (
              <OptionRow key={o.key} option={o} verb={actionVerb} busy={busy} />
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
                  <OptionRow key={o.key} option={o} verb={actionVerb} busy={busy} />
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
