/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The Game Changers "Custom count" number field is the only input inside an
 * `.option-card`, and it is typed into. A descendant rule `.option-card input`
 * (specificity 0,1,1) once hid every input in the card (opacity 0, stretched
 * over it) for a radio pattern that no longer exists, and beat
 * `.option-card-input` (0,1,0), so the field vanished while the user typed.
 *
 * Fix a failure by scoping the hiding rule to a class the radio actually has,
 * never to a bare `input` descendant of `.option-card`.
 */

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'deck-builder-customizer.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

describe('option-card custom count input', () => {
  it('no rule hides an input inside .option-card', () => {
    const offenders: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = m[1].split(',').map((s) => s.trim());
      const hides = /opacity\s*:\s*0\s*(;|$)/.test(m[2]);
      if (hides && selectors.some((s) => /\.option-card\b(?!-)[^,]*\binput\b/.test(s))) {
        offenders.push(m[1].trim());
      }
    }
    expect(offenders).toEqual([]);
  });

  it('.option-card-input is not given opacity 0', () => {
    const body = /\.option-card-input\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(body).not.toMatch(/opacity\s*:\s*0\s*(;|$)/);
  });
});
