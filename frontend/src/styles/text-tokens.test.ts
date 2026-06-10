/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// UX-101 guard: every `var(--text-*)` referenced in CSS must be a token that is
// actually defined. The original bug — `var(--text-3xl)` referenced but never
// defined — made every page hero render from its (smaller) fallback. This test
// fails loudly if a `--text-*` token is referenced without a definition.
//
// CSS `?raw` imports come back empty under this vite/rolldown setup, so read the
// stylesheets off disk (tests run in the node env per vitest.config.ts).
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

describe('text-scale tokens (UX-101)', () => {
  const all = cssFiles(srcRoot)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

  // Definitions: `--text-foo:` on the left-hand side.
  const defined = new Set<string>();
  for (const m of all.matchAll(/(--text[\w-]*)\s*:/g)) defined.add(m[1]);

  // References: `var(--text-foo` (a fallback after a comma doesn't change the name).
  const referenced = new Set<string>();
  for (const m of all.matchAll(/var\(\s*(--text[\w-]*)/g)) referenced.add(m[1]);

  it('defines the expected scale steps', () => {
    for (const step of [
      '--text-xs',
      '--text-sm',
      '--text-base',
      '--text-md',
      '--text-lg',
      '--text-xl',
      '--text-2xl',
      '--text-3xl',
    ]) {
      expect(defined.has(step), `${step} should be defined`).toBe(true);
    }
  });

  it('every referenced --text-* token is defined', () => {
    const missing = [...referenced].filter((t) => !defined.has(t));
    expect(missing, `undefined text tokens referenced: ${missing.join(', ')}`).toEqual([]);
  });
});

// UX-102 guard: the legacy token names were hard-cut to semantic names
// (--text → --text-primary, --text2 → --text-secondary, --text3 → --text-muted,
// --surface2 → --surface-raised, --border2 → --border-strong). No aliases were
// kept, so any straggler definition or reference would silently resolve to
// nothing (or a fallback). Boundary-aware: bare `--text` must not match
// `--text-primary` or the size scale (`--text-xs` … `--text-3xl`).
describe('dead legacy tokens (UX-102)', () => {
  const files = cssFiles(srcRoot);
  const dead = [
    /--text2(?![\w-])/,
    /--text3(?![\w-])/,
    /--surface2(?![\w-])/,
    /--border2(?![\w-])/,
    /--text(?![\w-])/,
  ];

  it('no CSS file defines or references a legacy token name', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const css = readFileSync(file, 'utf8');
      for (const re of dead) {
        const m = css.match(new RegExp(re.source, 'g'));
        if (m) offenders.push(`${file}: ${m.length}x ${re.source}`);
      }
    }
    expect(offenders, `legacy tokens found:\n${offenders.join('\n')}`).toEqual([]);
  });
});
