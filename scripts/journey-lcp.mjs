// Welcome-route lab check (E1094): a signed-out cold visit of `/` at phone and
// desktop, LCP over several runs, the LCP element, and, when it is an image,
// its format and whether the browser could find it in the initial HTML.
//
// A lab number from one runner is not field data (the vitals beacon, T115, is
// the real-user source). This is the tripwire: it fails the nightly when the
// median LCP passes LCP_CEILING_MS or when the LCP image is only discoverable
// after the app's JS has run, which is how the hero lost 1.9 s on 2026-11-01.
//
// Used by journey.mjs (`--lcp`); also runnable on its own, GET-only, against
// any origin:
//
//   node scripts/journey-lcp.mjs --base https://spellcontrol.com --browser chrome
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { TIERS, executable } from './journey-browser.mjs';
import { LCP_CEILING_MS, LCP_RUNS, imageFormat, judgeTier } from './journey-lcp-judge.mjs';

export {
  HERO_ART_URLS,
  LCP_CEILING_MS,
  LCP_DISCOVERY_ENFORCED,
  LCP_RUNS,
  discoveredInHtml,
  imageFormat,
  isHeroArt,
  judgeTier,
} from './journey-lcp-judge.mjs';

async function oneRun(browser, base, tier) {
  const context = await browser.createBrowserContext(); // cold: no cache, no storage
  const page = await context.newPage();
  try {
    await page.setViewport(TIERS[tier]);
    const types = new Map();
    page.on('response', (r) => types.set(r.url(), r.headers()['content-type'] ?? ''));
    await page.evaluateOnNewDocument(() => {
      window.__lcp = null;
      new PerformanceObserver((list) => {
        const e = list.getEntries().at(-1);
        if (!e) return;
        window.__lcp = {
          lcp: e.startTime,
          url: e.url || null,
          tag: e.element?.tagName ?? null,
          early: e.element?.getAttribute?.('fetchpriority') ?? null,
        };
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    });
    await page.goto(`${base}/`, { waitUntil: 'networkidle2', timeout: 60_000 });
    // Input ends LCP observation; wait for the last candidate to settle instead.
    await new Promise((r) => setTimeout(r, 2000));
    const l = await page.evaluate(() => window.__lcp);
    return {
      lcp: l?.lcp ?? NaN,
      tag: l?.tag ?? null,
      imageUrl: l?.url || null,
      fetchPriority: l?.early ?? null,
      format: l?.url ? imageFormat(types.get(l.url), l.url) : null,
    };
  } finally {
    await context.close();
  }
}

/** Measure every tier. Returns { tiers: {phone:{...}}, failures: [] }. */
export async function lcpCheck({ base, browserName = 'chrome', tiers = ['phone', 'desktop'] }) {
  // The HTML as the server sends it, the way a preload scanner reads it. GET only.
  const html = await (await fetch(`${base}/`)).text();
  const browser = await puppeteer.launch({
    browser: browserName,
    executablePath: executable(browserName),
    headless: true,
    args: browserName === 'firefox' ? [] : ['--no-first-run', '--disable-gpu'],
  });
  const out = { tiers: {}, failures: [], advisories: [] };
  try {
    for (const tier of tiers) {
      const runs = [];
      for (let i = 0; i < LCP_RUNS; i++) runs.push(await oneRun(browser, base, tier));
      const verdict = judgeTier(tier, runs, html);
      out.tiers[tier] = { ceilingMs: LCP_CEILING_MS[tier], runs, ...verdict };
      for (const f of verdict.failures) out.failures.push(`welcome ${tier}: ${f}`);
      for (const a of verdict.advisories) out.advisories.push(`welcome ${tier}: ${a}`);
    }
  } finally {
    await browser.close();
  }
  return out;
}

export async function writeLcpReport(outDir, result) {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'lcp.json'), JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const base = opt('--base', 'http://localhost:3737').replace(/\/$/, '');
  const result = await lcpCheck({ base, browserName: opt('--browser', 'chrome') });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.failures.length ? 1 : 0);
}
