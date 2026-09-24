// @vitest-environment node
/**
 * Guard: the account banners share the viewport with the page, they do not
 * sit on top of a second full viewport (E379).
 *
 * `RecoveryBanner` and `AutoLinkBanner` render as `#root`'s first children,
 * above the page root. The shell used to be its own `height: 100dvh` under
 * them, so with a banner showing the document was (banner + 100dvh) tall.
 * Measured at 360x780 with the recovery banner up: the document was 903px,
 * the phone tab bar sat at 847-903 (entirely below the screen), and every
 * `scrollIntoView` scrolled that 123px of overflow and slid the sticky banner
 * over its target: the "Deck stats" jump landed under "Confirm email".
 *
 * jsdom does not lay out, so no render test sees this. Reading the
 * stylesheets is what is left. Fix for a failure here: keep `#root` a 100dvh
 * flex column, let the page root fill the rest (`flex: 1 1 auto;
 * min-height: 0`, never its own `height: 100dvh`), and keep the banners
 * `flex: none` and unpositioned.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const baseLayout = readFileSync(join(dir, 'base-layout.css'), 'utf8');
const dialogs = readFileSync(join(dir, 'modals-dialogs.css'), 'utf8');

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): string {
  // Every regex metacharacter, backslash included, as the sibling guards do
  // (CodeQL js/incomplete-sanitization flagged the old `.#`-only escape).
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  expect(match, `${selector} rule not found`).not.toBeNull();
  return match![1];
}

describe('#root is the viewport', () => {
  it('is a 100dvh flex column', () => {
    const root = rule(baseLayout, '#root');
    expect(root).toMatch(/display:\s*flex/);
    expect(root).toMatch(/flex-direction:\s*column/);
    expect(root).toMatch(/height:\s*100dvh/);
  });

  it('lets the shell fill the rest instead of taking another full viewport', () => {
    const shell = rule(baseLayout, '.app-shell');
    expect(shell).toMatch(/flex:\s*1 1 auto/);
    expect(shell).toMatch(/min-height:\s*0/);
    expect(shell).not.toMatch(/(?:^|[\s;])height:\s*100d?vh/);
  });

  it.each(['.recovery-banner', '.auto-link-banner'])(
    '%s is a row above the page, never stuck over it',
    (selector) => {
      const banner = rule(dialogs, selector);
      expect(banner).toMatch(/flex:\s*none/);
      expect(banner).not.toMatch(/position:\s*(sticky|fixed|absolute)/);
    }
  );
});
