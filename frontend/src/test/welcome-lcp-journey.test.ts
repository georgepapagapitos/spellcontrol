// Guard for E1094: the welcome route's LCP was only ever measured by hand
// (4.4 s in a single simulated run, 2026-11-01) and nothing watched it. The
// nightly journey must keep a signed-out cold visit of `/` that takes the median
// LCP over several runs, names the LCP element and image format, and fails when
// the median passes a ceiling. The module is read as text: importing it would
// pull in puppeteer-core, which the frontend install does not have.
// If this fails, restore the check: scripts/journey-lcp.mjs, the `--lcp` branch
// in scripts/journey.mjs, and the "Welcome route LCP" step in
// .github/workflows/nightly-journey.yml. Raising a ceiling needs fresh measured
// runs of production in the commit message, not a guess.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: plain .mjs with no types, outside the frontend tree
import { judgeTier } from '../../../scripts/journey-lcp-judge.mjs';

const root = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');
// The check is split: journey-lcp.mjs measures, journey-lcp-judge.mjs holds the rule.
const lcp = read('scripts/journey-lcp.mjs') + read('scripts/journey-lcp-judge.mjs');
const journey = read('scripts/journey.mjs');
const workflow = read('.github/workflows/nightly-journey.yml');

describe('welcome route LCP nightly check', () => {
  it('measures at phone and desktop with a median over at least 3 runs', () => {
    expect(lcp).toMatch(/LCP_RUNS = ([3-9]|\d\d)\b/);
    expect(lcp).toContain("tiers = ['phone', 'desktop']");
    expect(lcp).toContain('largest-contentful-paint');
    expect(lcp).toContain('createBrowserContext'); // cold: fresh storage per run
  });
  it('has a numeric ceiling per tier, and fails the run when the median passes it', () => {
    const m = lcp.match(/LCP_CEILING_MS = \{ phone: (\d+), desktop: (\d+) \}/);
    expect(m).not.toBeNull();
    const [phone, desktop] = [Number(m![1]), Number(m![2])];
    // Sanity bounds: a ceiling above 6 s is no longer a check, below 500 ms is a flake.
    for (const ms of [phone, desktop]) {
      expect(ms).toBeGreaterThanOrEqual(500);
      expect(ms).toBeLessThanOrEqual(6000);
    }
    expect(lcp).toContain('median LCP');
    expect(journey).toContain('process.exit(result.failures.length ? 1 : 0)');
  });
  it('records the LCP element and, for an image, its format and HTML discoverability', () => {
    expect(lcp).toContain('export function imageFormat');
    expect(lcp).toContain('export function discoveredInHtml');
    expect(lcp).toContain('LCP_DISCOVERY_ENFORCED');
  });
  it('enforces HTML discoverability of the LCP image (E1105)', () => {
    expect(lcp).toContain('export const LCP_DISCOVERY_ENFORCED = true;');
  });
  it('is wired into journey.mjs as --lcp and into the nightly workflow', () => {
    expect(journey).toContain("argv.includes('--lcp')");
    expect(journey).toContain("from './journey-lcp.mjs'");
    expect(workflow).toContain('- name: Welcome route LCP (Chrome)');
    expect(workflow).toMatch(/journey\.mjs [^\n]*--lcp /);
    expect(workflow).toContain('journey-lcp');
  });
});

// E1107: on 2026-11-02 the check failed while today's hero was preloaded,
// because a live deck tile's art (Yennett) outsized the hero and became the
// LCP. No HTML can name live content, so that is an advisory; the hero itself
// must still be discoverable, and the HTML must preload a hero.
describe('discoverability is judged on the hero only', () => {
  const HERO = 'https://cards.scryfall.io/art/front/a/5/hero.webp?1';
  const TILE = 'https://cards.scryfall.io/art/front/0/b/tile.webp?2';
  const preloadHtml = `<script>var u=["${HERO.split('?')[0]}"];var l=document.createElement('link');l.rel='preload';l.as='image';</script>`;
  const run = (imageUrl: string) => ({ lcp: 400, imageUrl, tag: 'IMG' });

  it('a live tile as the LCP is an advisory when the hero is preloaded', () => {
    const v = judgeTier('phone', [run(TILE), run(HERO), run(TILE)], preloadHtml, [HERO]);
    expect(v.failures).toEqual([]);
    expect(v.advisories.join(' ')).toContain('not the hero');
  });
  it('fails when the hero is the LCP and the HTML cannot name it', () => {
    const v = judgeTier('phone', [run(HERO)], '<html></html>', [HERO]);
    expect(v.failures.join(' ')).toContain('not discoverable');
  });
  it('fails when the LCP is a tile and the HTML preloads no hero at all', () => {
    const v = judgeTier('desktop', [run(TILE)], '<html></html>', [HERO]);
    expect(v.failures.join(' ')).toContain('preloads no hero');
  });
  it('still fails on a slow median whatever the element', () => {
    const v = judgeTier('desktop', [{ ...run(TILE), lcp: 5000 }], preloadHtml, [HERO]);
    expect(v.failures.join(' ')).toContain('over the');
  });
});
