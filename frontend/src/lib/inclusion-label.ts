/**
 * EDHREC inclusion % is a popularity signal, not a quality verdict. A
 * generated deck legitimately contains cards with zero or missing inclusion —
 * combo pieces, Scryfall role-fills, collection substitutions, off-meta
 * synergy picks — chosen for their text or role, not their play-rate. `0`,
 * `undefined`, and `null` all mean the exact same thing ("no play-rate
 * evidence") and must render identically everywhere in the app: never a bare
 * "0%" / "In 0% of decks" (reads as "this card sucks" or "the generator
 * glitched"), always the calm "Off-meta" treatment.
 */
export type InclusionLabel =
  { kind: 'pct'; pct: number; label: string } | { kind: 'offmeta'; label: string };

/** Reason-less surfaces (no why-pipeline) attach this as the Off-meta chip's
 *  tooltip/title so the "off-meta" verdict never reads as an unexplained gap. */
export const OFFMETA_TOOLTIP =
  'Not commonly played with this commander. Chosen for its text and role, not its play-rate.';

export function classifyInclusion(inclusion: number | null | undefined): InclusionLabel {
  const pct = typeof inclusion === 'number' ? Math.round(inclusion) : 0;
  if (pct < 1) return { kind: 'offmeta', label: 'Off-meta' };
  return { kind: 'pct', pct, label: `In ${pct}% of decks` };
}

/**
 * Inclusion-% → a hue, so a glance reads "how-staple is this". A real
 * percentage is never rendered below 1% (see `classifyInclusion` — 0/missing
 * render as the calm "Off-meta" chip instead), so this ramp never needs to
 * speak for "no signal": every value it colors is a genuine, if low, signal —
 * a "deep cut", not an error. Red is reserved exclusively for the Cut verdict
 * tone, so the ramp never touches it:
 *
 *   1–50%   → amber→yellow (35–60)  from a spicy low-end pick to ordinary
 *   ≥50%    → yellow→green (60–120) staple ramp (unchanged from the old scale)
 *
 * Pure + exported for unit tests.
 */
export function inclusionColor(pct: number): string {
  const p = Math.max(0, Math.min(100, pct));
  const hue = p < 50 ? 35 + ((p - 1) / 49) * 25 : (p / 100) * 120;
  return `hsl(${Math.round(hue)} 60% 45%)`;
}
