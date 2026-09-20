/**
 * One source of truth for "which Comprehensive Rules is this app on" (board E338).
 *
 * The app holds TWO rules corpora, on purpose: the bundled snapshot the
 * reference sheet renders offline (`public/comprehensive-rules.json`, refreshed
 * by the weekly snapshot PR) and the backend's nightly-ingested index the AI
 * Q&A is grounded in. They are different documents with different effective
 * dates, so any surface that prints a date is printing ITS corpus's date — and
 * /rules printed both, one tab apart: "(effective September 25, 2026)" under
 * the Q&A and "Comprehensive Rules, effective August 7, 2026" under the sheet.
 * Two dates for one set of rules; whichever a reader believed, they were being
 * told the other was wrong.
 *
 * The ruling: the app states a CR version in exactly ONE place —
 * `RulesReferenceFoot`, which labels the rules text it actually renders. Every
 * other surface talks about the rules without a date. This guard fails if a
 * second one grows a date again.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const selfPath = fileURLToPath(import.meta.url);
const srcDir = resolve(dirname(selfPath), '..');

/** The one surface allowed to state the version, relative to `src/`. */
const OWNER = join('components', 'RulesReference.tsx');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Comments explain the ruling and name the old copy; only code counts. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the app states one Comprehensive Rules version, in one place', () => {
  it('only the reference footer renders an effective date', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      const rel = file.slice(srcDir.length + 1);
      if (rel === OWNER || file === selfPath) continue;
      const code = stripComments(readFileSync(file, 'utf8'));
      if (/effective\s*\{|effective \$\{|effectiveDate/.test(code)) offenders.push(rel);
    }
    expect(
      offenders,
      'These render a Comprehensive Rules effective date. The reference footer ' +
        '(RulesReference.tsx) is the only surface that may — it labels the rules ' +
        'text actually shown. A second date is a second corpus, and the two ' +
        'contradict each other on screen (E338).'
    ).toEqual([]);
  });

  it('the Q&A disclaimer cites the rules without a competing date', () => {
    const page = readFileSync(join(srcDir, 'pages', 'RulesPage.tsx'), 'utf8');
    expect(page).toContain('Answers cite the official Comprehensive Rules.');
    expect(stripComments(page)).not.toMatch(/effective/);
  });
});
