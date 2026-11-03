// Guard: a ` · ` meta separator travels with the item AFTER it, never the one
// before it.
//
// WHY. A hero meta line ("Commander · 100 cards · $105.99 · Bracket 3") wraps
// on a phone. Written as `\u00A0· ` (no-break space, dot, breaking space), the
// dot is glued to the item before it, so the wrap leaves a dangling dot at the
// end of line one ("$105.99 ·") and starts line two bare. The 2026-11-03 UX
// pass saw it on the deck editor hero (DK-09, #3179) and again on the public
// deck page, from the same pattern copied between the two. The right form is
// ` ·\u00A0`: break before the dot, keep the dot with what it introduces.

import { describe, expect, it } from 'vitest';
import { join, relative, sep } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { SRC } from './import-graph';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** A no-break space (escaped, literal or entity) right before a middle dot
 *  that is followed by an ordinary, breaking space or the end of the string. */
const GLUED_BEFORE = /(\\u00A0|\u00A0|&nbsp;)·( |'|`|")/;

describe('meta separators wrap with the next item', () => {
  it('no source glues a middle-dot separator to the item before it', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (GLUED_BEFORE.test(line))
            offenders.push(`${relative(SRC, file).split(sep).join('/')}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
