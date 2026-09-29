/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The card-preview panel (`.card-preview-panel`, footer-card-preview.css) is an
// always-dark island inside every theme: it paints its own ground and remaps the
// theme's colour tokens so the shared rows injected into it (DeckCardRow,
// SwapThisCard, VerdictBadge pills) read on dark. It once remapped the TEXT
// tokens but not --surface, so in a light theme a neutral "Ramp" pill painted
// 55%-white text on the paper-coloured --surface: invisible. This resolves the
// panel's effective palette for every theme, the way the browser does (alpha
// composited over the ground it sits on), and holds every text/status/accent
// pairing at WCAG AA.

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, f), 'utf8');
const panelCss = read('footer-card-preview.css');
const themesCss = read('themes.css');
const tokensCss = read('tokens.css');

const AA = 4.5;
/** The panel's own solid ground (`.card-preview-panel { background }`). */
const PANEL_BG = '#14151d';

type RGB = [number, number, number];
type RGBA = [number, number, number, number];

function hex(h: string): RGB {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}
function parseColor(v: string): RGBA {
  const s = v.trim();
  if (s.startsWith('#')) return [...hex(s), 1];
  const m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/);
  if (!m) throw new Error(`unparsed colour: ${v}`);
  return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
}
/** Source-over composite of a (possibly translucent) colour onto an opaque ground. */
function over([r, g, b, a]: RGBA, ground: RGB): RGB {
  return [r * a + ground[0] * (1 - a), g * a + ground[1] * (1 - a), b * a + ground[2] * (1 - a)];
}
/** `color-mix(in srgb, a p%, b)`: linear in gamma-encoded sRGB. */
function mix(a: RGB, p: number, b: RGB): RGB {
  return [0, 1, 2].map((i) => a[i] * p + b[i] * (1 - p)) as RGB;
}
function lin(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function lum([r, g, b]: RGB): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every `--name: value;` in the first top-level block matching `selector`. */
function block(css: string, selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no block for ${selector}`);
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('\n}', at));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/^\s*--([\w-]+):\s*([^;]+);/gm)) out[m[1]] = m[2].trim();
  return out;
}

const panel = block(panelCss, '.card-preview-panel');
const panelLight = block(panelCss, "[data-scheme='light'] .card-preview-panel");
const root = block(tokensCss, ':root');

function themes(): Array<{ name: string; tokens: Record<string, string> }> {
  const out: Array<{ name: string; tokens: Record<string, string> }> = [];
  for (const m of themesCss.matchAll(/\[data-theme='([a-z]+)'\]\s*\{([^}]*)\}/g)) {
    const tokens: Record<string, string> = {};
    for (const t of m[2].matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens[t[1]] = t[2].trim();
    if (tokens.bg && tokens.accent) out.push({ name: m[1], tokens });
  }
  return out;
}
const scheme = (name: string) =>
  read('../lib/themes.ts').match(new RegExp(`id: '${name}',[\\s\\S]*?scheme: '(light|dark)'`))![1];

describe('card-preview panel: every ground the theme defines is remapped', () => {
  // The bug class: a ground token left at the theme's value inside the island.
  // Anything the themes declare as a fill must be re-pointed at the panel.
  for (const ground of ['bg', 'surface', 'surface-raised', 'border', 'border-strong']) {
    it(`--${ground}`, () => {
      expect(panel[ground], `.card-preview-panel does not remap --${ground}`).toBeDefined();
      expect(parseColor(panel[ground])[0], `--${ground} is not a white-alpha`).toBe(255);
    });
  }
  it('the on-art tokens it points at keep their shape', () => {
    // The accent resolution below assumes this exact formula.
    expect(root['art-scrim-accent']).toBe('color-mix(in srgb, var(--accent) 45%, white)');
  });
});

describe('card-preview panel: text, status and accent clear AA in every theme', () => {
  const panelBg = hex(PANEL_BG);
  const list = themes();
  it('discovers all eleven themes', () => expect(list).toHaveLength(11));

  for (const { name, tokens } of list) {
    const light = scheme(name) === 'light';
    const theme = (t: string) => tokens[t] ?? root[t];
    const resolve = (t: string): string => {
      const v = (light ? panelLight[t] : undefined) ?? panel[t] ?? theme(t);
      const ref = v.match(/^var\(--([\w-]+)\)$/);
      return ref ? root[ref[1]] : v;
    };
    // --art-scrim-accent is computed on :root, from the THEME's accent.
    const accent =
      resolve('accent') === root['art-scrim-accent']
        ? mix(hex(theme('accent')), 0.45, [255, 255, 255])
        : hex(resolve('accent'));

    it(`${name} (${light ? 'light' : 'dark'})`, () => {
      // A ground the panel leaves unremapped falls through to the theme's
      // value, as it does in the browser: that is the invisible-pill bug.
      const row = over(parseColor(resolve('surface-raised')), panelBg);
      const grounds: Record<string, RGB> = {
        panel: panelBg,
        // DeckCardRow, and a pill or outline button on it (the reported case).
        row,
        'pill on row': over(parseColor(resolve('surface')), row),
        'field (--bg) on panel': over(parseColor(resolve('bg')), panelBg),
      };
      const inks: Record<string, (ground: RGB) => RGB> = { accent: () => accent };
      for (const t of ['text-primary', 'text-secondary', 'text-muted']) {
        inks[t] = (ground) => over(parseColor(resolve(t)), ground);
      }
      for (const t of ['success', 'info', 'warn-text', 'err-text']) inks[t] = () => hex(resolve(t));

      const failures: string[] = [];
      for (const [where, ground] of Object.entries(grounds)) {
        for (const [ink, on] of Object.entries(inks)) {
          const r = contrast(on(ground), ground);
          if (r < AA) failures.push(`--${ink} on ${where}: ${r.toFixed(2)}`);
        }
      }
      // The Add / Swap in button fills with --accent and writes --on-accent.
      const onAccent = contrast(hex(resolve('on-accent')), accent);
      if (onAccent < AA) failures.push(`--on-accent on --accent: ${onAccent.toFixed(2)}`);
      expect(failures).toEqual([]);
    });
  }
});
