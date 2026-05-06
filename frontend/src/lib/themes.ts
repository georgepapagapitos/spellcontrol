/**
 * Theme registry. Each theme is a `data-theme="<id>"` attribute on <html>;
 * the actual CSS variable overrides live in styles/themes.css.
 *
 * Themes only override "semantic" UI tokens (bg, surface, border, text,
 * accent). Mana pip colors and rarity colors are intentionally untouched
 * so card data always reads consistently.
 *
 * Swatches here are for the picker UI only — they should match the two
 * guild colors the theme is built from.
 */
export interface ThemeDef {
  id: string;
  name: string;
  guild: string;
  swatch: [string, string];
}

export const DEFAULT_THEME = 'azorius';

/**
 * Swatches show [primary, secondary] using each color's accent-level hex
 * from styles/themes.css. Keep in sync if those palette values change.
 */
export const THEMES: ThemeDef[] = [
  {
    id: 'azorius',
    name: 'Azorius',
    guild: 'White / Blue',
    swatch: ['#f0e0a8', '#6fa3d8'],
  },
  {
    id: 'boros',
    name: 'Boros',
    guild: 'Red / White',
    swatch: ['#e85a4a', '#f0e0a8'],
  },
  {
    id: 'dimir',
    name: 'Dimir',
    guild: 'Blue / Black',
    swatch: ['#6fa3d8', '#b89cd8'],
  },
  {
    id: 'golgari',
    name: 'Golgari',
    guild: 'Black / Green',
    swatch: ['#b89cd8', '#88c060'],
  },
  {
    id: 'gruul',
    name: 'Gruul',
    guild: 'Red / Green',
    swatch: ['#e85a4a', '#88c060'],
  },
  {
    id: 'izzet',
    name: 'Izzet',
    guild: 'Blue / Red',
    swatch: ['#6fa3d8', '#e85a4a'],
  },
  {
    id: 'orzhov',
    name: 'Orzhov',
    guild: 'White / Black',
    swatch: ['#f0e0a8', '#b89cd8'],
  },
  {
    id: 'rakdos',
    name: 'Rakdos',
    guild: 'Black / Red',
    swatch: ['#b89cd8', '#e85a4a'],
  },
  {
    id: 'selesnya',
    name: 'Selesnya',
    guild: 'Green / White',
    swatch: ['#88c060', '#f0e0a8'],
  },
  {
    id: 'simic',
    name: 'Simic',
    guild: 'Green / Blue',
    swatch: ['#88c060', '#6fa3d8'],
  },
];

export function isValidTheme(id: string): boolean {
  return THEMES.some((t) => t.id === id);
}
