import { type JSX, useState } from 'react';
import { Sheet } from '@/components/overlays/Sheet';
import type { DeckToken } from '@/lib/deck/deck-tokens';
import './DeckTokensSheet.css';
import { Chip } from '@/components/shared/Chip';

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
  const [openId, setOpenId] = useState<string | null>(null);

  const selected = tokens.find((t) => tokenId(t) === openId) ?? null;

  return (
    <Sheet
      onClose={onClose}
      rootClassName="deck-tokens-root"
      className="deck-tokens-sheet"
      title="Tokens to prep"
      description={`${tokens.length} ${tokens.length === 1 ? 'token' : 'tokens'}`}
      closeButton
    >
      {tokens.length > 0 && (
        <div className="deck-tokens-sheet-body">
          <ul className="deck-tokens-chips">
            {tokens.map((t) => {
              const id = tokenId(t);
              const open = id === openId;
              return (
                <li key={id}>
                  <Chip
                    className={`deck-tokens-chip${open ? ' deck-tokens-chip--open' : ''}`}
                    pressed={open}
                    onClick={() => setOpenId(open ? null : id)}
                    labelClassName="deck-tokens-chip-name card-name-chip-text"
                    labelTitle={t.name}
                    trailing={<span className="deck-tokens-chip-count">×{t.producers.length}</span>}
                  >
                    {t.name}
                  </Chip>
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
    </Sheet>
  );
}
