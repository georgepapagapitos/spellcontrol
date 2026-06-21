import { rarityTint, type RarityTint } from '@/lib/set-symbols';

/**
 * Accessible rarity cue — a letter chip (C/U/R/M) tinted by rarity. The
 * *letter* carries the meaning, so rarity is never conveyed by color alone
 * (WCAG 1.4.1); the tint is reinforcement, not the signal. This replaces the
 * old rarity-only color tint on the row set glyph (T36), which a colorblind
 * user couldn't read. One place owns the letter + tint + accessible-name map.
 *
 * ponytail: non-standard rarities (special/bonus/unknown) fold to the common
 * tier — same as the old glyph tint did. Add their own letters if a set ever
 * leans on them.
 */

const LETTER: Record<RarityTint, string> = {
  common: 'C',
  uncommon: 'U',
  rare: 'R',
  mythic: 'M',
};

const LABEL: Record<RarityTint, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  mythic: 'Mythic',
};

interface RarityBadgeProps {
  /** Scryfall rarity word — common / uncommon / rare / mythic. */
  rarity?: string;
  /** Extra class(es) for per-surface placement (e.g. grid corner). */
  className?: string;
}

export function RarityBadge({ rarity, className }: RarityBadgeProps) {
  const tier = rarityTint(rarity);
  return (
    <span
      className={`rarity-badge rarity-badge--${tier}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={LABEL[tier]}
      title={LABEL[tier]}
    >
      {LETTER[tier]}
    </span>
  );
}
