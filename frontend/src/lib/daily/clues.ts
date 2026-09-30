import type { DailyPuzzle } from './schedule';

const COLOR_NAMES: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
};

function colourText(colors: string): string {
  if (!colors) return 'Colourless';
  return colors
    .split('')
    .map((c) => COLOR_NAMES[c] ?? c)
    .join(', ');
}

/** The six clues, in unlock order. Flavour text stands in for a sixth only when the card has some. */
export function cluesFor(p: DailyPuzzle): { label: string; value: string; prose?: boolean }[] {
  return [
    { label: 'Mana value', value: String(p.mv) },
    { label: 'Colours', value: colourText(p.colors) },
    { label: 'Type', value: p.typeLine },
    { label: 'First printed', value: `${p.setName} · ${p.year}` },
    { label: 'Rules text', value: p.rulesText, prose: true },
    p.flavor
      ? { label: 'Flavour text', value: p.flavor, prose: true }
      : { label: 'First letter', value: p.name.charAt(0).toUpperCase() },
  ];
}
