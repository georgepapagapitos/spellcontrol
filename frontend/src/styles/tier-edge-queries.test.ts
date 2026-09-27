/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// The tiers are phone ≤599 · tablet 600–1023 · desktop ≥1024 (STYLE_GUIDE
// § Responsive). A `max-width: 600px` query and a `min-width: 600px` query
// both match at exactly 600px, so at that width a page ran its phone rules
// and its tablet rules together; 1024 had the same seam. 57 stylesheet
// queries and four matchMedia strings sat on the seam before this guard.
// A width query that closes a tier ends at 599 or 1023 (or `width < 600px`).
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEAM = /max-width:\s*(600|1024)px|width\s*<=\s*(600|1024)px/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(css|tsx?)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('tier-edge width queries', () => {
  it('no query closes a tier on the next tier’s first pixel', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(srcRoot)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const isQuery = file.endsWith('.css')
          ? /@media|@container/.test(line)
          : /['"`][^'"`]*\(/.test(line);
        if (isQuery && SEAM.test(line)) offenders.push(`${relative(srcRoot, file)}:${i + 1}`);
      });
    }
    expect(offenders, `End the tier at 599px / 1023px:\n${offenders.join('\n')}`).toEqual([]);
  });
});
