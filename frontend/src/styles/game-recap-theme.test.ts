/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'components', 'play', 'GameRecap.css'), 'utf8');

/** Declarations of the rule whose full selector list is exactly `selector`. */
function rule(selector: string): string {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (sel === selector) return m[2];
  }
  return '';
}

/**
 * GameRecap is embedded on two surfaces: the themed `.ogv-finished` panel
 * (`var(--surface-raised)`, any site theme) and the always-dark
 * `.win-celebration-card`. The default rules must use theme tokens — never
 * a hardcoded white/near-white ink, which is illegible on a light theme's
 * near-white `--surface-raised` — while the celebration card keeps its
 * fixed light-on-dark ink via a scoped override.
 */
describe('GameRecap theme handling', () => {
  it('the default rules read off theme tokens, not hardcoded white', () => {
    for (const selector of [
      '.game-recap',
      '.game-recap-title',
      '.game-recap-label',
      '.game-recap-detail',
    ]) {
      const block = rule(selector);
      expect(block, selector).not.toBe('');
      expect(block, selector).not.toMatch(/rgba\(255,\s*255,\s*255/);
      expect(block, selector).not.toMatch(/#fff\b/i);
    }
    expect(rule('.game-recap')).toMatch(/border-top:\s*1px solid var\(--border\)/);
    expect(rule('.game-recap-title')).toMatch(/color:\s*var\(--text-muted\)/);
    expect(rule('.game-recap-label')).toMatch(/color:\s*var\(--text-primary\)/);
    expect(rule('.game-recap-detail')).toMatch(/color:\s*var\(--text-secondary\)/);
  });

  it('the celebration card keeps its fixed light-on-dark ink', () => {
    expect(rule('.win-celebration-card .game-recap')).toMatch(
      /border-top-color:\s*rgba\(255,\s*255,\s*255,\s*0\.14\)/
    );
    expect(rule('.win-celebration-card .game-recap-title')).toMatch(
      /color:\s*rgba\(255,\s*255,\s*255,\s*0\.55\)/
    );
    expect(rule('.win-celebration-card .game-recap-label')).toMatch(
      /color:\s*var\(--win-accent,\s*#ffe07a\)/
    );
    expect(rule('.win-celebration-card .game-recap-detail')).toMatch(
      /color:\s*rgba\(255,\s*255,\s*255,\s*0\.88\)/
    );
  });
});
