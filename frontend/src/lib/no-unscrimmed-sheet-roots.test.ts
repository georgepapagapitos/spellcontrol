import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Guard: every sheet on the shared card-picker shell dims the page BY
 * CONSTRUCTION — the scrim lives on `:where(.card-picker-root)` in
 * binder-card-management.css, so a new sheet can't ship unscrimmed no matter
 * how it composes its classes. `:where()` keeps the rule at zero specificity
 * so a scoped root class that deliberately wants a stronger dim
 * (.pull-list-root, .deck-tokens-root → var(--overlay)) wins regardless of
 * import order. See STYLE_GUIDE.md "Overlays".
 *
 * History: under the old two-place convention (scoped root class + co-located
 * background rule) the scrim shipped missing FOUR audits running — E95 #1048,
 * E99, WelcomeDigest (#1113), then eight more latent sheets found the next day
 * (#1114) — before being moved to the shell. This test pins the shell rule and
 * the companion invariant that `.card-picker-backdrop` (the click-to-close
 * child some sheets render) carries no background of its own, which would
 * double-stack the alpha on top of the root's scrim.
 */

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const shellCss = readFileSync(join(srcRoot, 'styles', 'binder-card-management.css'), 'utf8');

describe('the card-picker shell dims the page by construction', () => {
  it('keeps the zero-specificity scrim on the shell root', () => {
    expect(
      shellCss,
      'Restore `:where(.card-picker-root) { background: var(--overlay-sheet); }` — every card-picker sheet relies on it for its scrim'
    ).toMatch(/:where\(\.card-picker-root\)\s*\{[^}]*background:\s*var\(--overlay-sheet\)/);
  });

  it('keeps .card-picker-backdrop background-free (no double-stacked dim)', () => {
    const backdropRule = shellCss.match(/\.card-picker-backdrop\s*\{[^}]*\}/)?.[0] ?? '';
    expect(
      backdropRule,
      'The scrim lives on the root; a background here stacks a second alpha layer on top of it'
    ).not.toMatch(/background/);
  });
});
