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

export const LCP_RUNS = 3;
// Median LCP ceilings in ms per tier. Set from three runs of three cold
// visits per tier against production on 2026-11-02 (Chrome, unthrottled, from
// a Mac): median of each run set was phone 972 / 628 / 588 ms and desktop
// 616 / 560 / 572 ms. The ceiling is the worst of those x 1.5, rounded up to
// the next 250 ms.
export const LCP_CEILING_MS = { phone: 1500, desktop: 1000 };
// The hero art is named in the initial HTML (E1105): an inline script in
// index.html preloads today's pick from a static table. A LCP image that only
// the app's JS can find fails the nightly.
export const LCP_DISCOVERY_ENFORCED = true;

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Image format from the response content type, falling back to the extension. */
export function imageFormat(contentType, url) {
  const ct = /image\/([a-z0-9.+-]+)/i.exec(contentType ?? '');
  if (ct) return ct[1].toLowerCase();
  const ext = /\.([a-z0-9]+)(?:$|[?#])/i.exec(url ?? '');
  return ext ? ext[1].toLowerCase() : 'unknown';
}

/**
 * Whether the initial HTML (what the server sent, before any script ran) lets
 * the preload scanner find `imageUrl`: a `<link rel=preload as=image>` for it,
 * or an `<img>` for it in the markup, or an inline script that creates that
 * preload (the hero's art rotates by day, so the markup cannot name one URL:
 * the script holds the table and runs before any module).
 */
export function discoveredInHtml(html, imageUrl) {
  if (!imageUrl) return false;
  const bare = imageUrl.split('?')[0];
  const mentions = (tag) => tag.includes(bare) || tag.includes(imageUrl);
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  if (links.some((t) => /\brel=["']?preload/i.test(t) && /\bas=["']?image/i.test(t) && mentions(t)))
    return true;
  if ((html.match(/<img\b[^>]*>/gi) ?? []).some(mentions)) return true;
  return (html.match(/<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi) ?? []).some(
    (t) => mentions(t) && /preload/.test(t) && /\bas\s*=\s*['"]image['"]/.test(t)
  );
}

/**
 * Pass/fail for one tier's runs. Pure, so the nightly's rule is testable.
 * `runs` are { lcp, imageUrl, tag }.
 */
export function judgeTier(tier, runs, html) {
  const lcps = runs.map((r) => r.lcp).filter((n) => Number.isFinite(n));
  const med = lcps.length ? median(lcps) : null;
  const failures = [];
  const advisories = [];
  if (med === null) failures.push('no LCP entry recorded');
  else if (med > LCP_CEILING_MS[tier])
    failures.push(
      `median LCP ${Math.round(med)} ms is over the ${LCP_CEILING_MS[tier]} ms ceiling`
    );
  const imageUrl = runs.find((r) => r.imageUrl)?.imageUrl ?? null;
  if (imageUrl && !discoveredInHtml(html, imageUrl))
    (LCP_DISCOVERY_ENFORCED ? failures : advisories).push(
      'the LCP image is not discoverable from the initial HTML (no preload, no <img>)'
    );
  return { medianLcp: med, failures, advisories };
}

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
