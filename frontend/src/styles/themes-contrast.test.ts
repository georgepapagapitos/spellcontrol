/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  INCLUSION_INK_HUE_SHARE,
  inclusionColor,
  inclusionInk,
} from '@/lib/deck-analysis/inclusion-label';

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
  /** Where --text-muted is remapped under prefers-contrast: more. */
  textSecondary: string | null;
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
    const textSecondary = tokenIn(block, 'text-secondary');
    // Only the colour-definition blocks carry all four; status-only blocks don't.
    if (bg && surface && surfaceRaised && textMuted) {
      palettes.push({ name, bg, surface, surfaceRaised, textMuted, textSecondary });
    }
  }
  return palettes;
}

describe('theme contrast (UX-103)', () => {
  const themes = collectThemes();

  it('discovers every palette block: the ten guilds plus obsidian', () => {
    expect(themes.map((t) => t.name).sort()).toEqual(
      [
        'azorius',
        'boros',
        'dimir',
        'golgari',
        'gruul',
        'izzet',
        'obsidian',
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

/**
 * `@media (prefers-contrast: more)` remaps --text-muted to --text-secondary
 * (see the block at the end of themes.css). That is only sound if secondary is
 * genuinely stronger than muted in EVERY theme — otherwise a reader who asked
 * the OS for more contrast would get LESS of it in whichever theme inverted,
 * and nothing else would catch it: the media block declares no color of its
 * own, so it can never fail a palette check directly.
 */
describe('prefers-contrast: more remap is an improvement everywhere', () => {
  it('themes.css actually declares the high-contrast block, last', () => {
    const at = themesCss.indexOf('@media (prefers-contrast: more)');
    expect(at, 'the prefers-contrast block is missing from themes.css').toBeGreaterThan(-1);
    // Source order is what makes it beat the equal-specificity theme blocks.
    expect(
      themesCss.indexOf("[data-theme='", at),
      'a [data-theme] block follows the prefers-contrast block and would override it'
    ).toBe(-1);
    expect(themesCss.slice(at)).toContain('--text-muted: var(--text-secondary)');
  });

  for (const t of collectThemes()) {
    it(`${t.name}: --text-secondary is at least as strong as --text-muted`, () => {
      expect(t.textSecondary, `${t.name} declares no --text-secondary`).toBeTruthy();
      for (const [where, ground] of Object.entries({
        bg: t.bg,
        surface: t.surface,
        'surface-raised': t.surfaceRaised,
      })) {
        const muted = contrast(t.textMuted, ground);
        const secondary = contrast(t.textSecondary!, ground);
        expect(
          secondary,
          `${t.name} on --${where}: secondary ${secondary.toFixed(2)} < muted ${muted.toFixed(2)} — the high-contrast remap would REDUCE contrast here`
        ).toBeGreaterThanOrEqual(muted);
      }
    });
  }
});

/**
 * `--accent` is TEXT all over the app, not only a fill: accent-toned label
 * pills, link-styled buttons, the hover color of every outline button. The
 * header's "accent vs surface ≥ 3:1" is the non-text (WCAG 1.4.11) floor, and
 * three themes sat between the two (Simic 4.28 on bg, Izzet 4.38 and Rakdos
 * 4.04 on surface-raised), so accent text there failed AA. Text needs 4.5:1,
 * and the hover color is the same text one pointer-move later.
 */
describe('accent as text clears AA', () => {
  const blocks = [...themesCss.matchAll(/\[data-theme='([a-z]+)'\]\s*\{([^}]*)\}/g)];
  for (const t of collectThemes()) {
    const block = blocks.find((m) => m[1] === t.name)![2];
    for (const token of ['accent', 'accent-hover']) {
      it(`${t.name}: --${token} on bg/surface/surface-raised`, () => {
        const ink = tokenIn(block, token);
        expect(ink, `${t.name} declares no --${token}`).toBeTruthy();
        for (const [where, ground] of Object.entries({
          bg: t.bg,
          surface: t.surface,
          'surface-raised': t.surfaceRaised,
        })) {
          const ratio = contrast(ink!, ground);
          expect(
            ratio,
            `${t.name} --${token} on --${where} = ${ratio.toFixed(2)}`
          ).toBeGreaterThanOrEqual(AA);
        }
      });
    }
  }
});

/**
 * The light-scheme `--success` / `--info` (themes.css, `[data-scheme='light']`)
 * are text: the "Owned" chip, score labels, Engine panel lines. The nightly
 * journey's axe pass caught `--success` at 4.0–4.4:1 on the Tune view, under
 * every light theme, for weeks. Hold both to AA on each light palette's grounds.
 */
describe('light-scheme status inks clear AA', () => {
  const lightBlock = themesCss.match(/\[data-scheme='light'\]\s*\{([^}]*)\}/)?.[1] ?? '';
  const light = collectThemes().filter((t) => luminance(t.bg) > 0.3);

  it('finds the light palettes and the light-scheme block', () => {
    expect(light.map((t) => t.name).sort()).toEqual(['azorius', 'boros', 'selesnya', 'simic']);
    expect(lightBlock).toContain('--success');
  });

  for (const token of ['success', 'info']) {
    for (const t of light) {
      it(`${t.name}: --${token} on bg/surface/surface-raised`, () => {
        const ink = tokenIn(lightBlock, token);
        expect(ink, `[data-scheme='light'] declares no --${token}`).toBeTruthy();
        for (const [where, ground] of Object.entries({
          bg: t.bg,
          surface: t.surface,
          'surface-raised': t.surfaceRaised,
        })) {
          const ratio = contrast(ink!, ground);
          expect(
            ratio,
            `${t.name} --${token} on --${where} = ${ratio.toFixed(2)}`
          ).toBeGreaterThanOrEqual(AA);
        }
      });
    }
  }
});

/**
 * `inclusionInk` sets the EDHREC "In 42% of decks" figure as text. The raw ramp
 * (`inclusionColor`, a 45%-lightness hue) is a meter fill; as text its yellows
 * read at 1.9:1 on a light page. The ink mixes the hue toward each theme's
 * `--text-primary`, so check every percentage on every theme's grounds.
 */
describe('inclusion % ink clears AA on every theme', () => {
  const blocks = [...themesCss.matchAll(/\[data-theme='([a-z]+)'\]\s*\{([^}]*)\}/g)];

  function hslRgb(h: number, s: number, l: number): number[] {
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0), f(8), f(4)].map((v) => v * 255);
  }
  const hex = (rgb: number[]) =>
    `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

  it('the ink is the ramp mixed toward --text-primary', () => {
    expect(inclusionInk(42)).toBe(
      `color-mix(in srgb, ${inclusionColor(42)} ${INCLUSION_INK_HUE_SHARE}%, var(--text-primary))`
    );
  });

  for (const t of collectThemes()) {
    it(`${t.name}: every inclusion % from 1 to 100`, () => {
      const text = tokenIn(blocks.find((m) => m[1] === t.name)![2], 'text-primary');
      expect(text, `${t.name} declares no --text-primary`).toBeTruthy();
      const textRgb = [1, 3, 5].map((i) => parseInt(text!.slice(i, i + 2), 16));
      const share = INCLUSION_INK_HUE_SHARE / 100;
      for (let pct = 1; pct <= 100; pct++) {
        const [, h, s, l] = inclusionColor(pct)
          .match(/hsl\((\d+) (\d+)% (\d+)%\)/)!
          .map(Number);
        const ink = hex(
          hslRgb(h, s / 100, l / 100).map((v, i) => v * share + textRgb[i] * (1 - share))
        );
        for (const [where, ground] of Object.entries({
          bg: t.bg,
          surface: t.surface,
          'surface-raised': t.surfaceRaised,
        })) {
          const ratio = contrast(ink, ground);
          expect(
            ratio,
            `${t.name} ${pct}% ink ${ink} on --${where} = ${ratio.toFixed(2)}`
          ).toBeGreaterThanOrEqual(AA);
        }
      }
    });
  }
});
