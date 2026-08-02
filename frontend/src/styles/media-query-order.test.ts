/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

/**
 * Guards the cascade-ordering trap.
 *
 * CSS has no notion of "more specific breakpoint" — `@media (max-width: 1024px)`
 * also matches at 360px. So when a file declares a NARROW max-width block and
 * then a WIDER one further down, the wider block wins every equal-specificity
 * tie at phone widths, and any property the narrow block set is silently dead.
 *
 * Nothing throws, nothing warns, and the CSS reads correctly — the rule simply
 * never applies. It cost real bugs twice:
 *   - the deck toolbar's search pill shrank below its own placeholder and
 *     rendered a clipped "Searc" at 360px, because the phone rule meant to fix
 *     it sat above the 1024px block (#1471);
 *   - `body { padding-bottom }` in responsive-nav.css's 900px block never
 *     applied at all, overridden by the 1023px block below it.
 *
 * The check is property-level, not selector-level: two blocks may legitimately
 * style the same selector (`:root`) as long as they set different properties
 * (tokens.css does exactly that, and must keep passing).
 */
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) cssFiles(p, out);
    else if (name.endsWith('.css')) out.push(p);
  }
  return out;
}

interface Block {
  maxWidth: number;
  line: number;
  /** "selector|property" pairs declared directly in this media block. */
  decls: Set<string>;
}

/** Top-level @media blocks, brace-matched so nested rules don't confuse it. */
function mediaBlocks(css: string): Block[] {
  const out: Block[] = [];
  const re = /@media([^{]*)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const query = m[1];
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let j = open; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}' && --depth === 0) {
        close = j;
        break;
      }
    }
    if (close === -1) continue;
    re.lastIndex = close;
    // Only plain `max-width` queries. A block that also carries `min-width`
    // (or a `max-height` OR-branch) is bounded below and can't blanket-override.
    if (/min-width/.test(query) || /,/.test(query)) continue;
    const mw = /max-width:\s*(\d+)px/.exec(query);
    if (!mw) continue;
    out.push({
      maxWidth: Number(mw[1]),
      line: css.slice(0, m.index).split('\n').length,
      decls: declsIn(css.slice(open + 1, close)),
    });
  }
  return out;
}

/** Collect `selector|property` for every rule directly inside a media body. */
function declsIn(body: string): Set<string> {
  const set = new Set<string>();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const selectors = m[1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('@'));
    const props = m[2]
      .split(';')
      .map((d) => d.split(':')[0].trim())
      .filter(Boolean);
    for (const sel of selectors) for (const prop of props) set.add(`${sel}|${prop}`);
  }
  return set;
}

describe('media-query ordering', () => {
  const files = cssFiles(srcRoot);

  it('finds CSS to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    const rel = relative(srcRoot, file);
    it(`${rel} has no phone rule shadowed by a wider block below it`, () => {
      const blocks = mediaBlocks(readFileSync(file, 'utf8'));
      const dead: string[] = [];
      for (let a = 0; a < blocks.length; a++) {
        for (let b = a + 1; b < blocks.length; b++) {
          if (blocks[b].maxWidth <= blocks[a].maxWidth) continue;
          for (const d of blocks[a].decls) {
            if (blocks[b].decls.has(d)) {
              const [sel, prop] = d.split('|');
              dead.push(
                `  ${sel} { ${prop} } in the max-width:${blocks[a].maxWidth}px block ` +
                  `(line ${blocks[a].line}) is overridden by the later ` +
                  `max-width:${blocks[b].maxWidth}px block (line ${blocks[b].line})`
              );
            }
          }
        }
      }
      expect(
        dead,
        `${rel}: these declarations never apply — a wider max-width block below ` +
          `also matches and wins.\n${dead.join('\n')}\n` +
          `Fix: move the narrow-tier rule BELOW the wider block, or bound the ` +
          `wider one with a min-width.`
      ).toEqual([]);
    });
  }
});
