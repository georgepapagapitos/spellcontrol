import { type JSX, useId, useState } from 'react';
import { X } from 'lucide-react';
import { useLockBodyScroll } from '../../lib/use-lock-body-scroll';
import { useEscapeKey } from '../../lib/use-escape-key';
import type { DeckToken } from '@/lib/deck-tokens';
import './DeckTokensSheet.css';

const tokenId = (t: DeckToken): string => `${t.name} ${t.typeLine ?? ''}`;

/**
 * Game-prep sheet: the tokens a deck can make, so you can grab the physical
 * ones before you play. Opened on demand from the deck-action row (peer to
 * Playtest) — it's prep, not analysis, so it lives here rather than in Stats.
 *
 * Uses the shared `card-picker` sheet shell — a bottom sheet on mobile that
 * becomes a centered modal at ≥1024px — so it matches the app's other sheets
 * across breakpoints. Lean by default: a wrap of "name ×N" chips (N = how many
 * deck cards make that token); tap a chip to reveal what it is and which cards
 * produce it.
 */
export function DeckTokensSheet({
  tokens,
  onClose,
}: {
  tokens: DeckToken[];
  onClose: () => void;
}): JSX.Element {
  const titleId = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  useLockBodyScroll();
  useEscapeKey(onClose);

  const selected = tokens.find((t) => tokenId(t) === openId) ?? null;

  return (
    <div
      className="card-picker-root deck-tokens-root"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      role="presentation"
    >
      <div
        className="card-picker-sheet deck-tokens-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-picker-handle" aria-hidden />
        <header className="deck-tokens-sheet-head">
          <div className="deck-tokens-sheet-titles">
            <h2 id={titleId} className="deck-tokens-sheet-title">
              Tokens to prep
            </h2>
            <p className="deck-tokens-sheet-sub">
              {tokens.length === 0
                ? 'This deck makes no tokens.'
                : `Grab these before you play — ${tokens.length} ${
                    tokens.length === 1 ? 'token' : 'tokens'
                  }.`}
            </p>
          </div>
          <button
            type="button"
            className="deck-tokens-sheet-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X width={18} height={18} strokeWidth={2} aria-hidden />
          </button>
        </header>

        {tokens.length > 0 && (
          <div className="deck-tokens-sheet-body">
            <ul className="deck-tokens-chips">
              {tokens.map((t) => {
                const id = tokenId(t);
                const open = id === openId;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className={`deck-tokens-chip${open ? ' deck-tokens-chip--open' : ''}`}
                      aria-pressed={open}
                      onClick={() => setOpenId(open ? null : id)}
                    >
                      <span className="deck-tokens-chip-name">{t.name}</span>
                      <span className="deck-tokens-chip-count">×{t.producers.length}</span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {selected && (
              <div
                className="deck-tokens-detail"
                role="region"
                aria-label={`${selected.name} details`}
              >
                {selected.typeLine && (
                  <span className="deck-tokens-detail-type">
                    {selected.typeLine.replace(/^Token\s+/i, '')}
                  </span>
                )}
                <span className="deck-tokens-detail-producers">
                  <span className="deck-tokens-detail-label">Made by</span>{' '}
                  {selected.producers.join(' · ')}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
