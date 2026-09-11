/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Guard for the post-generation sheet: its body stacks the build report and
// the AI refine slot as siblings, and neither child owns a top margin (the
// refine panel gets its gap from the bento grid on the Coach tab). The sheet
// body must therefore space its children itself, or the refine panel lands
// flush against the last "Overbuilt roles" pill row.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('build report sheet body spacing', () => {
  const css = readFileSync(join(srcRoot, 'components', 'deck', 'BuildReportSheet.css'), 'utf8');
  const body = /\.build-report-sheet-body\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

  it('stacks the report and the refine slot with a token gap', () => {
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/flex-direction:\s*column/);
    expect(body).toMatch(/gap:\s*var\(--space-\d\)/);
  });
});
