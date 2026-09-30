import { ArrowDown, ArrowUp, Check, EqualApproximately, X, type LucideIcon } from 'lucide-react';
import type { Mark, Rarity, ScoredGuess } from '@/lib/daily/daily-client';

type Key = keyof ScoredGuess['cells'];
const KEYS: readonly Key[] = ['colors', 'mv', 'type', 'rarity', 'year'];

const COLUMN: Record<Key, string> = {
  colors: 'Colors',
  mv: 'Mana value',
  type: 'Type',
  rarity: 'Rarity',
  year: 'Year',
};

// Phone-width headers; the full name rides on the sr-only prefix in each cell.
const COLUMN_SHORT: Record<Key, string> = {
  colors: 'Color',
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

const RARITY_LONG: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  mythic: 'Mythic',
  special: 'Special',
};

const RARITY_SHORT: Record<Rarity, string> = {
  common: 'Com.',
  uncommon: 'Unc.',
  rare: 'Rare',
  mythic: 'Myth.',
  special: 'Spec.',
};

function CellValue({ k, guess }: { k: Key; guess: ScoredGuess }) {
  const { cells } = guess;
  switch (k) {
    case 'colors':
      return <>{cells.colors.value ? cells.colors.value.split('').join(' ') : 'C'}</>;
    case 'mv':
      return <>{cells.mv.value}</>;
    case 'type':
      return <>{cells.type.value}</>;
    case 'rarity':
      return (
        <>
          <span className="daily-cell-long">{RARITY_LONG[cells.rarity.value]}</span>
          <span className="daily-cell-short" aria-hidden="true">
            {RARITY_SHORT[cells.rarity.value]}
          </span>
        </>
      );
    case 'year':
      return <>{cells.year.value}</>;
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
        {KEYS.map((k) => (
          <span key={k}>
            <span className="daily-cell-long">{COLUMN[k]}</span>
            <span className="daily-cell-short">{COLUMN_SHORT[k]}</span>
          </span>
        ))}
      </div>
      <ol className="daily-grid-rows" aria-label="Your guesses, newest first">
        {rows.map((guess) => (
          <li key={guess.name} className="daily-grid-row">
            <span className="daily-grid-name">{guess.name}</span>
            {KEYS.map((k) => {
              const mark = guess.cells[k].mark;
              const { icon: Icon, says } = MARK[mark];
              return (
                <span key={k} className="daily-cell" data-mark={mark}>
                  <span className="sr-only">{COLUMN[k]}: </span>
                  <Icon
                    className="daily-cell-icon"
                    width={14}
                    height={14}
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                  <span className="daily-cell-value">
                    <CellValue k={k} guess={guess} />
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
