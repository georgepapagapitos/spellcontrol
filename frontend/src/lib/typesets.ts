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
 * `href` is the Google Fonts stylesheet for that set's faces. The store
 * injects it at runtime so only the ACTIVE set's fonts are ever downloaded;
 * the default set's link is static in index.html (so the parser starts those
 * downloads without waiting for JS) and is therefore never injected. `null`
 * means the set needs no webfont at all.
 */
export interface TypeSetDef {
  id: string;
  name: string;
  /** One-line character sketch, shown under the name in the picker. */
  hint: string;
  /** Google Fonts stylesheet for this set's faces; null = system stack. */
  href: string | null;
}

/**
 * The set whose fonts are hard-linked in index.html. Changing this constant
 * re-skins the app for everyone who has never opened the picker, so it must
 * be changed together with that <link>.
 */
export const DEFAULT_TYPESET = 'folio';

const GF = 'https://fonts.googleapis.com/css2?';

export const TYPESETS: TypeSetDef[] = [
  {
    id: 'folio',
    name: 'Folio',
    hint: 'Vintage print. Quiet and bookish.',
    href: `${GF}family=Archivo+Narrow:wght@500;600;700&family=Eczar:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Sorts+Mill+Goudy&display=swap`,
  },
  {
    id: 'codex',
    name: 'Codex',
    hint: 'Inscriptional. Carved, not printed.',
    href: `${GF}family=Archivo+Narrow:wght@500;600;700&family=Eczar:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Marcellus&display=swap`,
  },
  {
    id: 'grimoire',
    name: 'Grimoire',
    hint: 'Gothic and heavy. Loud on purpose.',
    href: `${GF}family=Germania+One&family=Oswald:wght@400;500;600&family=Space+Mono:wght@400;700&family=Vollkorn:wght@400;500;600;700&display=swap`,
  },
  {
    id: 'almanac',
    name: 'Almanac',
    hint: 'Old press with typed labels.',
    href: `${GF}family=Cutive+Mono&family=EB+Garamond:wght@400;500;600;700&family=IM+Fell+English&display=swap`,
  },
  {
    id: 'workshop',
    name: 'Workshop',
    hint: 'Warm and characterful. Label-maker chrome.',
    href: `${GF}family=Alegreya:wght@400;500;700&family=DM+Mono:wght@300;400;500&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Oswald:wght@400;500;600&display=swap`,
  },
  {
    id: 'broadsheet',
    name: 'Broadsheet',
    hint: 'Editorial. High contrast, sharp.',
    href: `${GF}family=Bebas+Neue&family=Bodoni+Moda:opsz,wght@6..96,400;6..96,500;6..96,700&family=IBM+Plex+Mono:wght@400;500;600&family=Lora:wght@400;500;600;700&display=swap`,
  },
  {
    id: 'plain',
    name: 'Plain',
    hint: 'Your system fonts. No download, most legible.',
    href: null,
  },
];

export function isValidTypeSet(id: string): boolean {
  return TYPESETS.some((t) => t.id === id);
}

/** Stylesheet URL for a set; null when it needs no webfont or is the default. */
export function typeSetHref(id: string): string | null {
  if (id === DEFAULT_TYPESET) return null; // already linked in index.html
  return TYPESETS.find((t) => t.id === id)?.href ?? null;
}
