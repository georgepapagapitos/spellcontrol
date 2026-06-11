import { describe, expect, it } from 'vitest';

/**
 * Guard: no component may hand-roll a horizontal bar/meter fill — the
 * `style={{ width: `${pct}%` }}` pattern. Before UX-209 the app had ~8
 * divergent copies (different tracks, radii, animations, and one actively
 * misleading full-width bug in EnginePanel). The shared primitives in
 * `src/components/shared/MeterBar.tsx` (`MeterBar` / `StackedBar`) are the
 * only place that pattern is allowed; see STYLE_GUIDE.md "Bars & meters".
 *
 * Vertical charts (the curve hero, test-hand histogram) size with `height`
 * percentages and are intentionally out of scope. If a percentage *width*
 * genuinely isn't a bar fill (e.g. a column-sizing style), extend ALLOWED with
 * a comment instead of weakening the patterns.
 */

// The trap: a percentage width built from an expression, template-literal or
// string-concat form.
const FORBIDDEN = [/width:\s*`\$\{[^`]*\}%`/, /width:\s*[^,\n`]*\+\s*'%'/];
// The one place the pattern is supposed to live.
const ALLOWED = /shared\/MeterBar\.tsx$/;

// Vite-native raw import of every source file — no node fs/path, so this stays
// typecheckable under the frontend's browser-oriented tsconfig.
const sources = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('no hand-rolled bar tracks', () => {
  it('no source file builds a percentage-width fill outside MeterBar', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !/\.test\.tsx?$/.test(path) && !ALLOWED.test(path))
      .filter(([, content]) => FORBIDDEN.some((re) => re.test(content)))
      .map(([path]) => path);
    expect(
      offenders,
      'Use MeterBar / StackedBar (src/components/shared/MeterBar.tsx) instead'
    ).toEqual([]);
  });
});
