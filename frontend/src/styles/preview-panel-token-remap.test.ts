/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The card-preview panel is an always-dark surface in BOTH app themes, so
 * `.card-preview-panel-inner` remaps the theme colour tokens to white-alpha
 * for everything inside it. Any colour token a *shared* rule reaches for
 * inside that panel must therefore appear in the remap block — otherwise it
 * silently resolves to the light app theme's value.
 *
 * That is not hypothetical. `--bg` was missing from the remap while the shared
 * form-control rule in forms-banners.css used it as the field fill, so every
 * input in the panel painted as a bright white slab in light themes — and
 * because --text-primary *was* remapped, text typed into it came out
 * white-on-white. It hit the tag input and PrintingPicker's quantity field
 * alike, and would have hit any input added there later.
 *
 * CSS resolves this kind of mismatch silently: no build error, no console
 * warning, and the component's own stylesheet can look perfectly correct while
 * losing to the shared rule on load order. So it gets a CI guard rather than
 * an eyeball.
 */
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Declarations whose value paints a colour — the only ones the always-dark
 *  remap has to cover. Sizing tokens (--radius, --text-base, --space-*) are
 *  theme-independent and must NOT be remapped. */
const COLOUR_PROPERTY =
  /^(color|background|background-color|border|border-color|border-(top|right|bottom|left)-color|outline|outline-color|box-shadow|caret-color|fill|stroke)$/;

function ruleBody(css: string, pattern: RegExp): string {
  const match = css.match(pattern);
  if (!match) throw new Error(`Could not locate rule matching ${pattern}`);
  return match[1];
}

/** Custom properties DEFINED in a rule body (`--x: value`). */
function definedTokens(body: string): Set<string> {
  return new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
}

/** Tokens READ via var() by colour-valued declarations in a rule body. */
function colourTokensRead(body: string): Set<string> {
  const out = new Set<string>();
  for (const decl of body.split(';')) {
    const [rawProp, ...rest] = decl.split(':');
    if (!rawProp || rest.length === 0) continue;
    const prop = rawProp.trim().toLowerCase();
    if (prop.startsWith('--') || !COLOUR_PROPERTY.test(prop)) continue;
    for (const m of rest.join(':').matchAll(/var\(\s*(--[\w-]+)/g)) out.add(m[1]);
  }
  return out;
}

describe('always-dark preview panel token remap', () => {
  const previewCss = readFileSync(join(srcRoot, 'styles/footer-card-preview.css'), 'utf8');
  const formsCss = readFileSync(join(srcRoot, 'styles/forms-banners.css'), 'utf8');

  const remapped = definedTokens(ruleBody(previewCss, /\.card-preview-panel-inner\s*\{([^}]*)\}/));

  it('remaps every colour token the shared form-control rule reads', () => {
    // The `select, input[type='number'], input[type='text'], …` block.
    const controlRule = ruleBody(formsCss, /[^{}]*input\[type='text'\][^{}]*\{([^}]*)\}/);
    const needed = colourTokensRead(controlRule);

    // Sanity: if this ever reads zero colour tokens the regex has drifted and
    // the guard would pass vacuously.
    expect(needed.size).toBeGreaterThan(0);

    const missing = [...needed].filter((t) => !remapped.has(t));
    expect(
      missing,
      `Shared form controls read ${missing.join(', ')} inside the always-dark ` +
        `card-preview panel, but .card-preview-panel-inner does not remap ${
          missing.length === 1 ? 'it' : 'them'
        }. In a light app theme ${
          missing.length === 1 ? 'it resolves' : 'they resolve'
        } to light values, so inputs in the panel render light-on-light. Add ${missing.join(
          ', '
        )} to the remap block in styles/footer-card-preview.css.`
    ).toEqual([]);
  });

  it('keeps --bg remapped specifically (the field fill that regressed)', () => {
    expect(remapped.has('--bg')).toBe(true);
  });

  it('does not remap theme-independent sizing tokens', () => {
    for (const sizing of ['--radius', '--text-base', '--space-1', '--space-2']) {
      expect(remapped.has(sizing)).toBe(false);
    }
  });
});
