import type { ColorMatchMode } from '@spellcontrol/binder-routing';

/** The color match modes the kit labels: the engine's `ColorMatchMode`. */
export type ColorModeKey = ColorMatchMode;

export const COLOR_MODE_LABELS: Record<ColorModeKey, string> = {
  any: 'Any of these',
  all: 'Exactly these',
  within: 'Within these',
};

/** The options for a list of modes, in the order given, with the default labels. */
export function colorModeOptions(keys: readonly ColorModeKey[]): ColorModeOption[] {
  return keys.map((value) => ({ value, label: COLOR_MODE_LABELS[value] }));
}

export interface ColorModeOption {
  value: ColorMatchMode;
  label: string;
}

export const COLOR_NAMES: Record<string, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  C: 'colorless',
  M: 'multicolor',
};

const joinWords = (words: string[], conjunction: string) =>
  words.length < 2
    ? words.join('')
    : `${words.slice(0, -1).join(', ')} ${conjunction} ${words[words.length - 1]}`;

/**
 * The sentence under the picker that says what the current picks match:
 * "Cards that are blue or green, including multicolor cards." Empty colors
 * return the prompt to pick some. A mode string other than the engine's three
 * returns '' so a surface with its own mode words writes its own hint.
 */
export function colorModeHint(colors: readonly string[], mode: string): string {
  if (colors.length === 0) return 'No color filter. Pick one or more colors.';
  const names = colors.map((c) => COLOR_NAMES[c.toUpperCase()] ?? c.toLowerCase());
  if (mode === 'any')
    return `Cards that are ${joinWords(names, 'or')}, including multicolor cards.`;
  if (mode === 'all') return `Only cards whose colors are exactly ${joinWords(names, 'and')}.`;
  if (mode === 'within') {
    return `Cards that fit a ${names.join('-')} deck. Colorless cards included.`;
  }
  return '';
}
