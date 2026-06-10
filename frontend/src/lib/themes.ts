/**
 * Theme registry. Each theme is a `data-theme="<id>"` attribute on <html>;
 * the actual CSS variable overrides live in styles/themes.css.
 *
 * Themes only override "semantic" UI tokens (bg, surface, border, text,
 * accent). Mana pip colors and rarity colors are intentionally untouched
 * so card data always reads consistently.
 *
 * Each theme declares its `scheme` (light or dark surface). The store
 * mirrors it onto <html> as `data-scheme`, which styles/themes.css uses
 * for scheme-wide rules (status colors, color-scheme, --svg-invert) —
 * adding a theme here needs no edits to those CSS blocks.
 *
 * Swatches here are for the picker UI only — they should match the two
 * guild colors the theme is built from.
 */
export type ThemeScheme = 'light' | 'dark';

interface ThemeDef {
  id: string;
  name: string;
  guild: string;
  scheme: ThemeScheme;
  swatch: [string, string];
}

export const DEFAULT_THEME = 'azorius';

/** First-run default when the OS prefers a dark color scheme. */
export const DEFAULT_DARK_THEME = 'dimir';

/**
 * Swatches show [primary, secondary] using each color's accent-level hex
 * from styles/themes.css. Keep in sync if those palette values change.
 */
export const THEMES: ThemeDef[] = [
  {
    id: 'azorius',
    name: 'Azorius',
    guild: 'White / Blue',
    scheme: 'light',
    swatch: ['#f0e0a8', '#6fa3d8'],
  },
  {
    id: 'boros',
    name: 'Boros',
    guild: 'Red / White',
    scheme: 'light',
    swatch: ['#e85a4a', '#f0e0a8'],
  },
  {
    id: 'dimir',
    name: 'Dimir',
    guild: 'Blue / Black',
    scheme: 'dark',
    swatch: ['#6fa3d8', '#b89cd8'],
  },
  {
    id: 'golgari',
    name: 'Golgari',
    guild: 'Black / Green',
    scheme: 'dark',
    swatch: ['#b89cd8', '#88c060'],
  },
  {
    id: 'gruul',
    name: 'Gruul',
    guild: 'Red / Green',
    scheme: 'dark',
    swatch: ['#e85a4a', '#88c060'],
  },
  {
    id: 'izzet',
    name: 'Izzet',
    guild: 'Blue / Red',
    scheme: 'dark',
    swatch: ['#6fa3d8', '#e85a4a'],
  },
  {
    id: 'orzhov',
    name: 'Orzhov',
    guild: 'White / Black',
    scheme: 'dark',
    swatch: ['#f0e0a8', '#b89cd8'],
  },
  {
    id: 'rakdos',
    name: 'Rakdos',
    guild: 'Black / Red',
    scheme: 'dark',
    swatch: ['#b89cd8', '#e85a4a'],
  },
  {
    id: 'selesnya',
    name: 'Selesnya',
    guild: 'Green / White',
    scheme: 'light',
    swatch: ['#88c060', '#f0e0a8'],
  },
  {
    id: 'simic',
    name: 'Simic',
    guild: 'Green / Blue',
    scheme: 'light',
    swatch: ['#88c060', '#6fa3d8'],
  },
];

export function isValidTheme(id: string): boolean {
  return THEMES.some((t) => t.id === id);
}

/** Scheme for a theme id; unknown ids fall back to the default theme's scheme. */
export function themeScheme(id: string): ThemeScheme {
  return THEMES.find((t) => t.id === id)?.scheme ?? 'light';
}
