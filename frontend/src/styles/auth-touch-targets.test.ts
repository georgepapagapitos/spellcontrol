/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'auth.css'), 'utf8');
const pages = join(here, '..', 'pages');

/**
 * The auth surface is the app's front door, and it is the one place a user
 * arrives already frustrated (wrong password, expired link, new device). Its
 * controls are thumb targets like any other.
 *
 * This guard exists because the coarse-pointer floor in auth.css was applied
 * by hand and missed one of the two footer links: `.auth-forgot-link` shipped
 * as a bare 101x23 text link — no padding, no min-height, no ::after ghost —
 * at BOTH phone and desktop, while its sibling `.auth-back` right underneath
 * got the full treatment. Measured with .claude/tools/auth-measure.mjs during
 * the page-by-page playtest sweep (batch 1), not spotted by reading the CSS.
 *
 * So the assertion is deliberately NOT a list of selectors: it reads the auth
 * pages' own markup and requires every interactive `auth-*` control it finds
 * to appear inside a `(pointer: coarse)` block. A new control added to the
 * auth card fails this test until it is floored.
 */

const AUTH_PAGES = [
  'AuthPage.tsx',
  'ForgotPasswordPage.tsx',
  'ResetPasswordPage.tsx',
  'VerifyEmailPage.tsx',
  'ChooseUsernamePage.tsx',
];

/** Bodies of every `@media (pointer: coarse)` block in the sheet, joined. */
function coarseBlocks(sheet: string): string {
  const out: string[] = [];
  const re = /@media\s*\(pointer:\s*coarse\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sheet))) {
    // Walk braces from the block's opening `{` so nested rules are included.
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < sheet.length && depth > 0) {
      if (sheet[i] === '{') depth++;
      else if (sheet[i] === '}') depth--;
      i++;
    }
    out.push(sheet.slice(start, i - 1));
  }
  return out.join('\n');
}

/**
 * One entry per interactive element (`<button>`, `<a>`, `<Link>`, and the
 * `Button`/`IconButton` primitives that render them) on the auth pages,
 * holding the `auth-*` classes it carries. Per ELEMENT, not per class:
 * a control styled `auth-submit auth-submit-link` is floored by `.auth-submit`,
 * so demanding a floor on every individual token fails a control that is
 * already fine. Literal `className="..."` only — a computed/template className
 * would be missed, so keep auth markup literal. Attribute values in braces
 * (`icon={<Mail width={14} />}`) are skipped over, so a `>` inside one does not
 * end the tag early.
 */
function interactiveAuthElements(): { where: string; classes: string[] }[] {
  const out: { where: string; classes: string[] }[] = [];
  const seen = new Set<string>();
  for (const file of AUTH_PAGES) {
    let src: string;
    try {
      src = readFileSync(join(pages, file), 'utf8');
    } catch {
      continue; // page renamed or removed — not this guard's business
    }
    const tag =
      /<(?:button|a|Link|Button|IconButton)\b(?:\{(?:[^{}]|\{[^{}]*\})*\}|[^>{])*?className="([^"]+)"/g;
    for (const m of src.matchAll(tag)) {
      const classes = m[1].split(/\s+/).filter((c) => c.startsWith('auth-'));
      if (!classes.length) continue;
      const key = classes.join(' ');
      if (seen.has(key)) continue; // same control reused across pages
      seen.add(key);
      out.push({ where: `${file}: .${key.replace(/ /g, '.')}`, classes });
    }
  }
  return out.sort((a, b) => a.where.localeCompare(b.where));
}

describe('auth surface touch targets', () => {
  const coarse = coarseBlocks(css);

  it('finds the auth pages and their interactive controls', () => {
    // Guard the guard: if the markup scan silently returns nothing, every
    // assertion below passes vacuously and the floor is unprotected again.
    expect(interactiveAuthElements().length).toBeGreaterThan(1);
    expect(coarse.length).toBeGreaterThan(0);
  });

  it.each(interactiveAuthElements().map((e) => [e.where, e.classes] as const))(
    '%s has a coarse-pointer floor',
    (where, classes) => {
      // Only controls auth.css actually styles are this sheet's business; one
      // borrowing a shared component class (.pill-btn etc.) is floored there.
      const styledHere = classes.filter((c) => new RegExp(`\\.${c}\\b`).test(css));
      if (!styledHere.length) return;
      expect(
        styledHere.some((c) => new RegExp(`\\.${c}\\b`).test(coarse)),
        `${where} is an interactive control on the auth surface and none of its classes ` +
          `has a rule inside @media (pointer: coarse) in auth.css. Add one to the shared ` +
          `floor group (min-height: 44px) or give it a >=44px ::after ghost.`
      ).toBe(true);
    }
  );

  it('the floor group actually sets 44px, not just any declaration', () => {
    const group = coarse.match(/\.auth-submit[^{]*\{([^}]*)\}/);
    expect(group, 'the shared coarse floor group is gone').toBeTruthy();
    expect(group![1]).toMatch(/min-height:\s*44px/);
  });

  it('.auth-forgot-link clears 24px with a FINE pointer too', () => {
    // WCAG 2.5.8 applies to every pointer type. Measured at 101x23 with a
    // mouse — one pixel under — while the coarse floor only covers thumbs.
    const base = css.match(/\n\.auth-forgot-link\s*\{([^}]*)\}/);
    expect(base, '.auth-forgot-link base rule is gone').toBeTruthy();
    const minH = base![1].match(/min-height:\s*(\d+)px/);
    expect(minH, '.auth-forgot-link has no pointer-agnostic min-height').toBeTruthy();
    expect(Number(minH![1])).toBeGreaterThanOrEqual(24);
    expect(base![1]).toMatch(/display:\s*(inline-)?flex/);
  });

  it('the text links grow their box around the text', () => {
    // min-height alone does nothing for an inline box — .auth-forgot-link was
    // 23px tall precisely because it is a bare inline <Link>.
    const rule = coarse.match(/\.auth-forgot-link\s*\{([^}]*)\}/);
    expect(rule, '.auth-forgot-link lost its display rule in the coarse block').toBeTruthy();
    expect(rule![1]).toMatch(/display:\s*(inline-)?flex/);
  });
});

describe('auth card centring', () => {
  it('.auth-back centres with a mechanism that works in a block parent', () => {
    // It previously used `align-self: center`, which is inert: its parent is
    // `.auth-card` (display: block). Only `.auth-forgot-link` sits in the flex
    // `.auth-form`. The dismiss link rendered ~70px left of the card's centre.
    const rule = css.match(/\n\.auth-back\s*\{([^}]*)\}/);
    expect(rule, '.auth-back rule is gone').toBeTruthy();
    const body = rule![1];
    expect(
      /margin-inline:\s*auto/.test(body) || /margin:\s*[^;]*auto/.test(body),
      '.auth-back must centre via margin-inline: auto — `align-self` is inert ' +
        'inside `.auth-card`, which is display: block.'
    ).toBe(true);
    expect(
      /align-self:\s*center/.test(body),
      '.auth-back still declares align-self: center, which does nothing in a block parent — ' +
        'remove it so the next reader does not trust it.'
    ).toBe(false);
  });
});
