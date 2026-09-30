import { ArrowDown, ArrowUp, Check, EqualApproximately, X, type LucideIcon } from 'lucide-react';
import {
  mainType,
  SCORE_KEYS,
  type CardAttrs,
  type GuessScore,
  type Mark,
  type ScoreKey,
} from '@/lib/daily/score';

export interface ScoredGuess {
  card: CardAttrs;
  score: GuessScore;
}

const COLUMN: Record<ScoreKey, string> = {
  colors: 'Colours',
  mv: 'Mana value',
  type: 'Type',
  rarity: 'Rarity',
  year: 'Year',
};

// Phone-width headers; the full name rides on the sr-only prefix in each cell.
const COLUMN_SHORT: Record<ScoreKey, string> = {
  colors: 'Colour',
  mv: 'MV',
  type: 'Type',
  rarity: 'Rarity',
  year: 'Year',
};

const MARK: Record<Mark, { icon: LucideIcon; says: string }> = {
  hit: { icon: Check, says: 'match' },
  near: { icon: EqualApproximately, says: 'close' },
  miss: { icon: X, says: 'no match' },
  higher: { icon: ArrowUp, says: 'the answer is higher' },
  lower: { icon: ArrowDown, says: 'the answer is lower' },
};

const RARITY_SHORT: Record<CardAttrs['rarity'], string> = {
  common: 'Com.',
  uncommon: 'Unc.',
  rare: 'Rare',
  mythic: 'Myth.',
  special: 'Spec.',
};

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function CellValue({ k, card }: { k: ScoreKey; card: CardAttrs }) {
  switch (k) {
    case 'colors':
      return <>{card.colors ? card.colors.split('').join(' ') : 'C'}</>;
    case 'mv':
      return <>{card.mv}</>;
    case 'type':
      return <>{mainType(card.typeLine)}</>;
    case 'rarity':
      return (
        <>
          <span className="daily-cell-long">{capitalise(card.rarity)}</span>
          <span className="daily-cell-short" aria-hidden="true">
            {RARITY_SHORT[card.rarity]}
          </span>
        </>
      );
    case 'year':
      return <>{card.year}</>;
  }
}

/**
 * Newest guess first: that's the row you just made. Each cell pairs its tint
 * with a glyph and, for screen readers, the words ("Rarity: Uncommon, close").
 */
export function GuessGrid({ guesses }: { guesses: readonly ScoredGuess[] }) {
  if (guesses.length === 0) return null;
  const rows = [...guesses].reverse();
  return (
    <div className="daily-grid">
      <div className="daily-grid-head" aria-hidden="true">
        <span className="daily-grid-head-name">Your guesses</span>
        {SCORE_KEYS.map((k) => (
          <span key={k}>
            <span className="daily-cell-long">{COLUMN[k]}</span>
            <span className="daily-cell-short">{COLUMN_SHORT[k]}</span>
          </span>
        ))}
      </div>
      <ol className="daily-grid-rows" aria-label="Your guesses, newest first">
        {rows.map(({ card, score }) => (
          <li key={card.name} className="daily-grid-row">
            <span className="daily-grid-name">{card.name}</span>
            {SCORE_KEYS.map((k) => {
              const { icon: Icon, says } = MARK[score[k]];
              return (
                <span key={k} className="daily-cell" data-mark={score[k]}>
                  <span className="sr-only">{COLUMN[k]}: </span>
                  <Icon
                    className="daily-cell-icon"
                    width={14}
                    height={14}
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                  <span className="daily-cell-value">
                    <CellValue k={k} card={card} />
                  </span>
                  <span className="sr-only">, {says}.</span>
                </span>
              );
            })}
          </li>
        ))}
      </ol>
      <p className="daily-grid-legend" aria-hidden="true">
        <span>
          <Check width={12} height={12} strokeWidth={2} /> match
        </span>
        <span>
          <EqualApproximately width={12} height={12} strokeWidth={2} /> close
        </span>
        <span>
          <ArrowUp width={12} height={12} strokeWidth={2} />
          <ArrowDown width={12} height={12} strokeWidth={2} /> answer is higher or lower
        </span>
        <span>
          <X width={12} height={12} strokeWidth={2} /> no match
        </span>
      </p>
    </div>
  );
}
