import { COLOR_NAMES } from './color-modes';
import type { ColorMatchMode } from '@spellcontrol/binder-routing';

const joinWords = (words: string[], conjunction: string) =>
  words.length < 2
    ? words.join('')
    : `${words.slice(0, -1).join(', ')} ${conjunction} ${words[words.length - 1]}`;

/**
 * The sentence under a color picker for a list of something other than cards
 * (decks, combos): the kit's `colorModeHint` names "cards", which reads wrong
 * under a deck list. `noun` is the plural ("decks"); the sentence says what
 * the current picks match, in the engine's three modes.
 */
export function colorModeNounHint(
  colors: readonly string[],
  mode: ColorMatchMode,
  noun: string
): string {
  if (colors.length === 0) return 'No color filter. Pick one or more colors.';
  const names = colors.map((c) => COLOR_NAMES[c.toUpperCase()] ?? c.toLowerCase());
  const cap = noun.charAt(0).toUpperCase() + noun.slice(1);
  if (mode === 'any')
    return `${cap} that are ${joinWords(names, 'or')}, including multicolor ${noun}.`;
  if (mode === 'all') return `Only ${noun} whose colors are exactly ${joinWords(names, 'and')}.`;
  return `${cap} that fit a ${names.join('-')} deck. Colorless ${noun} included.`;
}
