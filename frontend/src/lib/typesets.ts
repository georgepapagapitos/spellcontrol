/**
 * Type-set registry. Each set is a `data-typeset="<id>"` attribute on <html>;
 * the actual CSS variable overrides live in styles/typesets.css.
 *
 * A set swaps all four type tokens *together* (`--font-display`,
 * `--font-serif`, `--font-label`, `--font-mono`) because the faces are chosen
 * as a pairing — the display face's contrast is tuned against its body face,
 * and the label face against the chrome. There is deliberately no per-face
 * picker: mixing faces across sets is how a UI stops reading as one system.
 *
 * Sibling of lib/themes.ts (color). The two axes are independent — every set
 * works with every theme, since a set touches only type tokens and a theme
 * touches only color tokens.
 *
 * `href` is the set's self-hosted stylesheet (public/fonts/typeset-<id>.css).
 * The store injects it at runtime so only the ACTIVE set's fonts are ever
 * downloaded. The default set has none: its faces are bundled in
 * styles/fonts.css and preloaded from index.html, so the parser starts those
 * downloads without waiting for JS.
 *
 * Every face is self-hosted, not linked from Google Fonts, so it can carry
 * ascent/descent overrides that centre the capital height in the line box.
 * Without them each face sat its labels a pixel or two off the optical centre
 * of any box that flex-centres them, a different direction per set.
 */
export interface TypeSetDef {
  id: string;
  name: string;
  /** One-line character sketch, shown under the name in the picker. */
  hint: string;
  /** Self-hosted stylesheet for this set's faces; null for the default set,
   *  whose faces are bundled. */
  href: string | null;
}

/**
 * The set whose fonts are bundled (styles/fonts.css) and preloaded from
 * index.html. Changing this constant re-skins the app for everyone who has
 * never opened the picker, so it travels with THREE other edits — miss one and
 * the first paint disagrees with the rest of the app:
 *   1. its faces move from public/fonts/typeset-<id>.css into
 *      styles/fonts.css (with their overrides), its href becomes null, and the
 *      old default gets a typeset-<id>.css of its own; the index.html preloads
 *      follow the new above-the-fold faces,
 *   2. the `--font-*` fallbacks in styles/tokens.css (what renders before any
 *      [data-typeset] rule matches),
 *   3. the DEFAULT_TYPESET literal in index.html's pre-paint script.
 *
 * A fourth, easy to miss: `store/typeset.test.ts`'s VALID/OTHER fixtures must
 * stay non-default (a guard test enforces it), since the default deliberately
 * injects no font link and would make those cases vacuous.
 *
 * Codex is the default because a default is not a taste choice — it is what
 * every reader gets before they know a picker exists. Its display face carries
 * character without the decorative gothic of Grimoire, which is the least
 * legible option we ship and is still one click away for anyone who wants it.
 */
export const DEFAULT_TYPESET = 'codex';

export const TYPESETS: TypeSetDef[] = [
  {
    id: 'folio',
    name: 'Folio',
    hint: 'Vintage print. Quiet and bookish.',
    href: '/fonts/typeset-folio.css',
  },
  {
    id: 'codex',
    name: 'Codex',
    hint: 'Inscriptional. Carved, not printed.',
    href: null,
  },
  {
    id: 'grimoire',
    name: 'Grimoire',
    hint: 'Gothic and heavy. Loud on purpose.',
    href: '/fonts/typeset-grimoire.css',
  },
  {
    id: 'almanac',
    name: 'Almanac',
    hint: 'Old press with typed labels.',
    href: '/fonts/typeset-almanac.css',
  },
  {
    id: 'workshop',
    name: 'Workshop',
    hint: 'Warm and characterful. Label-maker chrome.',
    href: '/fonts/typeset-workshop.css',
  },
  {
    id: 'broadsheet',
    name: 'Broadsheet',
    hint: 'Editorial. High contrast, sharp.',
    href: '/fonts/typeset-broadsheet.css',
  },
  {
    id: 'plain',
    name: 'Plain',
    hint: 'Your system fonts. No download, most legible.',
    href: '/fonts/typeset-plain.css',
  },
];

export function isValidTypeSet(id: string): boolean {
  return TYPESETS.some((t) => t.id === id);
}

/** Stylesheet URL for a set; null for the default (bundled) and unknown ids. */
export function typeSetHref(id: string): string | null {
  return TYPESETS.find((t) => t.id === id)?.href ?? null;
}
