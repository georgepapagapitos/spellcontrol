import { type JSX } from 'react';
import type { DeckToken } from '@/lib/deck-tokens';
import './DeckTokensPanel.css';

/**
 * Renders a deck's token-prep checklist: every token (and emblem) the deck can
 * create, deduped, each row showing the token name, its (cleaned) type line, a
 * count of how many deck cards produce it, and which cards those are — so the
 * user can grab the right physical tokens before a game.
 *
 * Data comes from {@link aggregateDeckTokens}; tokens originate from Scryfall's
 * `all_parts` threaded through the offline payload. Renders nothing when the
 * deck makes no tokens (the parent also guards, but this is defensive).
 */
export function DeckTokensPanel({ tokens }: { tokens: DeckToken[] }): JSX.Element | null {
  if (tokens.length === 0) return null;

  return (
    <section className="deck-tokens" aria-label="Tokens this deck makes">
      <div className="deck-tokens-head">
        <h4 className="deck-tokens-heading">Tokens to prep</h4>
        <span className="deck-tokens-total">
          {tokens.length} {tokens.length === 1 ? 'token' : 'tokens'}
        </span>
      </div>

      <ul className="deck-tokens-rows">
        {tokens.map((token) => {
          // "Token Creature — Goblin" → "Creature — Goblin"; "Emblem" stays as-is.
          const kind = token.typeLine?.replace(/^Token\s+/i, '');
          return (
            <li key={`${token.name} ${token.typeLine ?? ''}`} className="deck-tokens-row">
              <div className="deck-tokens-row-head">
                <span className="deck-tokens-row-name">{token.name}</span>
                <span
                  className="deck-tokens-row-count"
                  title={`${token.producers.length} ${
                    token.producers.length === 1 ? 'card makes' : 'cards make'
                  } this token`}
                >
                  {token.producers.length}×
                </span>
              </div>
              {kind && <span className="deck-tokens-row-kind">{kind}</span>}
              <span className="deck-tokens-row-producers">{token.producers.join(' · ')}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
