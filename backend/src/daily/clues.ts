import type { PoolCard } from './data';

export interface Clue {
  label: string;
  value: string;
  prose?: true;
}

const COLOR_NAMES: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
};

function colorText(colors: string): string {
  if (!colors) return 'Colorless';
  return colors
    .split('')
    .map((c) => COLOR_NAMES[c] ?? c)
    .join(', ');
}

/** The six clues, in unlock order. Flavor text stands in for a sixth only when the card has some. */
export function cluesFor(p: PoolCard): Clue[] {
  return [
    { label: 'Mana value', value: String(p.mv) },
    { label: 'Colors', value: colorText(p.colors) },
    { label: 'Type', value: p.typeLine },
    { label: 'First printed', value: `${p.setName} · ${p.year}` },
    { label: 'Rules text', value: p.rulesText, prose: true },
    p.flavor
      ? { label: 'Flavor text', value: p.flavor, prose: true }
      : { label: 'First letter', value: p.name.charAt(0).toUpperCase() },
  ];
}
