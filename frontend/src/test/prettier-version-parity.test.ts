/**
 * Every package formats with the same prettier the commit hook uses.
 *
 * The husky pre-commit runs lint-staged with the ROOT prettier, but each
 * package's `format:check` (the one CI enforces) runs its OWN pinned prettier.
 * When a dependabot group bumped the root and the shared packages to 3.9.8 and
 * left frontend and backend on 3.8.3, the two versions disagreed on 17 files:
 * the hook rewrote any of them on commit, and CI then failed the commit it had
 * just formatted. Dependabot updates these directories in separate groups, so
 * a partial bump is the normal failure, not a freak one. This fails that PR.
 *
 * Fix when it fails: move every listed package.json to the same prettier range
 * (and run `npm run format --prefix <pkg>` for the ones that moved).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PACKAGES = [
  '.',
  'frontend',
  'backend',
  'packages/game-core',
  'packages/binder-routing',
  'packages/deck-metrics',
];

const read = (pkg: string, file: string) =>
  JSON.parse(readFileSync(join(repoRoot, pkg, file), 'utf8')) as Record<string, never>;

/** The declared range AND the version the lockfile installs: a patch release
 *  can format differently, so matching ranges alone isn't enough. */
function prettierOf(pkg: string): string {
  const json = read(pkg, 'package.json') as {
    devDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  const lock = read(pkg, 'package-lock.json') as {
    packages?: Record<string, { version?: string }>;
  };
  const range = json.devDependencies?.prettier ?? json.dependencies?.prettier;
  return `${range} (installs ${lock.packages?.['node_modules/prettier']?.version})`;
}

describe('prettier version parity', () => {
  it('every package pins and installs the same prettier as the root commit hook', () => {
    const root = prettierOf('.');
    expect(root).toMatch(/^\^?\d+\.\d+\.\d+ \(installs \d+\.\d+\.\d+\)$/);
    for (const pkg of PACKAGES) expect({ [pkg]: prettierOf(pkg) }).toEqual({ [pkg]: root });
  });
});
