/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * E408: Customize is one bordered section, and its settings groups (bracket,
 * dial, collection, and the rows behind More settings) are hairline rows
 * inside it, never bordered cards (STYLE_GUIDE § Layout system, "Surfaces:
 * one frame"). A closed settings row sits at the density tier: 36px desktop,
 * 40px tablet, 44px on a phone or any coarse pointer. Measured in a real
 * browser at 390 and 1280: closed rows went from 59px (+16px gap) on a phone
 * to 44px, and from 52px to 36px on desktop.
 *
 * Fix a failure by putting the frame back on the section, not the group.
 * The settings behind "More settings" are kit Disclosures (form.css) as of
 * the config-surface kit migration; this file keeps the density-tier
 * override that scopes the kit's flat 44px down for this section.
 */

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'deck-builder-customizer.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);

/** Bodies of every top-level rule whose selector list is exactly `selector`. */
function rules(source: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...source.matchAll(new RegExp(`(?:^|[}\\n])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map(
    (m) => m[1]
  );
}

function mediaBody(query: string): string {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = css.search(new RegExp(`@media\\s*${escaped}\\s*\\{`));
  if (start < 0) return '';
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  return '';
}

const FRAME =
  /(^|;)\s*(border|border-(left|right|bottom|color|width|style)|border-radius|background(-color)?|box-shadow)\s*:/;

describe('Customize settings are hairline rows, not cards', () => {
  it('reads the stylesheet', () => {
    expect(rules(css, '.deck-customizer-group').length).toBeGreaterThan(0);
  });

  it('a settings group carries no frame of its own, only a top hairline', () => {
    for (const body of rules(css, '.deck-customizer-group')) {
      expect(body).not.toMatch(FRAME);
    }
    expect(rules(css, '.deck-customizer-group').join(';')).toMatch(
      /border-top:\s*1px solid var\(--border\)/
    );
  });

  it('the active collection group does not turn back into a card', () => {
    for (const body of rules(css, '.collection-group.active')) {
      expect(body).not.toMatch(FRAME);
    }
  });

  it('a closed row sits at the density tier', () => {
    expect(rules(css, '.deck-customizer-more-body .disclosure-toggle').join(';')).toMatch(
      /min-height:\s*36px/
    );
    expect(
      rules(mediaBody('(max-width: 1023px)'), '.deck-customizer-more-body .disclosure-toggle').join(
        ';'
      )
    ).toMatch(/min-height:\s*40px/);
    expect(
      rules(
        mediaBody('(max-width: 599px), (pointer: coarse)'),
        '.deck-customizer-more-body .disclosure-toggle'
      ).join(';')
    ).toMatch(/min-height:\s*44px/);
  });
});
