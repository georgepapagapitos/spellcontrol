/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The opening hand's text clears AA over the board it is dealt on.
 *
 * The takeover (`.playtest-opening-root.is-takeover`) is a translucent --bg
 * over the live table, blurred. At 82% the 2026-10-15 detector scan measured
 * the "Click a card to enlarge." hint (`.playtest-opening-hint`,
 * --text-secondary) at a 3.7:1 median, because the board's darkest and
 * brightest pixels show through. This reads the ground's alpha and the hint's
 * token from the stylesheet and checks the worst case: the hint against --bg
 * at that alpha composited over a pure black and a pure white board pixel, in
 * every theme. `color-mix(in oklab, X N%, transparent)` is X at alpha N, and
 * the browser composites it in sRGB, which is what `over()` does.
 */
const here = dirname(fileURLToPath(import.meta.url));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const sheet = strip(
  readFileSync(join(here, '..', 'playtest', 'components', 'OpeningHandSheet.css'), 'utf8')
);
const themes = readFileSync(join(here, 'themes.css'), 'utf8');

const AA = 4.5;
const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (top: number[], alpha: number, under: number[]) =>
  top.map((v, i) => v * alpha + under[i] * (1 - alpha));

function body(selector: string): string {
  for (const m of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').some((s) => s.trim() === selector)) return m[2];
  }
  throw new Error(`no rule for ${selector} in OpeningHandSheet.css`);
}

describe('opening-hand takeover ground', () => {
  const ground = body('.playtest-opening-root.is-takeover');
  const alphaMatch = ground.match(
    /background:\s*color-mix\(in oklab,\s*var\(--bg\)\s*(\d+)%,\s*transparent\)/
  );
  const hintToken = body('.playtest-opening-hint').match(/color:\s*var\(--([a-z-]+)\)/)?.[1];

  it('is --bg at a stated alpha, and the hint takes a theme text token', () => {
    expect(
      alphaMatch,
      'the takeover ground must stay color-mix(--bg N%, transparent)'
    ).toBeTruthy();
    expect(hintToken).toMatch(/^text-/);
  });

  const alpha = Number(alphaMatch?.[1] ?? 0) / 100;
  const palettes = [...themes.matchAll(/\[data-theme='([a-z]+)'\]\s*\{([^}]*)\}/g)]
    .map(([, name, block]) => ({
      name,
      bg: block.match(/--bg:\s*(#[0-9a-fA-F]{6})/)?.[1],
      ink: block.match(new RegExp(`--${hintToken}:\\s*(#[0-9a-fA-F]{6})`))?.[1],
    }))
    .filter((p): p is { name: string; bg: string; ink: string } => !!p.bg && !!p.ink);

  it('reads every theme', () => {
    expect(palettes.length).toBe(11);
  });

  for (const p of palettes) {
    it(`${p.name}: the hint clears AA over a black or white board pixel`, () => {
      for (const px of [
        [0, 0, 0],
        [255, 255, 255],
      ]) {
        const ratio = contrast(rgb(p.ink), over(rgb(p.bg), alpha, px));
        expect(
          ratio,
          `${p.name} hint over board ${px.join(',')} = ${ratio.toFixed(2)}`
        ).toBeGreaterThanOrEqual(AA);
      }
    });
  }
});
