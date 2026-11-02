// @vitest-environment node
/**
 * Guard: the Commander bracket checker (E1090) is a public, signed-out route.
 * App.tsx has two route trees, one for while auth is still resolving and one
 * for guests and signed-in users. A public page missing from the first one
 * renders the boot splash to a crawler or a first-time visitor until auth
 * answers, and a page missing from the second is not reachable at all. The
 * route must also be lazy, so the tag data and estimator stay off the boot path.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(resolve(src, 'App.tsx'), 'utf8');

describe('/bracket public route', () => {
  it('is declared in both route trees, ahead of any auth redirect', () => {
    const routes = [
      ...app.matchAll(/<Route path="\/bracket" element=\{<BracketCheckerPage \/>\} \/>/g),
    ];
    expect(routes).toHaveLength(2);
    const resolving = app.indexOf("status === 'unknown' || status === 'loading'");
    expect(resolving).toBeGreaterThan(-1);
    expect(routes[0].index).toBeGreaterThan(resolving);
    expect(app.indexOf('path="/admin"')).toBeGreaterThan(routes[1].index ?? 0);
  });

  it('loads the page lazily', () => {
    expect(app).toMatch(
      /const BracketCheckerPage = lazyPage\(\s*\(\) => import\('\.\/pages\/BracketCheckerPage'\)/
    );
    expect(app).not.toMatch(/^import .*BracketCheckerPage/m);
  });

  it('is linked from the methodology page', () => {
    const guide = readFileSync(
      resolve(src, '..', 'public', 'guides', 'bracket-estimator.html'),
      'utf8'
    );
    expect(guide).toContain('href="/bracket"');
  });
});
