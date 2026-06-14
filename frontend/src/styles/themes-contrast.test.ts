/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// CSS `?raw` imports return empty under this vite/rolldown setup (the CSS plugin
// consumes the file), so read the stylesheets directly. Tests run in the node
// env (see vitest.config.ts), so fs is available.
const here = dirname(fileURLToPath(import.meta.url));
const themesCss = readFileSync(join(here, 'themes.css'), 'utf8');
// The :root fallback token block lives in tokens.css (split from global.css).
const tokensCss = readFileSync(join(here, 'tokens.css'), 'utf8');

// UX-103 guard: `--text-muted` (muted text — tab-bar labels, meta lines, "Hold"
// verdicts) must clear WCAG AA (4.5:1) against every surface it can sit on
// (bg / surface / surface-raised) in every theme, plus the :root fallback. Locks the
// fix so a future palette tweak can't quietly drop muted text below legibility.

const AA = 4.5;

function srgbToLin(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pull a `--token: #hex;` value out of a CSS block. */
function tokenIn(block: string, name: string): string | null {
  const m = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  return m ? m[1].toLowerCase() : null;
}

interface Palette {
  name: string;
  bg: string;
  surface: string;
  surfaceRaised: string;
  textMuted: string;
}

function collectThemes(): Palette[] {
  const palettes: Palette[] = [];
  const re = /\[data-theme='([a-z]+)'\]\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(themesCss))) {
    const [, name, block] = m;
    const bg = tokenIn(block, 'bg');
    const surface = tokenIn(block, 'surface');
    const surfaceRaised = tokenIn(block, 'surface-raised');
    const textMuted = tokenIn(block, 'text-muted');
    // Only the colour-definition blocks carry all four; status-only blocks don't.
    if (bg && surface && surfaceRaised && textMuted) {
      palettes.push({ name, bg, surface, surfaceRaised, textMuted });
    }
  }
  return palettes;
}

describe('theme contrast (UX-103)', () => {
  const themes = collectThemes();

  it('discovers all ten guild themes', () => {
    expect(themes.map((t) => t.name).sort()).toEqual(
      [
        'azorius',
        'boros',
        'dimir',
        'golgari',
        'gruul',
        'izzet',
        'orzhov',
        'rakdos',
        'selesnya',
        'simic',
      ].sort()
    );
  });

  for (const t of collectThemes()) {
    it(`${t.name}: --text-muted clears AA on bg/surface/surface-raised`, () => {
      const ratios = {
        bg: contrast(t.textMuted, t.bg),
        surface: contrast(t.textMuted, t.surface),
        'surface-raised': contrast(t.textMuted, t.surfaceRaised),
      };
      for (const [where, ratio] of Object.entries(ratios)) {
        expect(
          ratio,
          `${t.name} --text-muted vs --${where} = ${ratio.toFixed(2)}`
        ).toBeGreaterThanOrEqual(AA);
      }
    });
  }

  it(':root fallback --text-muted clears AA on its bg/surface/surfaceRaised', () => {
    const root = tokensCss.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const bg = tokenIn(root, 'bg');
    const surface = tokenIn(root, 'surface');
    const surfaceRaised = tokenIn(root, 'surface-raised');
    const textMuted = tokenIn(root, 'text-muted');
    expect(bg && surface && surfaceRaised && textMuted).toBeTruthy();
    for (const ground of [bg!, surface!, surfaceRaised!]) {
      expect(contrast(textMuted!, ground)).toBeGreaterThanOrEqual(AA);
    }
  });
});
