import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Structural guard: every outbound `fetch(` in backend/src carries an abort `signal`.
 * undici's default is minutes, so a stalled upstream (Scryfall, MTGJSON, ...) would
 * hold a retry loop or an in-flight dedupe promise that long (E1074).
 *
 * Fix a failure by adding `signal: AbortSignal.timeout(ms)` to the call. Bulk
 * downloads (hundreds of MB, streamed) are the only exemption: a total timeout would
 * kill healthy transfers, so they carry a `// fetch-timeout-exempt: <why>` comment on
 * the line above the call.
 */
const EXEMPT_MARKER = 'fetch-timeout-exempt';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

/** Text of each `fetch(...)` call (balanced parens), with its 1-based line. */
function fetchCalls(src: string): { line: number; text: string }[] {
  const calls: { line: number; text: string }[] = [];
  const re = /(?<![.\w])fetch\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const prefix = src.slice(lineStart, m.index).trim();
    if (prefix.startsWith('//') || prefix.startsWith('*')) continue;
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) break;
    }
    const line = src.slice(0, m.index).split('\n').length;
    const above = src.split('\n')[line - 2] ?? '';
    if (above.includes(EXEMPT_MARKER)) continue;
    calls.push({
      line,
      text: src.slice(m.index, i + 1),
    });
  }
  return calls;
}

describe('outbound fetch timeouts', () => {
  it('every fetch( passes a signal unless it is an allow-listed bulk download', () => {
    const root = __dirname;
    const bare: string[] = [];
    for (const file of sourceFiles(root)) {
      const rel = relative(root, file).replace(/\\/g, '/');
      for (const c of fetchCalls(readFileSync(file, 'utf8'))) {
        if (!/\bsignal\b/.test(c.text)) bare.push(`${rel}:${c.line}`);
      }
    }
    expect(bare).toEqual([]);
  });

  it('the call scanner sees a bare fetch and a signalled one', () => {
    expect(fetchCalls(`await fetch(url, { headers: h });`)[0].text).not.toMatch(/signal/);
    expect(fetchCalls(`await fetch(url, { signal: AbortSignal.timeout(5) });`)[0].text).toMatch(
      /signal/
    );
    expect(fetchCalls(`// fetch(x)\n * fetch(y)\nobj.fetch(z)`)).toEqual([]);
  });
});
