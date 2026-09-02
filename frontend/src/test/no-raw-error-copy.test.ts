/**
 * Lint-style gate for user-facing error copy (frontend/STYLE_GUIDE.md § Voice).
 *
 * A string that starts "Failed to …", says "Request failed", or quotes a bare
 * HTTP status is transport noise, not something a person can act on. Every
 * error a person sees should say what happened and what to do, with
 * contractions ("Couldn't load your trades. Check your connection and try
 * again."). This scans the source for literals that violate that and fails on
 * any new one, so the copy sweep that removed them can't quietly regress.
 *
 * Deliberately narrow to avoid false positives:
 *   - only quoted string literals (single, double, template) are inspected;
 *   - a line whose literal feeds `logger.*` / `console.*` is skipped — console
 *     text is for developers and may name the raw failure;
 *   - comment lines are skipped;
 *   - test files are skipped.
 * A line can opt out with `// raw-error-copy: <why>` when the literal is not
 * user-facing (none needed today).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'test') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const RAW = [/^["'`]Failed to /, /Request failed/, /\bHTTP \d{3}\b/, /\bHTTP \$\{/];

function violations(): string[] {
  const found: string[] = [];
  for (const file of walk(SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      if (/\b(logger|console)\.\w+\(/.test(line)) return;
      if (/raw-error-copy:/.test(line)) return;
      for (const lit of line.match(LITERAL) ?? []) {
        if (RAW.some((re) => re.test(lit))) {
          found.push(`${path.relative(SRC, file)}:${i + 1}: ${lit}`);
        }
      }
    });
  }
  return found;
}

describe('user-facing error copy', () => {
  it('has no "Failed to …" / "Request failed" / bare HTTP-status strings', () => {
    expect(violations()).toEqual([]);
  });
});
