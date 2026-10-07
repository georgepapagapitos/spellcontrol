// Theme fidelity (E574): how much of a themed deck is actually on its theme.
//
// Nothing in the generator enforces a theme. Fidelity comes from building off
// the theme's EDHREC page, so a change that quietly stops doing that (a pool
// that falls back to the base page, a rebalance that evicts the theme's cards)
// ships green. This module is the measurement: pure, no I/O, no card data of
// its own. It is consumed three ways: the build report's per-theme line, the
// SOFT `theme-fidelity` invariant, and the live harness.
//
// A card is ON a theme when it is a member of the theme's creature type (a
// tribal theme: a Cat, or a changeling, which is every type), or when the
// theme's EDHREC page lists it with a synergy of at least THEME_SYNERGY_MIN.
// Page membership alone cannot be the test. Measured 2026-10-07 on Rin and
// Seri, Inseparable: every one of the 65 spells in the Cats average deck and
// all 63 in the Dogs average deck sit on their theme page, because a theme page
// lists the commander's staples too, so a deck that ignored its theme scores
// the same. Synergy is EDHREC's play-rate lift over the commander's base page,
// so it keeps the cards the theme pulled in and drops the staples.
import type { ScryfallCard } from '@/deck-builder/types';
import { frontFaceName } from '@/lib/cards/card-text';
import { resolveCreatureType } from '@/deck-builder/services/synergy/text';
import { tribeMembership } from '@/deck-builder/services/synergy/axes';
import { normalizeCardName } from './cardIdentity';

/** The least EDHREC synergy that counts a page card as the theme's own. */
export const THEME_SYNERGY_MIN = 0.1;

/**
 * A themed deck is flagged when its on-theme share falls this far (in share
 * points, 0 to 1) under the theme pages' own average decks. Chosen from the
 * live panel in deckInvariants.ts's header note, not guessed.
 */
export const THEME_SHARE_MARGIN = 0.15;

/** The fields of a card this module reads. */
export type ThemeCard = Pick<ScryfallCard, 'name'> &
  Partial<Pick<ScryfallCard, 'type_line' | 'keywords' | 'card_faces'>>;

/** One selected theme, with what EDHREC says about it. */
export interface ThemePage {
  name: string;
  /** The creature type, for a tribal theme ("Cats" -> "Cat"). */
  tribe?: string;
  /** The theme page's cards by normalized front-face name -> EDHREC synergy. */
  synergy: ReadonlyMap<string, number>;
  /** The theme page's average-deck spells, resolved to cards. Absent when the
   *  average deck could not be read for THIS theme (never a broader page's). */
  averageDeck?: readonly ThemeCard[];
}

export interface ThemeShare {
  name: string;
  /** Nonland cards this theme claims. A card on several themes counts once,
   *  for the theme it fits best (the tribe first, then the higher synergy). */
  cards: number;
}

export interface ThemeFidelity {
  /** Nonland cards measured. */
  nonland: number;
  /** Of those, the ones on at least one selected theme. */
  onTheme: number;
  /** onTheme / nonland, 0 to 1. */
  share: number;
  themes: ThemeShare[];
  /** The same share for the themes' own average decks (mean over themes).
   *  Undefined unless every selected theme has one. */
  averageShare?: number;
}

/** The creature type a theme name names, when it is tribal. */
export function themeTribe(name: string): string | undefined {
  return resolveCreatureType(name);
}

const nameKey = (name: string) => normalizeCardName(frontFaceName(name));

/** How strongly a card belongs to a theme: 0 = not at all. A tribe member
 *  outranks any page synergy. */
function affinity(card: ThemeCard, theme: ThemePage): number {
  if (theme.tribe && tribeMembership(card, new Set([theme.tribe]))) return Infinity;
  const synergy = theme.synergy.get(nameKey(card.name));
  return synergy !== undefined && synergy >= THEME_SYNERGY_MIN ? synergy : 0;
}

/** Whether a card is on a theme. */
export function isOnTheme(card: ThemeCard, theme: ThemePage): boolean {
  return affinity(card, theme) > 0;
}

function unionShare(cards: readonly ThemeCard[], themes: readonly ThemePage[]): number {
  if (cards.length === 0) return 0;
  return cards.filter((c) => themes.some((t) => isOnTheme(c, t))).length / cards.length;
}

/**
 * Measure a deck's nonland cards against its selected themes. Returns
 * undefined with no themes or no cards.
 */
export function measureThemeFidelity(
  nonlandCards: readonly ThemeCard[],
  themes: readonly ThemePage[]
): ThemeFidelity | undefined {
  if (themes.length === 0 || nonlandCards.length === 0) return undefined;
  const counts = themes.map(() => 0);
  for (const card of nonlandCards) {
    let best = -1;
    let bestAffinity = 0;
    themes.forEach((theme, i) => {
      const a = affinity(card, theme);
      if (a > bestAffinity) {
        best = i;
        bestAffinity = a;
      }
    });
    if (best >= 0) counts[best]++;
  }
  const onTheme = counts.reduce((n, c) => n + c, 0);
  const averages = themes.map((t) => t.averageDeck);
  const averageShare = averages.every((a): a is readonly ThemeCard[] => !!a && a.length > 0)
    ? averages.reduce((sum, a) => sum + unionShare(a, themes), 0) / averages.length
    : undefined;
  return {
    nonland: nonlandCards.length,
    onTheme,
    share: onTheme / nonlandCards.length,
    themes: themes.map((t, i) => ({ name: t.name, cards: counts[i] })),
    averageShare,
  };
}

/**
 * The build report's per-theme line: how many cards each theme page (or tribe)
 * accounts for, and how many the deck seats for other reasons.
 */
export function describeThemeFidelity(f: ThemeFidelity): string {
  const parts = f.themes.map(
    (t) => `${t.name} theme: ${t.cards} ${t.cards === 1 ? 'card' : 'cards'}.`
  );
  const rest = f.nonland - f.onTheme;
  const tail =
    rest === 1
      ? 'The other card is not tied to a theme.'
      : `The other ${rest} cards are not tied to a theme.`;
  return `${parts.join(' ')} ${tail}`;
}

/**
 * The invariant's verdict: the detail text when the deck's on-theme share is
 * more than THEME_SHARE_MARGIN under the themes' average decks, else undefined.
 */
export function themeDilution(f: ThemeFidelity): string | undefined {
  if (f.averageShare === undefined) return undefined;
  if (f.share >= f.averageShare - THEME_SHARE_MARGIN) return undefined;
  const pct = (n: number) => `${(100 * n).toFixed(0)}%`;
  return (
    `${f.onTheme} of ${f.nonland} nonland cards (${pct(f.share)}) are on ` +
    `${f.themes.map((t) => t.name).join(' + ')}; the theme average deck is ${pct(f.averageShare)}`
  );
}
