/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const commander = readFileSync(join(here, 'deck-builder-commander.css'), 'utf8');
const forms = readFileSync(join(here, 'forms-banners.css'), 'utf8');
const doors = readFileSync(join(here, '../pages/DeckNewPage.css'), 'utf8');
const formKit = readFileSync(join(here, '../components/shared/form.css'), 'utf8');

/**
 * Playtest batch 5, `/decks/new`, hit-tested with `elementFromPoint`
 * (`.claude/tools/b5-newpage-hits.mjs`, phone/coarse): the old "Commanders I
 * own" checkbox label measured a real hit area of 275x24, the shortest target
 * on the page and the one control tying deck-building to the collection.
 *
 * The commander finder (T168) replaced it with the form kit's
 * SegmentedControl ("All commanders" / "In my collection"), whose option span
 * carries the floor, and kept the color pips' 44px hit ghost. These pin both,
 * so the collection switch can't shrink back below the floor.
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

  it('the "In my collection" switch reaches the 44px floor on a coarse pointer', () => {
    const body = ruleBody(coarseBlocks(formKit), '.segmented-option span');
    expect(body, 'SegmentedControl lost its coarse floor').toBeTruthy();
    expect(body!).toMatch(/min-height:\s*44px/);
  });

  it('each color pip keeps a 44px hit ghost on a coarse pointer', () => {
    const ghost = ruleBody(coarseBlocks(commander), '.commander-color-pip::after');
    expect(ghost, '.commander-color-pip lost its coarse hit ghost').toBeTruthy();
    expect(ghost!).toMatch(/height:\s*44px/);
  });

  it('still matches the shape `.field-checkbox` already uses, rather than inventing one', () => {
    // If the shared pattern ever changes, this fails and points at the pair
    // instead of letting the one-off drift.
    const shared = ruleBody(coarseBlocks(forms), '.field-checkbox');
    expect(shared, '.field-checkbox lost its coarse floor').toBeTruthy();
    expect(shared!).toMatch(/min-height:\s*44px/);
  });

  it('every start-page door is a 44px target on every pointer, not only coarse ones', () => {
    // A door is a whole row the size of a card: a floor on its base rule, not
    // a coarse-only patch, so a narrow desktop window can't shrink it either.
    const body = ruleBody(doors.replace(/\/\*[\s\S]*?\*\//g, ''), '.deck-new-door');
    expect(body, '.deck-new-door lost its base rule').toBeTruthy();
    expect(body!).toMatch(/min-height:\s*var\(--touch-target\)/);
  });
});
