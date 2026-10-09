/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import postcss, {
  type AtRule,
  type Container,
  type Declaration,
  type Document,
  type Rule,
} from 'postcss';

// Duplicate-block ratchet (E598). Parallel sessions extending the app tended
// to write a new class that re-declares an existing one's whole block instead
// of reusing the class or a shared primitive, so the same 4+ declarations now
// live under different selectors in different sheets and every future change
// to "how a pill looks" has to find all of them. This guard freezes the set of
// such duplicate groups and only lets it shrink.
//
// A group is: one normalized declaration block (declarations sorted,
// whitespace and `!important` spacing normalized, same at-rule context, e.g.
// the same @media prelude) that appears under at least two DIFFERENT selectors
// in at least two DIFFERENT files. Not counted:
//   - blocks with fewer than MIN_DECLS declarations (resets, one-liners);
//   - the same selector repeated in several files (a cascade override, not a
//     copy) and @media / @container variants of one rule inside a single file
//     (an occurrence is a file + selector + at-rule context, once).
//
// The baseline is keyed by a hash of the block and records each group's size
// and file:selector locations. A NEW group, or a group that GROWS, fails. A
// group that shrinks or disappears also fails until you lock the gain in:
//
//   UPDATE_DUPLICATE_BLOCK_BASELINE=1 npm test -- src/styles/duplicate-block-ratchet.test.ts
//
// The update refuses to write while any group is new or larger, so it can only
// ever lower the numbers. Run npm run format afterwards (prettier reflows the JSON). Editing a declaration inside a baselined group
// changes its hash; make the same change in every copy and re-baseline, or
// better, consolidate the copies.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(srcRoot, 'styles', 'duplicate-block-ratchet.baseline.json');

const MIN_DECLS = 5;

type Group = { size: number; locations: string[] };
type Groups = Record<string, Group>;

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

function context(rule: Rule): string {
  const parts: string[] = [];
  for (let p: Container | Document | undefined = rule.parent; p; p = p.parent) {
    if (p.type === 'atrule')
      parts.unshift(`@${(p as AtRule).name} ${squash((p as AtRule).params)}`);
    else if (p.type === 'rule') parts.unshift(squash((p as Rule).selector));
  }
  return parts.join(' > ');
}

function measure(): Groups {
  const byBlock = new Map<string, Set<string>>();
  for (const file of cssFiles(srcRoot)) {
    const key = relative(srcRoot, file).split('\\').join('/');
    const root = postcss.parse(readFileSync(file, 'utf8'), { from: file });
    root.walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && /keyframes$/i.test((rule.parent as AtRule).name))
        return;
      const decls = rule.nodes
        .filter((n) => n.type === 'decl')
        .map((d) => {
          const decl = d as Declaration;
          return `${decl.prop.toLowerCase()}:${squash(decl.value)}${decl.important ? '!' : ''}`;
        });
      if (new Set(decls).size < MIN_DECLS) return;
      const ctx = context(rule);
      const block = `${ctx}\n${[...new Set(decls)].sort().join(';')}`;
      const loc = `${key}:${squash(rule.selector)}${ctx ? `  [${ctx}]` : ''}`;
      if (!byBlock.has(block)) byBlock.set(block, new Set());
      byBlock.get(block)!.add(loc);
    });
  }
  const groups: Groups = {};
  for (const [block, locs] of byBlock) {
    const files = new Set([...locs].map((l) => l.split(':')[0]));
    const selectors = new Set([...locs].map((l) => l.slice(l.indexOf(':') + 1)));
    if (files.size < 2 || selectors.size < 2) continue;
    const hash = createHash('sha1').update(block).digest('hex').slice(0, 10);
    groups[hash] = { size: locs.size, locations: [...locs].sort() };
  }
  return Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)));
}

describe('duplicate block ratchet (E598)', () => {
  const groups = measure();
  const baseline: Groups = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    : groups;

  const compare = () => {
    const rose: string[] = [];
    const fell: string[] = [];
    for (const hash of new Set([...Object.keys(groups), ...Object.keys(baseline)])) {
      const now = groups[hash]?.size ?? 0;
      const was = baseline[hash]?.size ?? 0;
      if (now > was) {
        const kind = was === 0 ? 'new duplicate group' : `group grew ${was} → ${now}`;
        rose.push(`${hash} (${kind}):\n    ${groups[hash].locations.join('\n    ')}`);
      }
      if (now < was) fell.push(`${hash}: ${was} → ${now}`);
    }
    return { rose, fell };
  };

  if (process.env.UPDATE_DUPLICATE_BLOCK_BASELINE) {
    it('writes the lowered baseline', () => {
      const { rose } = compare();
      expect(rose, `Refusing to raise the baseline:\n${rose.join('\n')}`).toEqual([]);
      writeFileSync(BASELINE_PATH, JSON.stringify(groups, null, 2) + '\n');
    });
    return;
  }

  it('no stylesheet copies another stylesheet’s declaration block', () => {
    const { rose } = compare();
    expect(
      rose,
      `These blocks repeat ${MIN_DECLS}+ identical declarations under another selector in another file. Reuse the existing class / shared primitive in components/shared, or extract a shared class; see STYLE_GUIDE § CSS file layout.\n${rose.join('\n')}`
    ).toEqual([]);
  });

  it('the duplicate-block baseline is current', () => {
    const { fell } = compare();
    expect(
      fell,
      `Duplicates were consolidated. Lock it in: UPDATE_DUPLICATE_BLOCK_BASELINE=1 npm test -- src/styles/duplicate-block-ratchet.test.ts\n${fell.join('\n')}`
    ).toEqual([]);
  });
});
