// Pure half of the welcome-route lab check (E1094, E1107): the constants and the
// pass/fail rule, with no browser import, so a unit test can load it
// (frontend/src/test/welcome-lcp-journey.test.ts). journey-lcp.mjs measures and
// calls judgeTier.
import { readFileSync } from 'node:fs';

/** The welcome hero's art URLs (the static table the inline preload reads). */
export const HERO_ART_URLS = Object.values(
  JSON.parse(
    readFileSync(new URL('../frontend/src/lib/home/welcome-hero-art.json', import.meta.url), 'utf8')
  )
);

export const LCP_RUNS = 3;
// Median LCP ceilings in ms per tier. Set from three runs of three cold
// visits per tier against production on 2026-11-02 (Chrome, unthrottled, from
// a Mac): median of each run set was phone 972 / 628 / 588 ms and desktop
// 616 / 560 / 572 ms. The ceiling is the worst of those x 1.5, rounded up to
// the next 250 ms.
export const LCP_CEILING_MS = { phone: 1500, desktop: 1000 };
// The hero art is named in the initial HTML (E1105): an inline script in
// index.html preloads today's pick from a static table. When the hero is the
// LCP image and the HTML cannot name it, the nightly fails. When the LCP is
// some other image (a live deck tile's art on the welcome page can outsize the
// hero at a given width), no HTML can name it ahead of time: that is an
// advisory, and the HTML must still preload a hero (E1107, 2026-11-02: the
// check failed on a Yennett deck tile while today's hero was preloaded).
export const LCP_DISCOVERY_ENFORCED = true;

const bareUrl = (u) => (u ?? '').split('?')[0];
/** Whether `url` is one of the hero's art URLs, stamp ignored. */
export function isHeroArt(url, heroUrls = HERO_ART_URLS) {
  const b = bareUrl(url);
  return !!b && heroUrls.some((h) => bareUrl(h) === b);
}

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
export function judgeTier(tier, runs, html, heroUrls = HERO_ART_URLS) {
  const lcps = runs.map((r) => r.lcp).filter((n) => Number.isFinite(n));
  const med = lcps.length ? median(lcps) : null;
  const failures = [];
  const advisories = [];
  if (med === null) failures.push('no LCP entry recorded');
  else if (med > LCP_CEILING_MS[tier])
    failures.push(
      `median LCP ${Math.round(med)} ms is over the ${LCP_CEILING_MS[tier]} ms ceiling`
    );
  const push = (msg) => (LCP_DISCOVERY_ENFORCED ? failures : advisories).push(msg);
  for (const url of [...new Set(runs.map((r) => r.imageUrl).filter(Boolean))]) {
    if (isHeroArt(url, heroUrls)) {
      if (!discoveredInHtml(html, url))
        push('the LCP image is not discoverable from the initial HTML (no preload, no <img>)');
    } else {
      advisories.push(
        `the LCP image is not the hero (${bareUrl(url)}); live content, not preloadable`
      );
      if (!heroUrls.some((h) => discoveredInHtml(html, h)))
        push('the initial HTML preloads no hero art');
    }
  }
  return { medianLcp: med, failures, advisories };
}
