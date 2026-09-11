#!/usr/bin/env node
// Nightly user journey — the app driven in a real browser, end to end.
//
// Registers a fresh account, loads the sample collection through the UI,
// creates a deck through the UI, then walks every hub and deep route the
// router owns, at a phone viewport (touch) and a desktop one, in Chrome and
// in Firefox. For every screen it records what a green unit suite cannot:
//
//   - an uncaught exception or console error on the page
//   - horizontal overflow (the page body must never scroll sideways)
//   - an empty body (a render crash paints nothing, and paints it quietly)
//   - a missing document title
//   - two stacked blocks that touch (a host that forgot its gap — see
//     touchingSiblings below)
//   - a screenshot, so a failure comes with the picture
//
// Any of the first five fails the run. Screenshots + report.json land in
// --out. Run by .github/workflows/nightly-journey.yml against a production
// build served by the backend; locally:
//
//   node scripts/journey.mjs --base http://localhost:3742 --browser chrome --out /tmp/journey
//   node scripts/journey.mjs --base http://localhost:3742 --browser firefox --viewports desktop
//
// Browser binaries: JOURNEY_CHROME / JOURNEY_FIREFOX override the defaults
// (macOS app bundles, Linux /usr/bin). puppeteer-core drives Chrome over CDP
// and Firefox over WebDriver BiDi; no browser download.
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

// Expected sample-pack card count, read straight from the source constant
// (not re-typed here) so it can't drift from lib/samples.ts.
const SAMPLE_CARD_COUNT = (
  readFileSync(new URL('../frontend/src/lib/samples.ts', import.meta.url), 'utf8').match(
    /\{ name:/g
  ) ?? []
).length;

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const BASE = opt('--base', 'http://localhost:3737').replace(/\/$/, '');
const BROWSER = opt('--browser', 'chrome');
const OUT = path.resolve(opt('--out', `journey-${BROWSER}`));
const VIEWPORTS = opt('--viewports', 'phone,desktop').split(',');
const SETTLE_MS = Number(opt('--settle', 1500));
// Fixed account name instead of a fresh `journey<ts>` one. Pair it with the
// backend's ADMIN_USERNAMES so the walk also covers /admin (admin-only route);
// re-runs against the same DB sign in instead of registering.
const USERNAME = opt('--username', null);

const TIERS = {
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
};

function executable() {
  const env = BROWSER === 'firefox' ? process.env.JOURNEY_FIREFOX : process.env.JOURNEY_CHROME;
  if (env) return env;
  const candidates =
    BROWSER === 'firefox'
      ? [
          '/Applications/Firefox.app/Contents/MacOS/firefox',
          '/usr/bin/firefox',
          '/snap/bin/firefox',
        ]
      : [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium-browser',
          '/usr/bin/chromium',
        ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`no ${BROWSER} binary found; set JOURNEY_${BROWSER.toUpperCase()}`);
  return found;
}

/**
 * Console noise that is not a defect of ours: the browser's own "Failed to
 * load resource" lines for answers the app handles (a guest's 401 on the
 * session probe, a 404 the not-found page renders, a rate limit), benign
 * observer warnings, devtools nags. Everything else fails the screen.
 */
const IGNORED_CONSOLE =
  /favicon|net::ERR_ABORTED|Failed to load resource.*(401|404|429)|ResizeObserver loop|Download the React DevTools|\[vite\]|DevTools|Scryfall fallback failed|Couldn't reach Scryfall/;
/**
 * Third-party hosts the app calls straight from the browser. A headless
 * runner origin can be refused by them (Scryfall answers a WAF block with no
 * CORS headers: Chrome logs "Access to fetch … blocked by CORS policy" plus a
 * net::ERR_FAILED resource line located at the host, Firefox raises a
 * "Cross-Origin Request Blocked" page error naming the URL). The app handles
 * that with its own error state, so a failure at one of these hosts is their
 * reachability, not our defect. Google Fonts is the same story: the type-set
 * previews on /you pull a dozen faces, and Firefox raises a page error per
 * face a runner fails to download (2026-09-11), each with a real fallback
 * stack behind it. Same-origin failures still count.
 */
const THIRD_PARTY =
  /https:\/\/([a-z0-9-]+\.)*(scryfall\.(com|io)|edhrec\.com|fonts\.(gstatic|googleapis)\.com)\//;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Stacked siblings that touch — zero gap between two blocks of content.
 *
 * The CSS convention is "caller owns spacing" (STYLE_GUIDE § Color &
 * spacing): a shared component carries no outer margin, and the host that
 * renders it lays its children out with `gap`. A host that forgets the gap
 * renders its children flush — the AI refine panel against the build
 * report's last pill row (#1887). No unit gate can see a gap, so this runs
 * in the browser on every screen: every visible container, every pair of
 * adjacent in-flow children with text, flagged when the lower one starts
 * where the upper one ends and at least one of the two is a visual box
 * (border, background or shadow). Two bare text lines touching is
 * typography (a value over its label, spaced by line-height) and is not
 * reported.
 *
 * Structures that touch by design are excluded: list and table rows, tab
 * strips against their panel, segmented groups, menus and toolbars, the
 * app chrome (header / nav / footer / main), a dialog's own header / body /
 * footer, and anything positioned out of flow.
 *
 * Runs inside page.evaluate — keep it self-contained (no closures).
 */
function touchingSiblings() {
  const SKIP_PARENT_TAG =
    /^(UL|OL|DL|TABLE|THEAD|TBODY|TFOOT|TR|SELECT|DATALIST|NAV|HEADER|FOOTER|SVG|PRE|CODE)$/;
  const SKIP_ROLE =
    /^(list|listbox|listitem|option|tablist|tab|tabpanel|radiogroup|group|menu|menubar|menuitem|toolbar|row|rowgroup|gridcell|grid|table|tree|treeitem|navigation|banner|contentinfo|dialog|alertdialog|presentation|none)$/;
  const SKIP_CHILD_TAG =
    /^(LI|TR|TD|TH|OPTION|DT|DD|BR|HR|SCRIPT|STYLE|TEMPLATE|SVG|IMG|CANVAS|VIDEO|HEADER|NAV|FOOTER|ASIDE|MAIN)$/;
  const label = (el) =>
    el.tagName.toLowerCase() +
    (typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '');
  const boxed = (cs) =>
    parseFloat(cs.borderTopWidth) > 0 ||
    parseFloat(cs.borderBottomWidth) > 0 ||
    (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') ||
    cs.backgroundImage !== 'none' ||
    cs.boxShadow !== 'none';
  const out = [];
  for (const parent of document.body.querySelectorAll('*')) {
    if (parent.children.length < 2) continue;
    if (SKIP_PARENT_TAG.test(parent.tagName)) continue;
    if (SKIP_ROLE.test(parent.getAttribute('role') || '')) continue;
    const pcs = getComputedStyle(parent);
    if (pcs.display === 'none' || pcs.display === 'inline' || pcs.display === 'contents') continue;
    const kids = [];
    for (const el of parent.children) {
      if (SKIP_CHILD_TAG.test(el.tagName)) continue;
      if (SKIP_ROLE.test(el.getAttribute('role') || '')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.display === 'inline' || cs.display === 'contents') continue;
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
      if (cs.position === 'absolute' || cs.position === 'fixed' || cs.position === 'sticky')
        continue;
      const r = el.getBoundingClientRect();
      if (r.height < 20 || r.width < 40) continue;
      if (!(el.innerText || '').trim()) continue;
      kids.push({ el, r, boxed: boxed(cs) });
    }
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1];
      const b = kids[i];
      const gap = b.r.top - a.r.bottom;
      if (gap <= -1 || gap >= 1) continue; // spaced, or side by side / overlapping
      if (Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left) < 20) continue;
      if (!a.boxed && !b.boxed) continue;
      const text = (el) => (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 32);
      out.push({
        key: `${label(parent)} › ${label(a.el)} | ${label(b.el)}`,
        detail: `"${text(a.el)}" over "${text(b.el)}" at y=${Math.round(a.r.bottom)}`,
      });
    }
  }
  return out;
}

/**
 * Pairs that touch on purpose, as the `parent › a | b` keys touchingSiblings
 * produces (tag + first two classes of each). Add a line only with the ruling
 * that makes the touch deliberate; a new key without one is the defect this
 * check exists to catch.
 */
const TOUCHING_BY_DESIGN = new Set([
  // Index tiles are one sleeve: cover art, then the name band, then the meta
  // strip, attached (STYLE_GUIDE § Color & spacing, sleeve matte).
  'div.binders-index-card-body › div.binders-index-card-name | div.binders-index-card-meta',
  // The identity card's art band is the card's own header, attached to its body.
  'section.deck-identity-card › div.deck-identity-card-art-band | div.deck-identity-card-body',
  // The playtest board is a full-bleed table: the tracker rail and the hand
  // rail are edge-attached to the play surface by design.
  'div.playtest-board › div.playtest-trackers | div.playtest-main',
  'div.playtest-board › div.playtest-main | div.playtest-hand',
]);
const slug = (s) =>
  s
    .replace(/^\//, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '') || 'root';

/** Click the first element whose visible text matches, waiting for it to exist. */
async function clickText(page, re, { timeout = 15000, within = 'button, a, [role=button]' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const hit = await page.evaluate(
      ({ src, flags, sel }) => {
        const rx = new RegExp(src, flags);
        const el = [...document.querySelectorAll(sel)].find(
          (e) => rx.test((e.textContent ?? '').trim()) && !e.disabled
        );
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        el.click();
        return true;
      },
      { src: re.source, flags: re.flags, sel: within }
    );
    if (hit) return;
    await sleep(250);
  }
  throw new Error(`no clickable element matching ${re}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    browser: BROWSER,
    executablePath: executable(),
    headless: true,
    protocolTimeout: 300_000,
    args:
      BROWSER === 'firefox'
        ? []
        : ['--no-first-run', '--no-default-browser-check', '--disable-gpu'],
  });
  const results = [];
  let seeded = null;
  try {
    for (const tierName of VIEWPORTS) {
      const tier = TIERS[tierName];
      if (!tier) throw new Error(`unknown viewport ${tierName}`);
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport(tier);
      const consoleErrors = [];
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        if (THIRD_PARTY.test(m.location()?.url ?? '') || THIRD_PARTY.test(m.text())) return;
        consoleErrors.push(m.text().slice(0, 300));
      });
      page.on('pageerror', (e) => {
        if (THIRD_PARTY.test(String(e))) return;
        consoleErrors.push('pageerror: ' + String(e).slice(0, 300));
      });

      const visit = async (route, label = route) => {
        consoleErrors.length = 0;
        await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await sleep(SETTLE_MS);
        return record(label);
      };
      /**
       * Behavioural check against the page already `record()`ed as `rec` —
       * a screen can pass the generic no-error/no-overflow checks while
       * showing the wrong data entirely (E.g. a card count of 0). Folds
       * into the same `rec` (screenshot already taken) instead of a
       * separate assertion channel, so a failure still uploads the
       * screenshot for the screen it's about.
       */
      const assertPage = async (rec, description, check) => {
        const { ok, expected, observed } = await check();
        if (!ok) {
          const msg = `assert failed on ${rec.label} — ${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(observed)}`;
          rec.consoleErrors.push(msg);
          rec.fail = true;
          console.log(`        ${msg}`);
        }
      };
      const record = async (label) => {
        await sleep(300);
        const m = await page.evaluate(() => {
          const de = document.documentElement;
          const text = document.body?.innerText ?? '';
          return {
            url: location.pathname + location.search,
            title: document.title,
            overflow: Math.max(0, de.scrollWidth - de.clientWidth),
            emptyBody: !document.body || text.trim().length === 0,
          };
        });
        const touching = [
          ...new Map(
            (await page.evaluate(touchingSiblings))
              .filter((t) => !TOUCHING_BY_DESIGN.has(t.key))
              .map((t) => [`${t.key} — ${t.detail}`, t])
          ).keys(),
        ];
        const errs = consoleErrors.filter((e) => !IGNORED_CONSOLE.test(e));
        const file = `${slug(label)}__${tierName}.png`;
        await page.screenshot({ path: path.join(OUT, file) }).catch(() => {});
        const rec = {
          browser: BROWSER,
          viewport: tierName,
          label,
          landed: m.url,
          title: m.title,
          overflow: m.overflow,
          emptyBody: m.emptyBody,
          consoleErrors: errs.slice(0, 5),
          touching: touching.slice(0, 8),
          file,
        };
        rec.fail =
          rec.overflow > 0 || rec.emptyBody || !rec.title || errs.length > 0 || touching.length > 0;
        results.push(rec);
        console.log(
          `${rec.fail ? 'FAIL' : ' ok '} ${BROWSER.padEnd(7)} ${tierName.padEnd(7)} ${label.padEnd(36)} ` +
            `overflow=${rec.overflow} empty=${rec.emptyBody} errors=${errs.length} touching=${touching.length}` +
            (rec.landed !== label.split('?')[0] && !label.includes('{')
              ? ` landed=${rec.landed}`
              : '')
        );
        if (errs.length) for (const e of errs) console.log(`        ${e}`);
        if (touching.length) for (const t of rec.touching) console.log(`        touching: ${t}`);
        return rec;
      };

      // --- Guest: the marketing landing, a guide, and a route nobody owns.
      await visit('/');
      await visit('/decks/discover');
      await visit('/this-route-does-not-exist');

      // --- Sign up once (the second viewport signs in to the same account).
      if (!seeded) {
        seeded = {
          username: USERNAME ?? `journey${Date.now().toString(36)}`.slice(0, 20),
          password: USERNAME ? `journey-pass-${USERNAME}` : 'journey-pass-' + Date.now(),
        };
        const status = await page.evaluate(async (creds) => {
          let r = await fetch('/api/auth/register', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(creds),
          });
          // A fixed --username already exists on a re-run: sign in instead.
          if (r.status === 409) {
            r = await fetch('/api/auth/login', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(creds),
            });
            return r.status === 200 ? 201 : r.status;
          }
          return r.status;
        }, seeded);
        if (status !== 201) throw new Error(`register → ${status}`);
      } else {
        const status = await page.evaluate(async (creds) => {
          const r = await fetch('/api/auth/login', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(creds),
          });
          return r.status;
        }, seeded);
        if (status !== 200) throw new Error(`login → ${status}`);
      }
      await page.evaluate(() => {
        localStorage.setItem('sc-ever-visited-app', '1');
        localStorage.setItem('sc-seen-nav-v2-tip', '1');
      });

      // --- Seed through the UI on the first pass: sample binders + cards.
      await visit('/collection/binders');
      // A reused account (fixed --username, second browser or a local re-run)
      // already has its sample binders; seeding again would find no button.
      const alreadySeeded =
        tierName === VIEWPORTS[0] &&
        (await page
          .waitForFunction(
            () => document.querySelectorAll('a[href*="/collection/binders/"]').length > 0,
            { timeout: 5_000 }
          )
          .then(
            () => true,
            () => false
          ));
      if (tierName === VIEWPORTS[0] && !alreadySeeded) {
        // Fresh account: "Try it out" on the empty state; with cards already
        // present it reads "Load sample binders". Either opens the intro dialog.
        await clickText(page, /^(Try it out|Load sample binders)$/);
        await clickText(page, /^Load sample/, { within: '[role=dialog] button' });
        await page.waitForFunction(
          () => document.querySelectorAll('a[href*="/collection/binders/"]').length > 0,
          { timeout: 90_000 }
        );
        await sleep(SETTLE_MS);
        await record('/collection/binders (after samples)');
      } else {
        await page.waitForFunction(
          () => document.querySelectorAll('a[href*="/collection/binders/"]').length > 0,
          { timeout: 90_000 }
        );
      }
      const binderHref = await page.evaluate(
        () =>
          document.querySelector('a[href*="/collection/binders/"]')?.getAttribute('href') ?? null
      );

      // --- Create a deck through the UI on the first pass.
      let deckHref = null;
      await visit('/decks/new');
      if (tierName === VIEWPORTS[0]) {
        // Commander is the default format: pick the first suggested commander,
        // then "Start blank" (the commander only, every card by hand).
        await page.waitForSelector('.commander-result-card', { timeout: 60_000 });
        const pickedCommander = await page.evaluate(
          () =>
            document
              .querySelector('.commander-result-card .commander-result-name')
              ?.textContent?.trim() ?? null
        );
        await page.evaluate(() => document.querySelector('.commander-result-card')?.click());
        await clickText(page, /^Start blank$/, { timeout: 60_000 });
        await page.waitForFunction(() => /^\/decks\/deck_/.test(location.pathname), {
          timeout: 60_000,
        });
        await sleep(SETTLE_MS);
        const deckRec = await record('/decks/{deck} (just created)');
        // defaultDeckName() (store/decks.ts) takes everything before the
        // first comma of the commander's name — pin that relationship
        // rather than a hardcoded fixture name, since which commander gets
        // suggested first can change.
        if (pickedCommander) {
          const expectedDeckName = pickedCommander.split(',')[0].trim();
          await assertPage(deckRec, 'deck editor name', async () => {
            const observed = await page.evaluate(
              () => document.querySelector('.deck-editor-name')?.textContent?.trim() ?? null
            );
            return { ok: observed === expectedDeckName, expected: expectedDeckName, observed };
          });
        }
        // "Start blank" seeds the deck with just the commander.
        await assertPage(deckRec, 'deck editor initial card count', async () => {
          const observed = await page.evaluate(() => {
            const text = (document.querySelector('.deck-hero-totals')?.textContent ?? '').replace(
              / /g,
              ' '
            );
            const m = text.match(/(\d+)\s+cards?\b/);
            return m ? Number(m[1]) : null;
          });
          return { ok: observed === 1, expected: 1, observed };
        });
        deckHref = await page.evaluate(() => location.pathname);

        // --- Generate a deck too: the post-generation "Your deck is ready"
        // sheet is the one surface no route reaches (router state opens it
        // once), and it is where the AI panel sat flush against the report
        // (#1887). EDHREC drafts the 100; the picker above already depends
        // on EDHREC, so this adds no new dependency, only time.
        await visit('/decks/new', '/decks/new (generate)');
        await page.waitForSelector('.commander-result-card', { timeout: 60_000 });
        await page.evaluate(() => document.querySelector('.commander-result-card')?.click());
        await clickText(page, /^Generate deck$/, { timeout: 60_000 });
        await page.waitForSelector('.build-report-sheet', { timeout: 240_000 });
        await sleep(SETTLE_MS);
        const sheetRec = await record('/decks/{deck} (generated, build report)');
        await assertPage(sheetRec, 'build report sheet opens after generation', async () => {
          const observed = await page.evaluate(
            () => document.querySelector('.build-report-sheet-heading')?.textContent?.trim() ?? null
          );
          return {
            ok: observed === 'Your deck is ready',
            expected: 'Your deck is ready',
            observed,
          };
        });
        await clickText(page, /^View my deck$/, { within: '.build-report-sheet button' });
      } else {
        await visit('/decks');
        deckHref = await page.evaluate(
          () =>
            document
              .querySelector('a[href^="/decks/deck_"]')
              ?.getAttribute('href')
              ?.split(/[?#]/)[0] ?? null
        );
      }

      // --- The signed-in walk.
      const routes = [
        '/home',
        '/collection',
        '/collection/binders',
        binderHref,
        '/collection/lists',
        '/collection/sets',
        '/collection/combos',
        '/decks',
        '/decks/saved',
        '/decks/compare',
        '/decks/cube',
        deckHref,
        deckHref && `${deckHref}?view=stats`,
        deckHref && `${deckHref}?view=power`,
        deckHref && `${deckHref}?view=tune`,
        deckHref && `${deckHref}/playtest`,
        '/play',
        '/play?tab=online',
        '/play?tab=nights',
        '/play?tab=history',
        '/friends',
        '/trades',
        '/pods',
        '/you',
        '/settings',
        '/search?q=sol+ring',
        '/tags',
        '/rules',
        `/u/${seeded.username}`,
        USERNAME && '/admin',
      ].filter(Boolean);
      for (const r of routes) {
        const rec = await visit(r);
        if (r === '/admin') {
          // Non-admins are redirected to /collection, which would pass the
          // generic checks and hide a broken admin page. Pin the heading.
          await assertPage(rec, 'admin page renders for the admin account', async () => {
            const observed = await page.evaluate(
              () => document.querySelector('.admin-header h1')?.textContent?.trim() ?? null
            );
            return { ok: observed === 'Admin', expected: 'Admin', observed };
          });
        }
        if (r === '/collection') {
          await assertPage(rec, 'collection card count', async () => {
            const observed = await page.evaluate(() => {
              const text = document
                .querySelector('[aria-label="Collection totals"]')
                ?.textContent?.replace(/ /g, ' ');
              const m = text?.match(/^([\d,]+)\s+cards?/);
              return m ? Number(m[1].replace(/,/g, '')) : null;
            });
            return { ok: observed === SAMPLE_CARD_COUNT, expected: SAMPLE_CARD_COUNT, observed };
          });
        }
        if (r === '/collection/binders') {
          await assertPage(rec, 'binder rows render', async () => {
            const observed = await page.evaluate(
              () => document.querySelectorAll('a[href*="/collection/binders/"]').length
            );
            return { ok: observed >= 1, expected: '>= 1', observed };
          });
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => r.fail);
  await writeFile(
    path.join(OUT, 'report.json'),
    JSON.stringify({ base: BASE, browser: BROWSER, results }, null, 2)
  );
  console.log(
    `\n${BROWSER}: ${results.length} screens, ${failed.length} failed` +
      (failed.length
        ? `\n${failed.map((r) => `  - ${r.viewport} ${r.label}: ${r.emptyBody ? 'empty body; ' : ''}${r.overflow ? `overflow ${r.overflow}px; ` : ''}${!r.title ? 'no title; ' : ''}${r.touching.length ? `touching ${r.touching.join(', ')}; ` : ''}${r.consoleErrors.join(' | ')}`).join('\n')}`
        : '')
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
