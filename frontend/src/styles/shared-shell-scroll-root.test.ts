/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'shared.css'), 'utf8');
const body = (selector: string) =>
  new RegExp(`\\n${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(
    css
  )?.[1];

/**
 * The SharedShell (game night, the pages outside the app shell) is a
 * 100dvh flex column that scrolls itself. Its main landmark must keep its
 * content height: with `min-height: 0` a long page squeezed main to the
 * viewport, the view overflowed it, and the footer, laid out after main's
 * shrunken box, painted over the page (the game night's Going list at 360px,
 * E440). The same bug returns with any declaration that lets main shrink below
 * its content or clips it.
 */
describe('the shared shell scrolls, its main never shrinks', () => {
  it('.shared-shell is the scroll root', () => {
    expect(body('.shared-shell')).toMatch(/overflow-y:\s*auto/);
  });

  it('.shared-shell-main keeps its content height', () => {
    const main = body('.shared-shell-main');
    expect(main, 'no .shared-shell-main rule in shared.css').toBeTruthy();
    expect(main).not.toMatch(/min-height:\s*0/);
    expect(main).not.toMatch(/overflow(-y)?:\s*(hidden|auto|scroll|clip)/);
    expect(main).not.toMatch(/height:\s*\d/);
  });
});
