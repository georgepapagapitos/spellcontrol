// @vitest-environment happy-dom is set on the test file — not here.
import { type JSX } from 'react';
import { useCardCarousel } from './useCardCarousel';
import './SaltiestPanel.css';

/**
 * Maps a raw EDHREC salt score (0–4 scale) to a band word.
 * Exported for unit testing.
 */
export function saltBandWord(salt: number): 'table-friendly' | 'mild' | 'spicy' | 'polarizing' {
  if (salt < 0.5) return 'table-friendly';
  if (salt < 1.5) return 'mild';
  if (salt < 2.5) return 'spicy';
  return 'polarizing';
}

interface SaltiestCard {
  name: string;
  salt: number;
}

interface SaltiestPanelProps {
  cards: SaltiestCard[];
  averageSalt?: number;
}

/**
 * Renders the saltiest cards in a deck — card name (tap-to-preview), a band
 * word chip beside each raw score, and a footer with the deck average.
 *
 * Salt scale (EDHREC): 0–4. Band words: table-friendly / mild / spicy /
 * polarizing.
 */
export function SaltiestPanel({ cards, averageSalt }: SaltiestPanelProps): JSX.Element | null {
  const carousel = useCardCarousel('Saltiest cards');

  if (cards.length === 0) return null;

  const openCarousel = (name: string) => {
    void carousel.open(
      cards.map((c) => ({
        name: c.name,
        label: `Salt ${c.salt.toFixed(2)}`,
      })),
      name
    );
  };

  // The deck's own read leads, as a band word: it is the answer to "how will
  // this land at a table?", and the rows below are the cards behind it.
  const avg =
    typeof averageSalt === 'number'
      ? { band: saltBandWord(averageSalt), text: averageSalt.toFixed(2) }
      : null;

  return (
    <>
      {avg && (
        <p className="deck-saltiest-avg">
          <strong className="deck-saltiest-avg-band">
            {avg.band.charAt(0).toUpperCase() + avg.band.slice(1)}
          </strong>{' '}
          <span className="deck-saltiest-avg-num">deck avg {avg.text}</span>
        </p>
      )}
      <ul className="deck-saltiest-list">
        {cards.map((c) => {
          const band = saltBandWord(c.salt);
          return (
            <li key={c.name} className="deck-saltiest-row">
              <button
                type="button"
                className="deck-saltiest-name card-name-chip-text"
                onClick={() => openCarousel(c.name)}
                aria-label={`Preview ${c.name}`}
                title={c.name}
              >
                {c.name}
              </button>
              <span className={`deck-saltiest-band deck-saltiest-band--${band}`}>{band}</span>
              <span className="deck-saltiest-score">{c.salt.toFixed(2)}</span>
            </li>
          );
        })}
      </ul>
      <p className="deck-saltiest-hint">EDHREC salt score, 0 to 4. Higher is more polarizing.</p>
      {carousel.preview}
    </>
  );
}
