// @vitest-environment node
//
// E1006: every *Note a GeneratedDeck can carry must be copied by
// assembleBuildReport, or it is generated and never shown. The generator grew
// one bespoke note after another, and a missed copy fails silently.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('GeneratedDeck notes reach the build report', () => {
  const types = read('../../types/index.ts');
  const start = types.indexOf('export interface GeneratedDeck extends');
  const body = types.slice(start, types.indexOf('\n}\n', start));
  const noteKeys = [...body.matchAll(/^ {2}(\w*Notes?)\??:/gm)].map((m) => m[1]);
  const assembler = read('./buildReport.ts');

  it('finds the note fields', () => {
    expect(noteKeys.length).toBeGreaterThan(20);
  });

  it.each(noteKeys)('copies %s', (key) => {
    expect(assembler).toContain(`generated.${key}`);
  });

  it('copies targetMisses', () => {
    expect(assembler).toContain('generated.targetMisses');
  });
});
