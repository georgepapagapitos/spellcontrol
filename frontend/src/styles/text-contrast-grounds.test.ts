/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { contrastRatio } from '../lib/ink';

// Contrast guards for the grounds themes-contrast.test.ts does not reach
// (a11y sweep 2026-09: --text-muted measured 4.16:1 on a selected choice card
// in dimir, and two `opacity` rules dropped text to 3.97:1 / 4.0:1).
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
const themesCss = read('themes.css');

const AA = 4.5;

function mix(fg: string, alpha: number, ground: string): string {
  const n = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const c = (i: number) =>
    Math.round(n(fg, i) * alpha + n(ground, i) * (1 - alpha))
      .toString(16)
      .padStart(2, '0');
  return `#${c(0)}${c(1)}${c(2)}`;
}

interface Theme {
  name: string;
  grounds: Record<string, string>;
  muted: string;
  secondary: string;
  accent: string;
  accentAlpha: number;
}

function themes(): Theme[] {
  const out: Theme[] = [];
  const re = /\[data-theme='([a-z]+)'\]\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(themesCss))) {
    const tok = (n: string) => m![2].match(new RegExp(`--${n}:[ ]*(#[0-9a-fA-F]{6})`))?.[1];
    const tint = m[2].match(/--accent-light:\s*color-mix\(in srgb,\s*(#[0-9a-fA-F]{6})\s+(\d+)%/);
    const [bg, surface, raised, muted, secondary] = [
      'bg',
      'surface',
      'surface-raised',
      'text-muted',
      'text-secondary',
    ].map(tok);
    if (!bg || !surface || !raised || !muted || !secondary || !tint) continue;
    out.push({
      name: m[1],
      grounds: { bg, surface, 'surface-raised': raised },
      muted,
      secondary,
      accent: tint[1],
      accentAlpha: Number(tint[2]) / 100,
    });
  }
  return out;
}

describe('text on the accent-tinted selected ground', () => {
  const all = themes();
  it('covers every theme', () => expect(all).toHaveLength(11));
  // `.choice-option.is-selected`, `.settings-theme-option.is-active` and kin
  // paint --accent-light over whichever ground the card sits on.
  for (const t of all) {
    it(`${t.name}: --text-muted and --text-secondary clear AA on --accent-light over every ground`, () => {
      for (const [where, ground] of Object.entries(t.grounds)) {
        const tinted = mix(t.accent, t.accentAlpha, ground);
        for (const [tokenName, fg] of [
          ['text-muted', t.muted],
          ['text-secondary', t.secondary],
        ]) {
          const ratio = contrastRatio(fg, tinted);
          expect(
            ratio,
            `${t.name} --${tokenName} on accent-light over --${where} = ${ratio.toFixed(2)}`
          ).toBeGreaterThanOrEqual(AA);
        }
      }
    });
  }
});

// `opacity` on a text-bearing element blends the text toward its ground, so no
// token pairing can be trusted through it. These two did exactly that.
describe('no opacity on text that must clear AA', () => {
  const rule = (css: string, selector: string) => {
    const at = css.indexOf(`${selector} {`);
    expect(at, `${selector} rule missing`).toBeGreaterThan(-1);
    // Comments may talk about opacity; only declarations count.
    return css.slice(at, css.indexOf('}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
  };
  it('.tab-count sets a colour, not opacity', () => {
    const block = rule(read('tabs.css'), '.tab-count');
    expect(block).not.toMatch(/opacity/);
    expect(block).toMatch(/color:\s*var\(--text-muted\)/);
  });
  it('the loading next-best-move row is dimmed by colour, not opacity', () => {
    const css = read('../components/deck/NextBestMove.css');
    expect(css).not.toMatch(/\.next-best-move-row\.is-loading\s*\{[^}]*opacity/);
  });
});

// `.deck-identity-card-check.is-warn/.is-fail` tint the row with the status
// backgrounds at 70%; its label, detail and fix link all take --text-primary.
describe('text on the deck identity warn/fail row tints', () => {
  const tokensCss = read('tokens.css');
  const root = tokensCss; // pick() takes the first match, the :root default
  const light = themesCss.match(/\[data-scheme='light'\]\s*\{([^}]*)\}/)?.[1] ?? '';
  const pick = (block: string, name: string) =>
    block.match(new RegExp(`--${name}:[ ]*(#[0-9a-fA-F]{6})`))?.[1] as string;
  const primaries = new Map<string, string>();
  const re = /\[data-theme='([a-z]+)'\]\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(themesCss))) {
    const primary = pick(m[2], 'text-primary');
    if (primary) primaries.set(m[1], primary);
  }
  for (const t of themes()) {
    it(`${t.name}: --text-primary clears AA on the warn and fail row tints`, () => {
      // Light themes deepen the status backgrounds; a dark theme keeps :root's.
      const isLight = contrastRatio(t.grounds.bg, '#000000') > 10;
      const block = isLight ? light : root;
      for (const status of ['warn-bg', 'err-bg']) {
        const tint = mix(pick(block, status), 0.7, t.grounds.surface);
        const ratio = contrastRatio(primaries.get(t.name)!, tint);
        expect(
          ratio,
          `${t.name} --text-primary on ${status} row = ${ratio.toFixed(2)}`
        ).toBeGreaterThanOrEqual(AA);
      }
    });
  }
  it('the fix link in a warn/fail row takes the row ink, not --accent', () => {
    const css = read('../components/deck/DeckIdentityCard.css');
    expect(css).toMatch(
      /\.is-warn \.btn-link,\s*\.deck-identity-card-check\.is-fail \.btn-link\s*\{\s*color:\s*var\(--text-primary\)/
    );
  });
});

// Text painted on a binder's own colour takes its ink from lib/ink.ts (numeric
// proof in lib/ink.test.ts); these pin the wiring so a fixed colour can't return.
describe('binder colour fills use the picked ink', () => {
  it('the active binder tab and the index name band read --binder-ink', () => {
    expect(read('binder-nav.css')).toMatch(/\.tab\.active\s*\{\s*color:\s*var\(--binder-ink/);
    const index = read('deck-builder-binders-index.css');
    const band = index.slice(
      index.indexOf('.binders-index-list.is-grid .binders-index-card-name {')
    );
    const block = band.slice(0, band.indexOf('}'));
    expect(block).toMatch(/color:\s*var\(--binder-ink/);
    expect(block).not.toMatch(/text-shadow|color:\s*#fff/);
  });
  it('the components that paint --binder-color also set --binder-ink', () => {
    for (const file of ['../components/BinderTabs.tsx', '../pages/BindersIndexPage.tsx']) {
      expect(read(file), file).toMatch(/--binder-ink/);
    }
  });
});
