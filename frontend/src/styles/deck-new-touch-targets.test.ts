/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const commander = readFileSync(join(here, 'deck-builder-commander.css'), 'utf8');
const forms = readFileSync(join(here, 'forms-banners.css'), 'utf8');

/**
 * Playtest batch 5, `/decks/new`. Hit-tested with `elementFromPoint`, not read
 * off the box (`.claude/tools/b5-newpage-hits.mjs`, phone/coarse):
 *
 *   .commander-owned-toggle   label 340x23  ->  REAL hit area 275x24
 *
 * That is the control tying deck-building to the collection — the product's
 * thesis — and it was the shortest target on the page. The label IS the target
 * (a 14x14 checkbox sits inside it), which is the app's sanctioned pattern;
 * `.field-checkbox` carries the 44px floor for exactly this shape and this one
 * label never picked up the class.
 */
function coarseBlocks(css: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  const re = /@media[^{]*\(pointer:\s*coarse\)[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < stripped.length && depth > 0) {
      if (stripped[i] === '{') depth++;
      else if (stripped[i] === '}') depth--;
      i++;
    }
    out.push(stripped.slice(start, i - 1));
  }
  return out.join('\n');
}

function ruleBody(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bodies = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
  return bodies.length ? bodies.join('\n') : null;
}

describe('/decks/new coarse-pointer touch targets', () => {
  it('reads the stylesheets at all', () => {
    expect(commander.length).toBeGreaterThan(500);
    expect(forms.length).toBeGreaterThan(500);
  });

  it('.commander-owned-toggle reaches the 44px floor on a coarse pointer', () => {
    const body = ruleBody(coarseBlocks(commander), '.commander-owned-toggle');
    expect(
      body,
      '.commander-owned-toggle measured a 275x24 real hit area at phone — the ' +
        'label is the target and it carried no floor. It is the one control ' +
        'linking deck-building to the collection.'
    ).toBeTruthy();
    expect(body!).toMatch(/min-height:\s*44px/);
  });

  it('still matches the shape `.field-checkbox` already uses, rather than inventing one', () => {
    // If the shared pattern ever changes, this fails and points at the pair
    // instead of letting the one-off drift.
    const shared = ruleBody(coarseBlocks(forms), '.field-checkbox');
    expect(shared, '.field-checkbox lost its coarse floor').toBeTruthy();
    expect(shared!).toMatch(/min-height:\s*44px/);
  });
});
