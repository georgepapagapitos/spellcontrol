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
//   - a primary control row wrapped onto a second line at phone width (see
//     NO_WRAP_AT_PHONE below)
//   - a screenshot, so a failure comes with the picture
//
// It also REPORTS (without failing) every touch target under 44px at phone
// width — see undersizedTouchTargets below for why that one is reported rather
// than gated, and what has to be true before it becomes a gate.
//
// With --a11y it also runs axe-core (WCAG 2.2 A/AA) on every screen, and on
// desktop re-runs its color-contrast rule under every theme and every type
// set: a colour that clears AA in one theme can vanish in another (the
// card-preview panel's "Ramp" pill read 1.08:1 in the light guilds only).
// Report-only for now, written to a11y.json; see axeSweep below.
//
// Any of the first six fails the run. Screenshots + report.json land in
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

// ── Accessibility sweep (--a11y) ─────────────────────────────────────────
// Report-only while the baseline is burned down: a screen's violations land in
// its record and in a11y.json, and never fail the run. Turn it into a gate
// (fold `a11y` into rec.fail) once a nightly run reports zero.
const A11Y = argv.includes('--a11y');
const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const AXE_SRC = A11Y ? src('../frontend/node_modules/axe-core/axe.min.js') : '';
// Read the registries rather than re-typing them, so a new theme or type set
// is swept the day it lands.
const THEMES = [
  ...src('../frontend/src/lib/themes.ts').matchAll(/id: '([a-z]+)',[^}]*?scheme: '(light|dark)'/g),
].map((m) => ({ id: m[1], scheme: m[2] }));
const TYPESETS = [
  ...src('../frontend/src/lib/typesets.ts').matchAll(/id: '([a-z]+)',[^}]*?href: (null|'[^']+')/g),
].map((m) => ({ id: m[1], href: m[2] === 'null' ? null : m[2].slice(1, -1) }));
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * axe on the current screen: the full WCAG A/AA rule set in the theme the app
 * booted in, then (when `sweep`) color-contrast alone under each theme and
 * each type set. Only contrast depends on the palette; a type set changes the
 * size and weight that decide axe's large-text threshold, and it swaps the
 * faces, so it gets the same rule.
 *
 * Transitions and animations are frozen first: the theme swap fades colours
 * over --motion-*, and axe reading mid-fade reports a colour no one sees.
 */
async function axeSweep(page, sweep) {
  if (!(await page.evaluate(() => !!window.axe))) await page.evaluate(AXE_SRC);
  const run = (rules) =>
    page.evaluate(
      async ({ rules, tags }) => {
        const r = await window.axe.run(document, {
          runOnly: rules ? { type: 'rule', values: rules } : { type: 'tag', values: tags },
          resultTypes: ['violations'],
        });
        return r.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          count: v.nodes.length,
          nodes: v.nodes.slice(0, 12).map((n) => ({
            target: n.target.join(' '),
            html: n.html.slice(0, 160),
            summary: (n.failureSummary ?? '').split('\n').slice(1).join(' ').slice(0, 240),
          })),
        }));
      },
      { rules, tags: WCAG_TAGS }
    );
  const apply = (attrs, href) =>
    page.evaluate(
      async ({ attrs, href }) => {
        if (!document.getElementById('journey-a11y-freeze')) {
          const st = document.createElement('style');
          st.id = 'journey-a11y-freeze';
          st.textContent =
            '*,*::before,*::after{transition:none!important;animation:none!important}';
          document.head.append(st);
        }
        const de = document.documentElement;
        for (const [k, v] of Object.entries(attrs)) de.setAttribute(k, v);
        if (href !== undefined) {
          // Mirrors store/typeset.ts applyTypeSet: the default set is bundled.
          let link = document.getElementById('typeset-fonts');
          if (!href) link?.remove();
          else {
            if (!link) {
              link = Object.assign(document.createElement('link'), {
                id: 'typeset-fonts',
                rel: 'stylesheet',
              });
              document.head.append(link);
            }
            if (link.getAttribute('href') !== href) {
              await new Promise((res) => {
                link.onload = link.onerror = res;
                link.setAttribute('href', href);
              });
            }
          }
        }
        await document.fonts?.ready;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      },
      { attrs, href }
    );

  const original = await page.evaluate(() => {
    const de = document.documentElement;
    return {
      attrs: {
        'data-theme': de.getAttribute('data-theme') ?? '',
        'data-scheme': de.getAttribute('data-scheme') ?? '',
        'data-typeset': de.getAttribute('data-typeset') ?? '',
      },
      href: document.getElementById('typeset-fonts')?.getAttribute('href') ?? null,
    };
  });
  await apply({});
  const out = { base: await run(null), themes: {}, typesets: {} };
  if (sweep) {
    for (const t of THEMES) {
      await apply({ 'data-theme': t.id, 'data-scheme': t.scheme });
      out.themes[t.id] = await run(['color-contrast']);
    }
    await apply({
      'data-theme': original.attrs['data-theme'],
      'data-scheme': original.attrs['data-scheme'],
    });
    for (const t of TYPESETS) {
      await apply({ 'data-typeset': t.id }, t.href);
      out.typesets[t.id] = await run(['color-contrast']);
    }
    await apply(original.attrs, original.href);
  }
  await page.evaluate(() => document.getElementById('journey-a11y-freeze')?.remove());
  return out;
}

/**
 * Keyboard walk (--a11y, desktop): real Tab presses through the screen, up to
 * TAB_STOPS stops. axe checks names and roles, but not whether a keyboard user
 * can SEE where they are, and 81 `outline: none` rules in src/ each have to be
 * paired with a replacement ring. For every stop this records:
 *
 *   - no-ring: nothing about the element, its pseudo-elements or its parent
 *     (a :focus-within ring) differs between focused and blurred;
 *   - invisible: focus landed on something with no box or off-screen-hidden;
 *   - stuck: Tab stopped moving (a trap), or the stop repeated early.
 *
 * Blur-and-refocus keeps the keyboard modality, so :focus-visible still
 * matches on the refocus and the walk resumes from the same element.
 */
const TAB_STOPS = 40;
async function keyboardWalk(page) {
  // Freeze transitions for the walk: a ring that animates in reads the same
  // mid-fade on focus and on blur (the blur reverses from the current value),
  // so every animated ring would report as missing.
  await page.evaluate(() => {
    const st = document.createElement('style');
    st.id = 'journey-kbd-freeze';
    st.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
    document.head.append(st);
    document.activeElement?.blur?.();
    window.scrollTo(0, 0);
  });
  const findings = [];
  const seen = new Map();
  let last = null;
  for (let i = 0; i < TAB_STOPS; i++) {
    await page.keyboard.press('Tab');
    await sleep(60);
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      // Identity, not description: two deck tiles for one commander, or two
      // unlabelled radios in a row, describe the same and are not a trap.
      window.__journeyStops ??= new WeakMap();
      if (!window.__journeyStops.has(el)) {
        window.__journeyStopN = (window.__journeyStopN ?? 0) + 1;
        window.__journeyStops.set(el, window.__journeyStopN);
      }
      const key = window.__journeyStops.get(el);
      const hidden = (node) => {
        const r = node.getBoundingClientRect();
        const cs = getComputedStyle(node);
        return (
          r.width < 2 ||
          r.height < 2 ||
          cs.visibility === 'hidden' ||
          cs.opacity === '0' ||
          r.bottom < 0 ||
          r.right < 0 ||
          r.left > innerWidth + 1
        );
      };
      // A visually hidden native input (a styled radio or checkbox) draws its
      // ring on its label: judge the label it hands focus to instead.
      const label = hidden(el) ? [...(el.labels ?? [])].find((l) => !hidden(l)) : undefined;
      const target = label ?? el;
      const props = [
        'outline-style',
        'outline-width',
        'outline-color',
        'box-shadow',
        'border-top-color',
        'border-bottom-color',
        'background-color',
        'color',
        'text-decoration-line',
        'opacity',
        'transform',
      ];
      const snap = () => {
        const read = (node, pseudo) => {
          if (!node) return '';
          const cs = getComputedStyle(node, pseudo);
          return props.map((k) => cs.getPropertyValue(k)).join('|');
        };
        const nodes = [target, target.parentElement, target.parentElement?.parentElement];
        // A label's ring is often drawn by a sibling span (`input:focus-visible + span`).
        // Not the input itself: its UA outline on a 1px clipped box is no ring.
        if (label) nodes.push(...[...label.children].filter((c) => c !== el));
        return nodes.flatMap((n) => [read(n), read(n, '::before'), read(n, '::after')]).join('#');
      };
      const describe = () => {
        const cls =
          typeof target.className === 'string' ? target.className.trim().split(/\s+/)[0] : '';
        const name = (el.getAttribute('aria-label') ?? (label ?? el).textContent ?? '')
          .trim()
          .slice(0, 40);
        return `${target.tagName.toLowerCase()}${cls ? '.' + cls : ''} "${name}"`;
      };
      const focused = snap();
      el.blur();
      const blurred = snap();
      el.focus({ preventScroll: true });
      return { key, id: describe(), invisible: !label && hidden(el), ring: focused !== blurred };
    });
    if (!stop) {
      // Tab left the document (wrapped to the browser chrome): the walk is done.
      if (i > 0) break;
      continue;
    }
    if (stop.key === last) {
      findings.push({ kind: 'stuck', el: stop.id });
      break;
    }
    last = stop.key;
    const n = (seen.get(stop.key) ?? 0) + 1;
    seen.set(stop.key, n);
    if (n > 1) break; // wrapped around to the start: every stop was visited
    if (stop.invisible) findings.push({ kind: 'invisible', el: stop.id });
    else if (!stop.ring) findings.push({ kind: 'no-ring', el: stop.id });
  }
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    document.getElementById('journey-kbd-freeze')?.remove();
  });
  return findings;
}

/** Nodes failing on this screen, across the base run and every sweep. */
const a11yNodeCount = (a) =>
  !a
    ? 0
    : [a.base, ...Object.values(a.themes), ...Object.values(a.typesets)]
        .flat()
        .reduce((n, v) => n + v.count, 0) + (a.keyboard?.length ?? 0);

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
/**
 * The primary control rows, which must stay ONE row at phone width.
 *
 * `control-row-budget.test.tsx` already counts the controls in these rows, but
 * a count is not the invariant — width is. The collection's row was inside its
 * budget at four controls and still spent 412px in a 344px row, so the "View"
 * popover wrapped onto a line of its own and pushed the cards down a screen
 * that had room for two rows of them. Nothing caught it; a phone screenshot
 * from the user did.
 *
 * A row here is wrapped when it is taller than its tallest child. Fold the new
 * control into the row's "View" popover or its kebab rather than delisting the
 * row (STYLE_GUIDE § "Toolbars & action rows").
 */
const NO_WRAP_AT_PHONE = [
  '.decks-index-sort-bar',
  '.decks-index-actions',
  '.card-list-summary-actions',
  '.collection-hero-actions',
  // The binder page's control row (BinderSummaryBar): wrapped to three lines
  // at 390px before its display controls folded into the View popover.
  '.binder-summary',
  // Discover's sort + view row: at 44px touch sizes the one-row toolbar
  // measured 478px in a 374px row and the view toggle wrapped alone. The
  // search pill now takes its own row at phone width, as on My Decks.
  '.discover-sort-bar',
];

/**
 * Touch targets below the 44px floor, at phone width only.
 *
 * ⚠️ REPORTED, NOT FAILED — deliberately, and this is the honest reason:
 * the first full run of this check found **21 distinct undersized classes
 * across 16 of 38 screens** (93 `.deck-row`, 30 `.deck-analysis-suggest-add`,
 * 16 `.role-badge-btn`, 12 `.commander-color-pip`, …), overwhelmingly in the
 * deck editor and deck-creation surfaces. Failing the nightly on that would
 * make it permanently red, which is worse than no check at all — a red run is
 * supposed to be a board row, not the status quo. Allowlisting 21 classes
 * would not be "debt made visible" either; it would be switching the check off
 * while looking like it is on.
 *
 * So it publishes a count per screen and the offending selectors into
 * report.json every night. The inventory is board row E317, owned by the
 * playtest sweep's remaining batches. **Flip this into `rec.fail` once that
 * inventory is empty** — one line, below.
 *
 * Three of those classes will never leave the report, because they are
 * RULINGS and not misses. Re-measured in a browser 2026-09-20 (hit areas, not
 * boxes) before writing this down:
 *   - `.deck-row` and every control inside it (the kebab, the qty readout, the
 *     ± steppers) are capped by the row's `min-height: 36px` under
 *     `(pointer: coarse)`. That number is deliberate and the comment on it
 *     says why: a 100-row deck list, full-width rows, and a 44px version was
 *     tried and reverted because it stranded one 20px line of text in ~50px of
 *     padding. 36x36 clears WCAG 2.5.8 (24x24 AA); 44 is the AAA bar. ~230 of
 *     the reported instances on a 100-card deck are this one line.
 *   - `.card-list-binder-badge` / `.card-list-deck-badge` ghosts are 44 wide
 *     and capped at 36 tall on purpose (collection.css): a 44px-tall ghost
 *     overhangs the card art in a 118x208 tile and steals the tile's own tap,
 *     which opens the card. Measured hit area 53x37 — a secondary action
 *     nested in a primary target, above the AA floor.
 *   - `.deck-curve-phases-bar-hit` is a chart column, 32px wide with a 39px
 *     hit area. Widening one column eats its neighbour; the fix is a different
 *     chart, not a floor.
 * So the flip needs those three carried as documented exceptions, not as an
 * allowlist of 21 — and nothing else added to it without a measured reason.
 *
 * It exists because a *static* CSS guard structurally cannot find this family
 * of defect, and the 2026-09-15 sweep found four in three batches — every one
 * a floor that existed on paper and was defeated in the rendered box:
 *   - `.auth-forgot-link` (101x23) — the coarse block floored the two controls
 *     beside it and skipped this one.
 *   - `.btn` (41px) — floored, then silently undercut by the phone density
 *     pass declaring `min-height: 36px` at equal specificity, later in the
 *     bundle.
 *   - `.pill-btn` (39px) and `.toolbar-pill` (34px) — no base floor at all,
 *     papered over per-surface, so the routes anyone checks first read 44.
 * A curated list of shared classes missed `.toolbar-pill` outright. Measuring
 * the rendered box in a real browser is the only check that generalizes.
 *
 * This check exists because a *static* CSS guard structurally cannot find this
 * family of defect, and the 2026-09-15 playtest sweep found four of them in
 * three batches — every one a floor that existed on paper and was defeated in
 * the rendered box:
 *   - `.auth-forgot-link` (101x23) — the coarse block floored the two controls
 *     beside it and skipped this one.
 *   - `.btn` (41px) — floored, then silently undercut by the phone density
 *     pass declaring `min-height: 36px` at equal specificity, later in the
 *     bundle.
 *   - `.pill-btn` (39px) and `.toolbar-pill` (34px) — no base floor at all,
 *     papered over per-surface, so the routes anyone checks first read 44.
 * A curated list of shared classes missed `.toolbar-pill` outright. Measuring
 * the rendered box in a real browser is the only check that generalizes.
 *
 * Exemptions, each matching a real non-defect:
 *   - `pointer-events: none` — a visually-hidden input whose <label> tile is
 *     the real target (`.settings-theme-radio` is 1x1 by design).
 *   - inside a >=44px <label> — same shape; the label forwards the click.
 *   - an inline <a> — WCAG 2.5.8's "Inline" exception: a link in a sentence is
 *     sized by the line-height of the prose around it ("Privacy Policy",
 *     "Fan Content Policy" on /you).
 */
function undersizedTouchTargets() {
  const out = [];
  const seen = new Set();
  const sel = 'button,a[href],input,select,textarea,[role="button"],[role="tab"],[role="switch"]';
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (cs.pointerEvents === 'none') continue;
    const label = el.closest('label');
    if (label && label !== el) {
      const lr = label.getBoundingClientRect();
      if (lr.width >= 44 && lr.height >= 44) continue;
    }
    if (el.tagName === 'A' && cs.display === 'inline') continue;
    const after = getComputedStyle(el, '::after');
    const gw = after.content !== 'none' ? parseFloat(after.width) || 0 : 0;
    const gh = after.content !== 'none' ? parseFloat(after.height) || 0 : 0;
    const w = Math.round(Math.max(r.width, gw));
    const h = Math.round(Math.max(r.height, gh));
    if (w >= 44 && h >= 44) continue;
    const first = String(el.className || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)[0];
    const key = first ? `.${first}` : el.tagName.toLowerCase();
    const name = (el.getAttribute('aria-label') || el.textContent.trim() || '').slice(0, 30);
    const line = `${key} ${w}x${h}${name ? ` "${name}"` : ''}`;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

/**
 * Interactive targets that OVERLAP another interactive target, at phone width.
 *
 * This fails the run, unlike `undersizedTouchTargets` above — it has no
 * standing inventory to work through, and what it catches is worse than a
 * small target: the overlap belongs to whichever element paints later, so the
 * lost strip does not just miss, it fires the WRONG control.
 *
 * The recurring cause is one idiom. A control bleeds over its container's
 * padding with a negative margin equal to its own padding, so the padding does
 * not count in layout — correct on the inline axis, where nothing is beside
 * it, and a defect on the block axis, where the row above and below is another
 * instance of the same control. Measured 2026-09-20: `.new-from-friends-link`
 * (`margin: calc(var(--space-2) * -1)`) overlapped by 8px, so each 44px row
 * had a 39px usable target and its bottom strip opened the next friend's deck;
 * `.engine-axis-btn` (`margin: -0.35rem -0.45rem`) overlapped by 2.4px into
 * the next axis. Both boxes read 44x44, so `undersizedTouchTargets` passed
 * them and the nightly said nothing.
 *
 * Only real overlap counts: a control nested inside another interactive
 * element (a row that is itself a button, a label around its input) shares
 * space by design, and is skipped.
 */
function overlappingTouchTargets() {
  const sel = 'button,a[href],input,select,textarea,[role="button"],[role="tab"],[role="switch"]';
  /** App chrome is SUPPOSED to sit over the page and win the tap — that is
   *  layering, not a stolen target. Fixed/sticky covers most of it; the mobile
   *  tab bar is the exception that needs naming, because it is deliberately a
   *  normal flex child of the non-scrolling shell rather than `position:
   *  fixed` (responsive-nav.css says why: --safe-bottom jumps on Android), so
   *  content scrolled under it looks like an overlap from a rect alone. The
   *  Scan FAB is the same case: it floats over the page on purpose and is
   *  `position:absolute` inside the shell for that same --safe-bottom reason,
   *  so a rect alone reads it as stealing whatever it happens to sit over. */
  const CHROME = '.mobile-tab-bar, .skip-link, .site-header, .scan-fab-root';
  const pinned = (el) => {
    if (el.closest(CHROME)) return true;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const pos = getComputedStyle(n).position;
      if (pos === 'fixed' || pos === 'sticky') return true;
    }
    return false;
  };
  const interactive = (el) => !!el && !!el.closest && !!el.closest(sel);
  const key = (el) => {
    const first = String(el.className || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)[0];
    return first ? `.${first}` : el.tagName.toLowerCase();
  };
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest('details:not([open])') || el.closest('[hidden]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none')
      continue;
    // Only judge a control that is fully on screen — a point outside the
    // viewport hit-tests as nothing, and one behind pinned chrome is layering.
    if (r.top < 2 || r.bottom > innerHeight - 2 || r.left < 0 || r.right > innerWidth) continue;
    if (pinned(el)) continue;
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const edges = [
      ['top', cx, Math.round(r.top + 2)],
      ['bottom', cx, Math.round(r.bottom - 2)],
      ['left', Math.round(r.left + 2), cy],
      ['right', Math.round(r.right - 2), cy],
    ];
    for (const [edge, x, y] of edges) {
      const hit = document.elementFromPoint(x, y);
      if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
      const other = hit.closest(sel);
      if (!interactive(hit) || !other || other === el) continue;
      if (other.contains(el) || el.contains(other)) continue;
      if (pinned(other)) continue;
      const line = `${key(el)} loses its ${edge} edge to ${key(other)}`;
      if (seen.has(line)) continue;
      seen.add(line);
      out.push(line);
    }
  }
  return out;
}

function wrappedControlRows(selectors) {
  const out = [];
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (!r.height) continue;
      const kids = [...el.children]
        .map((c) => c.getBoundingClientRect())
        .filter((k) => k.height > 0);
      if (kids.length < 2) continue;
      const tallest = Math.max(...kids.map((k) => k.height));
      // 4px of slack for sub-pixel rounding between the row and its children.
      if (r.height > tallest + 4) {
        out.push(
          `${sel} wrapped — ${Math.round(r.height)}px row of ${Math.round(tallest)}px controls`
        );
      }
    }
  }
  return out;
}

/**
 * Insight strips stack one-at-a-time on a phone (STYLE_GUIDE § Index-page
 * insight strips). Two of them showing costs 108px of a 780px screen above the
 * page's first row — the displacement that ruling exists to prevent, arrived at
 * by two lanes both having something to say rather than by one tall strip. The
 * rule is CSS-only (`:nth-child(n + 2)`), so only a real browser can check it.
 */
function stackedInsightStrips() {
  const out = [];
  for (const slot of document.querySelectorAll('.decks-index-insights')) {
    const shown = [...slot.children].filter((c) => c.getBoundingClientRect().height > 0);
    if (shown.length > 1) {
      out.push(
        `${shown.length} insight strips visible at once (${shown
          .map((c) => c.className.split(' ')[0])
          .join(', ')}) — one at a time below 600px`
      );
    }
  }
  return out;
}

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
        // Width-budget check, phone only — a desktop row has the room to
        // spread and is expected to.
        const wrapped =
          tierName === 'phone'
            ? [
                ...(await page.evaluate(wrappedControlRows, NO_WRAP_AT_PHONE)),
                ...(await page.evaluate(stackedInsightStrips)),
              ]
            : [];
        // Touch floor is a phone concern: a fine pointer only needs WCAG
        // 2.5.8's 24px, and every desktop-only control clears that.
        const smallTargets =
          tierName === 'phone' ? await page.evaluate(undersizedTouchTargets) : [];
        // Overlapping targets DO fail — see overlappingTouchTargets.
        const overlapping =
          tierName === 'phone' ? await page.evaluate(overlappingTouchTargets) : [];
        // Axe runs last among the probes: it swaps themes and restores them.
        const a11y = A11Y ? await axeSweep(page, tierName === 'desktop') : null;
        if (a11y) a11y.keyboard = tierName === 'desktop' ? await keyboardWalk(page) : [];
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
          wrapped,
          smallTargets,
          overlapping,
          a11y,
          file,
        };
        rec.fail =
          rec.overflow > 0 ||
          rec.emptyBody ||
          !rec.title ||
          errs.length > 0 ||
          touching.length > 0 ||
          wrapped.length > 0 ||
          overlapping.length > 0;
        results.push(rec);
        console.log(
          `${rec.fail ? 'FAIL' : ' ok '} ${BROWSER.padEnd(7)} ${tierName.padEnd(7)} ${label.padEnd(36)} ` +
            `overflow=${rec.overflow} empty=${rec.emptyBody} errors=${errs.length} touching=${touching.length} wrapped=${wrapped.length} small=${smallTargets.length} overlapping=${overlapping.length}` +
            (A11Y ? ` a11y=${a11yNodeCount(a11y)}` : '') +
            (rec.landed !== label.split('?')[0] && !label.includes('{')
              ? ` landed=${rec.landed}`
              : '')
        );
        if (errs.length) for (const e of errs) console.log(`        ${e}`);
        if (touching.length) for (const t of rec.touching) console.log(`        touching: ${t}`);
        if (wrapped.length) for (const w of wrapped) console.log(`        ${w}`);
        if (overlapping.length)
          for (const o of overlapping) console.log(`        overlapping: ${o}`);
        return rec;
      };

      // --- Guest: the marketing landing, a guide, and a route nobody owns.
      await visit('/');
      await visit('/decks/discover');
      await visit('/this-route-does-not-exist');

      // --- Sign up once (the second viewport signs in to the same account).
      if (!seeded) {
        const name = USERNAME ?? `journey${Date.now().toString(36)}`.slice(0, 20);
        seeded = {
          username: name,
          password: USERNAME ? `journey-pass-${USERNAME}` : 'journey-pass-' + Date.now(),
          // Registration requires an address (it is the only route back into
          // an account with a forgotten password). Nothing here reads mail;
          // the walk never needs the account verified.
          email: `${name}@example.com`,
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
              body: JSON.stringify({ username: creds.username, password: creds.password }),
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
        // T168: /decks/new is a start page of doors, not a form. "Generate a
        // deck" is the featured door and opens the commander finder at
        // /decks/new/generate. Pick the first suggested commander, then
        // "Start blank" (the commander only, every card by hand).
        await clickText(page, /^Generate a deck/, { timeout: 30_000 });
        await page.waitForFunction(() => location.pathname === '/decks/new/generate', {
          timeout: 30_000,
        });
        // The loading skeleton shares the `.commander-result-card` class (a
        // bare <span>, CommanderSearch.tsx) with the real result (a
        // <button>) so the grid never jumps size while EDHREC's trending
        // fetch is in flight — scope to the button or a slow fetch lets
        // waitForSelector resolve on the skeleton and the click do nothing.
        await page.waitForSelector('button.commander-result-card', { timeout: 60_000 });
        const pickedCommander = await page.evaluate(
          () =>
            document
              .querySelector('button.commander-result-card .commander-result-name')
              ?.textContent?.trim() ?? null
        );
        await page.evaluate(() => document.querySelector('button.commander-result-card')?.click());
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
        // on EDHREC, so this adds no new dependency, only time. The door was
        // already exercised above, so this pass goes straight to the
        // generator by its own route.
        await visit('/decks/new/generate?format=commander', '/decks/new/generate');
        await page.waitForSelector('button.commander-result-card', { timeout: 60_000 });
        await page.evaluate(() => document.querySelector('button.commander-result-card')?.click());
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

        // --- The card-preview sheet, open on an in-deck card. No route
        // reaches it, and it is an always-dark island that remaps the theme's
        // tokens: a remap that missed --surface left the "Ramp" pill in it
        // invisible in the light themes only (#2551). Recording it with the
        // sheet open is what puts it through the axe theme sweep. A real
        // mouse click on a non-commander row, then the handle steps it to
        // full so the lower sections (Swap this card) are laid out too.
        await page.waitForSelector('.deck-section-rows .deck-row-name', { timeout: 30_000 });
        const rowAt = await page.evaluate(() => {
          const lists = [...document.querySelectorAll('.deck-section-rows')];
          const el = (lists[1] ?? lists[0])?.querySelector('.deck-row-name');
          if (!el) return null;
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        if (rowAt) await page.mouse.click(rowAt.x, rowAt.y);
        const opened = await page
          .waitForSelector('.card-preview-panel', { timeout: 15_000 })
          .then(() => true)
          .catch(() => false);
        if (opened) {
          for (let i = 0; i < 2; i++) {
            await page.evaluate(() => document.querySelector('.card-preview-handle')?.click());
            await sleep(400);
          }
          await sleep(SETTLE_MS);
        }
        const previewRec = await record('/decks/{deck} (card preview)');
        await assertPage(previewRec, 'card preview opens from a deck row', async () => ({
          ok: opened,
          expected: '.card-preview-panel',
          observed: opened ? '.card-preview-panel' : null,
        }));
        await page.keyboard.press('Escape');
        await sleep(400);
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
        // The sections are routes (E375). `?tab=` still opens its tab, but
        // this list kept visiting it after #2099 (2026-09-21) and shot the
        // Play home each time.
        '/play/online',
        '/play/nights',
        '/play/history',
        '/friends',
        '/trades',
        '/pods',
        // `/you` is a hub and each section its own page (T173): every one
        // is visited, since a phone renders each alone.
        '/you',
        '/you/profile',
        '/you/account',
        '/you/appearance',
        '/you/prices',
        '/you/data',
        '/you/storage',
        '/you/help',
        '/settings',
        '/search?q=sol+ring',
        // The Search landing's browse rails, and each list in full (E520).
        '/search',
        '/search/top/commanders',
        '/search/top/new-commanders',
        '/search/top/cards?colors=WU&type=creatures',
        '/search/top/game-changers',
        '/search/top/salt',
        '/search/top/banned',
        '/tags',
        '/rules',
        `/u/${seeded.username}`,
        USERNAME && '/admin',
      ].filter(Boolean);
      for (const r of routes) {
        const rec = await visit(r);
        if (r === binderHref) {
          // The binder page viewer opens on a page you can see (2026-09-25).
          // A Secret Lair binder's long section line grew the viewer's auto
          // grid column to 1208px on a 384px phone and every page centered
          // off-screen, so it opened blank. The sample binders' labels are
          // short, so the long line is injected: whatever the text, the
          // layout must stay the viewport's width and the page on screen.
          await assertPage(rec, 'binder page viewer geometry', async () => {
            // A phone reads "Browse" (#2490 shortened it so the sort pill
            // beside it fits); wider screens read "Browse pages".
            await clickText(page, /^Browse( pages)?$/, { within: '.binder-summary button' });
            await page.waitForSelector('.binder-pages-slide.is-active .binder-pages-page', {
              timeout: 15_000,
            });
            await sleep(1200);
            const measure = () =>
              page.evaluate(() => {
                const pg = document
                  .querySelector('.binder-pages-slide.is-active .binder-pages-page')
                  ?.getBoundingClientRect();
                const track = document
                  .querySelector('.binder-pages-track')
                  ?.getBoundingClientRect();
                return {
                  trackW: Math.round(track?.width ?? 0),
                  vw: innerWidth,
                  onScreen:
                    !!pg && pg.left >= 0 && pg.right <= innerWidth && pg.bottom <= innerHeight,
                  centerOff: pg
                    ? Math.round(Math.abs(pg.left + pg.width / 2 - innerWidth / 2))
                    : -1,
                };
              });
            const opened = await measure();
            await page.evaluate(() => {
              const line = document.querySelector('.binder-pages-context');
              if (line)
                line.textContent =
                  'Artist Series Mark Poole · Extra Life 2021 · Secret Lair x Arcane Lands · The Tokyo Lands · More Borderless Planeswalkers · Buggin Out';
            });
            await sleep(500);
            const longLine = await measure();
            await page.keyboard.press('Escape');
            await sleep(900);
            const ok = [opened, longLine].every(
              (m) => m.trackW === m.vw && m.onScreen && m.centerOff <= 2
            );
            return {
              ok,
              expected:
                'page centered and on screen, layout as wide as the viewport, long line or not',
              observed: { opened, longLine },
            };
          });
        }
        if (r === '/collection') {
          // The card preview's layout contract (E421): nothing sits on the
          // card, the card is the hero of its stage, and paging to the next
          // card moves neither the header nor the card (the #636 stable-frame
          // rule). Before the redesign the close button covered the mana cost
          // on phones and a landscape phone got a 100 × 139 card.
          await assertPage(rec, 'card preview geometry', async () => {
            await page.evaluate(() =>
              [...document.querySelectorAll('.app-main [role=button]')]
                .find((e) => e.querySelector('img'))
                ?.click()
            );
            await page.waitForSelector('.card-preview-slide.is-active .card-preview-image-frame', {
              timeout: 15_000,
            });
            await sleep(1200);
            const measure = () =>
              page.evaluate(() => {
                const r = (s) => document.querySelector(s)?.getBoundingClientRect() ?? null;
                const card = r('.card-preview-slide.is-active .card-preview-image-frame');
                const close = r('.card-preview-close');
                const stage = r('.card-preview-stage');
                const head = r('.card-preview-head');
                const overlap =
                  card && close
                    ? Math.max(
                        0,
                        Math.min(card.right, close.right) - Math.max(card.left, close.left)
                      ) *
                      Math.max(
                        0,
                        Math.min(card.bottom, close.bottom) - Math.max(card.top, close.top)
                      )
                    : -1;
                return {
                  overlap: Math.round(overlap),
                  cardShare:
                    card && stage ? (card.width * card.height) / (stage.width * stage.height) : 0,
                  cardW: Math.round(card?.width ?? 0),
                  headH: Math.round(head?.height ?? 0),
                  // Paging must land the card dead centre on its stage: a
                  // transformed neighbour once left it 17.5px off (#2259).
                  centerOff:
                    card && stage
                      ? Math.round(
                          Math.abs(card.left + card.width / 2 - (stage.left + stage.width / 2))
                        )
                      : -1,
                };
              });
            const first = await measure();
            await page.keyboard.press('ArrowRight');
            await sleep(1200);
            const next = await measure();
            await page.keyboard.press('ArrowRight');
            await sleep(1200);
            const next2 = await measure();
            await page.keyboard.press('Escape');
            await sleep(900);
            const closed = await page.evaluate(
              () => !document.querySelector('.card-preview-sheet')
            );
            return {
              ok:
                first.overlap === 0 &&
                first.cardShare >= 0.4 &&
                next.cardW === first.cardW &&
                [first, next, next2].every((m) => m.centerOff <= 2) &&
                // The stacked header is fixed-height by construction; the
                // desktop column may wrap a long name, so only phones pin it.
                (tierName !== 'phone' || next.headH === first.headH) &&
                closed,
              expected:
                'no overlap, card ≥40% of its stage, centred and stable across cards, Escape closes',
              observed: { first, next, next2, closed },
            };
          });
        }
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
        if (r === '/search?q=sol+ring') {
          // E339: the box used to render the `?q=` param, so each keystroke
          // made a round trip through the router and a burst outran it — 19
          // characters in, 4 in the box at 0ms/key. This types faster than any
          // human and counts what survived; the value has to be the input's
          // own state for that to hold.
          await assertPage(rec, 'a burst of keystrokes all reach the search box', async () => {
            const sel = 'input[aria-label="Search any card"]';
            const typed = 'Sol Ring t:artifact';
            await page.click(sel);
            await page.$eval(sel, (el) => el.select());
            await page.keyboard.press('Backspace');
            await page.keyboard.type(typed, { delay: 0 });
            await sleep(600);
            const observed = await page.$eval(sel, (el) => el.value);
            return { ok: observed === typed, expected: typed, observed };
          });
        }
        if (r === '/search' || r.startsWith('/search/top/')) {
          // Every rail and list has to reach its data: a list that errors
          // shows the Retry strip, which the generic checks would pass.
          await assertPage(rec, 'browse lists load their cards', async () => {
            await page
              .waitForFunction(
                () =>
                  !document.querySelector('[aria-busy="true"], .browse-grid[aria-hidden="true"]'),
                { timeout: 20_000 }
              )
              .catch(() => {});
            const observed = await page.evaluate(() => ({
              tiles: document.querySelectorAll(
                '.browse-rail .collection-grid-item, .browse-grid .collection-grid-item'
              ).length,
              errors: document.querySelectorAll('.discover-decks-error').length,
            }));
            return {
              ok: observed.tiles > 0 && observed.errors === 0,
              expected: 'tiles, no errors',
              observed,
            };
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
  if (A11Y) await writeA11yReport(results);
  await writeFile(
    path.join(OUT, 'report.json'),
    JSON.stringify({ base: BASE, browser: BROWSER, results }, null, 2)
  );
  console.log(
    `\n${BROWSER}: ${results.length} screens, ${failed.length} failed` +
      (failed.length
        ? `\n${failed.map((r) => `  - ${r.viewport} ${r.label}: ${r.emptyBody ? 'empty body; ' : ''}${r.overflow ? `overflow ${r.overflow}px; ` : ''}${!r.title ? 'no title; ' : ''}${r.touching.length ? `touching ${r.touching.join(', ')}; ` : ''}${r.wrapped?.length ? `${r.wrapped.join(', ')}; ` : ''}${r.smallTargets?.length ? `under 44px: ${r.smallTargets.join(', ')}; ` : ''}${r.consoleErrors.join(' | ')}`).join('\n')}`
        : '')
  );
  process.exit(failed.length ? 1 : 0);
}

/**
 * One row per (rule, element), however many screens, themes and type sets it
 * failed on: the same pill failing on 40 screens in 4 themes is one fix.
 */
async function writeA11yReport(results) {
  const rows = new Map();
  const add = (rec, where, v) => {
    for (const n of v.nodes) {
      const key = `${v.id} ${n.target}`;
      const row = rows.get(key) ?? {
        rule: v.id,
        impact: v.impact,
        help: v.help,
        target: n.target,
        html: n.html,
        summary: n.summary,
        screens: new Set(),
        where: new Set(),
      };
      row.screens.add(`${rec.viewport} ${rec.label}`);
      row.where.add(where);
      rows.set(key, row);
    }
  };
  for (const rec of results) {
    if (!rec.a11y) continue;
    for (const v of rec.a11y.base) add(rec, 'boot theme', v);
    for (const [t, vs] of Object.entries(rec.a11y.themes))
      for (const v of vs) add(rec, `theme:${t}`, v);
    for (const [t, vs] of Object.entries(rec.a11y.typesets))
      for (const v of vs) add(rec, `typeset:${t}`, v);
    for (const k of rec.a11y.keyboard ?? [])
      add(rec, 'keyboard', {
        id: `keyboard-${k.kind}`,
        impact: 'serious',
        help:
          k.kind === 'no-ring'
            ? 'Keyboard focus shows no visible indicator'
            : k.kind === 'invisible'
              ? 'Keyboard focus lands on an element the user cannot see'
              : 'Tab stops moving (keyboard trap)',
        nodes: [{ target: k.el, html: '', summary: '' }],
      });
  }
  const list = [...rows.values()]
    .map((r) => ({ ...r, screens: [...r.screens], where: [...r.where] }))
    .sort((a, b) => b.screens.length * b.where.length - a.screens.length * a.where.length);
  await writeFile(path.join(OUT, 'a11y.json'), JSON.stringify(list, null, 2));
  const byRule = {};
  for (const r of list) byRule[r.rule] = (byRule[r.rule] ?? 0) + 1;
  console.log(
    `\na11y: ${list.length} failing elements (report-only): ` +
      Object.entries(byRule)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k} ${n}`)
        .join(', ')
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
