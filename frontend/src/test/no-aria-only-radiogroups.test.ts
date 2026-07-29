// @vitest-environment node
//
// Guard: an exclusive-value picker uses NATIVE radios, never hand-rolled ARIA.
//
// STYLE_GUIDE ("An exclusive-value picker is NOT a tab strip") already mandates
// a `fieldset` of visually-hidden `<input type="radio">`s stretched over styled
// labels. Thirteen components ignored it and hand-rolled
// `role="radiogroup"` + `role="radio"` buttons instead — and every single one
// of them shipped with ZERO arrow-key handling and ZERO roving tabindex.
//
// That is the exact failure the guide condemns for tabs: "Partial ARIA … is
// worse than none: it advertises a contract the component then fails to
// honor." Concretely it meant a 7-swatch colour picker ate 7 tab stops instead
// of 1, and a screen reader announced "radio group, 1 of 7" and then ignored
// the arrows. Native radios carry exclusivity, arrow-key nav and a single group
// tab stop for free, with no JS at all.
//
// So: no `role="radiogroup"` / `role="radio"` in app source. If a future case
// genuinely cannot use native inputs, it must also implement roving tabindex +
// arrow keys — and then this guard should gain a documented exemption rather
// than being deleted.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const selfPath = fileURLToPath(import.meta.url);
const srcDir = resolve(dirname(selfPath), '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/** Comments legitimately mention the old pattern to explain why it's gone. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('exclusive-value pickers use native radios', () => {
  it('no component hand-rolls role="radiogroup" / role="radio"', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(srcDir)) {
      if (file === selfPath) continue;
      const code = stripComments(readFileSync(file, 'utf8'));
      if (/role=["']radiogroup["']/.test(code) || /role=["']radio["']/.test(code)) {
        offenders.push(file.slice(srcDir.length + 1));
      }
    }

    expect(
      offenders,
      'These components hand-roll ARIA radio semantics. Use a <fieldset> of ' +
        'visually-hidden <input type="radio"> over styled labels (STYLE_GUIDE ' +
        '"exclusive-value picker"; reference: .settings-currency-toggle) — it ' +
        'gives exclusivity, arrow-key nav and one group tab stop for free.\n  ' +
        offenders.join('\n  ')
    ).toEqual([]);
  });
});
