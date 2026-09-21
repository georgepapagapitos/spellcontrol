/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

/**
 * A hero title must never lose the ends of its letters.
 *
 * `--font-display` is user-chosen (Settings → Typeface), and the faces the
 * picker offers are TALL. Measured em-relative ink heights for the sample
 * "gjpqy Ájfl! Qgy" at 400 weight, per set:
 *
 *   plain 1.13 · folio 1.16 · grimoire 1.16 · workshop 1.16
 *   codex 1.19 · almanac 1.19 · broadsheet 1.28
 *
 * Hero rules set `line-height: 1.1` for the tight display setting they want.
 * That is the CONTENT box, so any hero that also sets `overflow: hidden` (for
 * `text-overflow: ellipsis` or `-webkit-line-clamp`) clips its own glyphs:
 * the deck hero shipped with the tail of "go fetch!" and the accent of "Ágh"
 * sliced off, differently per typeface.
 *
 * The fix is never to drop the clip (a long deck name must still truncate
 * inside its column) and never to fatten the line-height (that loosens the
 * display setting on every set to satisfy the worst one). It is vertical
 * padding — which moves the clip edge outward — cancelled by an equal
 * negative margin, so the layout is byte-identical and only the ink survives:
 *
 *   padding: 0.22em 0;
 *   margin: -0.22em 0;
 *
 * So: any rule that clips an element rendered in `--font-display` must carry
 * at least 0.18em of vertical padding somewhere in that class's rules.
 */

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..');

/** Minimum vertical padding an em-tall display face needs to clear the clip. */
const MIN_SLACK_EM = 0.18;

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

interface Rule {
  file: string;
  selector: string;
  body: string;
}

/**
 * Innermost `selector { declarations }` blocks. The `[^{}]` classes mean an
 * at-rule wrapper (`@media`, `@container`, `@supports`) never matches as a
 * rule of its own — only the real rules nested inside it do, which is exactly
 * the granularity this guard reasons about.
 */
function rules(file: string, css: string): Rule[] {
  const out: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    // Strip comments from the selector — a rule preceded by a block comment
    // captures it, since the comment contains no braces.
    const selector = m[1]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!selector || selector.startsWith('@')) continue;
    out.push({ file, selector, body: m[2] });
  }
  return out;
}

/** Class names in a selector, e.g. `.a .b:hover` → ['a', 'b']. */
function classesIn(selector: string): string[] {
  return [...selector.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
}

const clips = (body: string) =>
  /overflow(-y)?:\s*hidden/.test(body) || /-?(webkit-)?line-clamp:/.test(body);

/** Vertical padding declared in a rule body, in em (0 when none or non-em). */
function verticalPaddingEm(body: string): number {
  const em = (v: string | undefined) => {
    const m = v && /^([\d.]+)em$/.exec(v.trim());
    return m ? Number(m[1]) : 0;
  };
  const decl = (prop: string) => new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`, 'm').exec(body)?.[1];

  const block = em(decl('padding-block'));
  const top = em(decl('padding-top'));
  const bottom = em(decl('padding-bottom'));
  const short = decl('padding')?.trim().split(/\s+/)[0];
  return Math.max(block, Math.min(top, bottom), em(short));
}

const all = cssFiles(srcRoot).flatMap((f) => rules(relative(srcRoot, f), readFileSync(f, 'utf8')));

/** Classes whose own rule renders them in the user-chosen display face. */
const displayClasses = new Set(
  all
    .filter((r) => /font-family:\s*var\(--font-display\)/.test(r.body))
    .flatMap((r) => classesIn(r.selector))
);

describe('display-face heroes are not clipped by their own overflow', () => {
  it('finds the display-tier classes to check', () => {
    // A rename of the token or of every hero class would otherwise turn this
    // guard into a silent no-op.
    expect(displayClasses.size).toBeGreaterThan(5);
  });

  it('gives every clipping display-tier rule vertical slack for its glyphs', () => {
    const offenders: string[] = [];

    for (const rule of all) {
      if (!clips(rule.body)) continue;
      const clipped = classesIn(rule.selector).filter((c) => displayClasses.has(c));
      if (clipped.length === 0) continue;

      for (const cls of clipped) {
        // Slack may live on any rule for the class, not necessarily the one
        // that clips (the phone line-clamp override inherits the base rule's).
        const slack = Math.max(
          ...all
            .filter((r) => classesIn(r.selector).includes(cls))
            .map((r) => verticalPaddingEm(r.body))
        );
        if (slack < MIN_SLACK_EM) {
          offenders.push(`${rule.file}: ${rule.selector} (.${cls} has ${slack}em slack)`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
