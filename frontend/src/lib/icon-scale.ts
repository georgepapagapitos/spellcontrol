/**
 * The one canonical home for the icon scale (STYLE_GUIDE § Icon scale,
 * board T157). Five (size, strokeWidth) pairs, keyed by role — pick the pair
 * that matches how the icon is used, not the surface it sits on.
 *
 * Existing `lucide-react` call sites pass these as plain numeric literals
 * (`width={14} height={14} strokeWidth={1.8}`) rather than importing this
 * module — that's lucide's own idiomatic prop shape, and a structural test
 * (`src/test/icon-scale.test.ts`) enforces every literal against this same
 * scale, so the two can't drift. Reach for `ICON_SCALE` when a value needs to
 * travel through code (e.g. picking a size at runtime) rather than sitting in
 * JSX as a literal.
 */
export const ICON_SCALE = {
  /** Badge/tag glyph, or a no-prose control in a dense row. */
  micro: { size: 12, stroke: 2 },
  /** A glyph beside a rendered word/phrase. */
  inline: { size: 14, stroke: 1.8 },
  /** A tappable icon-only or icon+chevron control. */
  standalone: { size: 16, stroke: 2 },
  /** Next to a page-hero heading/CTA. */
  hero: { size: 18, stroke: 2 },
  /** A bigger dismiss/primary standalone icon. */
  large: { size: 20, stroke: 1.8 },
} as const;

export type IconScaleRole = keyof typeof ICON_SCALE;
