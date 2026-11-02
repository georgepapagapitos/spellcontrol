// Guard for E1105: the welcome hero's art must be named in the initial HTML.
// The pick used to wait on an API lookup after boot, so the browser found the
// page's LCP image late. index.html now carries an inline script (built from
// scripts/welcome-hero-preload.mjs by the vite plugin) that preloads today's
// pick from welcome-hero-art.json, and WelcomeHero renders the same URL.
// If this fails: keep the JSON keys equal to EVERGREEN_COMMANDERS in order,
// keep the script's pick equal to pickWelcomeHeroCard, and re-fetch the art
// URLs (the `art` WebP key from Scryfall) rather than hand-editing them.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dayKey } from '@/lib/collection/value-history';
import { welcomeHeroPreloadScript } from '../../../scripts/welcome-hero-preload.mjs';
import art from './welcome-hero-art.json';
import { EVERGREEN_COMMANDERS, pickWelcomeHeroCard, welcomeHeroArtUrl } from './welcome-hero';

const names = Object.keys(art);
const script = welcomeHeroPreloadScript(names, art);

interface Link {
  rel?: string;
  as?: string;
  href?: string;
  attrs: Record<string, string>;
  setAttribute(k: string, v: string): void;
}

/** Run the inline script as a browser would on `day` at `path`. */
function run(day: Date, path = '/', stored: string | null = null): Link[] {
  const appended: Link[] = [];
  const document = {
    createElement: (): Link => ({
      attrs: {},
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
    }),
    head: { appendChild: (l: Link) => appended.push(l) },
  };
  class FixedDate extends Date {
    constructor() {
      super(day.getTime());
    }
  }
  new Function('location', 'localStorage', 'document', 'Date', script)(
    { pathname: path },
    { getItem: () => stored },
    document,
    FixedDate
  );
  return appended;
}

describe('welcome hero art table', () => {
  it('lists the picker pool in picker order', () => {
    expect(names).toEqual([...EVERGREEN_COMMANDERS]);
  });
  it('holds Scryfall WebP art keys, not the retiring art_crop JPEG', () => {
    for (const url of Object.values(art))
      expect(url).toMatch(/^https:\/\/cards\.scryfall\.io\/art\/front\/.+\.webp\?\d+$/);
  });
  it('resolves every pool name and nothing else', () => {
    for (const n of EVERGREEN_COMMANDERS)
      expect(welcomeHeroArtUrl(n)).toBe(art[n as keyof typeof art]);
    expect(welcomeHeroArtUrl('Not In The Pool')).toBeUndefined();
  });
});

describe('index.html hero preload', () => {
  it('preloads exactly the art the picker chooses, on every day of a year', () => {
    for (let i = 0; i < 400; i++) {
      const day = new Date(2026, 0, 1 + i, 3, 30);
      const [link] = run(day);
      expect(link.rel).toBe('preload');
      expect(link.as).toBe('image');
      expect(link.attrs.fetchpriority).toBe('high');
      expect(link.href).toBe(welcomeHeroArtUrl(pickWelcomeHeroCard(dayKey(day.getTime()))));
    }
  });
  it('does not preload off the landing route or once the device has been past first-run', () => {
    const day = new Date(2026, 5, 1, 12);
    expect(run(day, '/collection')).toHaveLength(0);
    expect(run(day, '/', '1')).toHaveLength(0);
    expect(run(day, '/welcome')).toHaveLength(1);
  });
  it('is injected into index.html by the vite build', () => {
    const cfg = readFileSync(resolve(__dirname, '../../../vite.config.ts'), 'utf8');
    expect(cfg).toContain('welcomeHeroPreloadScript(names, art)');
    expect(cfg).toContain("injectTo: 'head-prepend'");
  });
  it('refuses to build a script for a pool name without art', () => {
    expect(() => welcomeHeroPreloadScript(['Nobody'], {})).toThrow(/no URL/);
  });
});
