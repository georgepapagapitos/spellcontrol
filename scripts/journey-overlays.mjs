// The overlay half of the journey's a11y walk (E536). The route walk in
// journey.mjs only ever sees a page at rest plus the card-preview sheet, so a
// menu, dialog or sheet that paints its own surface (the "Ramp" pill bug
// class: a ground that missed a theme remap) was never put through axe or the
// theme/type-set contrast sweep. This opens each overlay on a real screen and
// hands it to the same `record()` the routes use, so a finding fails the
// screen and names the overlay in a11y.json.
//
// An overlay that can't be opened fails its screen too ("opens" assert): a
// renamed button must not turn a sweep into a silent skip.
//
// Dialogs and sheets also get the Tab walk (focus lands inside, every stop has
// a ring). Menus and popovers don't: they close when focus leaves them, so a
// walk would measure the page behind.
//
// Each overlay also gets the keys beyond Tab (journey-keyboard.mjs): focus
// lands inside, arrows/Home/End/Enter/Space in a menu, Tab trapped in a modal
// and released from a popover, Escape closes, focus returns to the opener. They
// run on a fresh load opened BY KEYBOARD (the opener is focused and Enter is
// pressed), on both tiers. Page-level tab strips get the arrow-key check too.
//
// The walk gates at zero on both tiers: there are no allowances. A rule that
// "can't be fixed here" is a pattern to change, not a count to ratchet.

import { TIERS } from './journey-browser.mjs';
import { ZOOM_TIERS } from './journey-zoom.mjs';
import { keyboardChecks, tally } from './journey-keyboard.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The keyboard pass opens each overlay the way a keyboard user does: the
 * opener is focused and activated with Enter, and every opener is remembered
 * on the page (`__kbOpeners`) so the pass can tell where focus must return.
 */
let KEYBOARD_OPEN = false;

/** Click the first visible element whose aria-label or text matches. */
async function clickMatch(page, sel, re, { timeout = 15_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const hit = await page.evaluate(
      ({ sel, src, flags, kbd }) => {
        const rx = new RegExp(src, flags);
        const el = [...document.querySelectorAll(sel)].find(
          (e) =>
            e.getBoundingClientRect().width > 0 &&
            !e.disabled &&
            rx.test(((e.getAttribute('aria-label') ?? '') + ' ' + (e.textContent ?? '')).trim())
        );
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        if (kbd) {
          el.focus({ preventScroll: true });
          (window.__kbOpeners ??= []).push(el);
        } else el.click();
        return true;
      },
      { sel, src: re.source, flags: re.flags, kbd: KEYBOARD_OPEN }
    );
    if (hit) {
      if (KEYBOARD_OPEN) await page.keyboard.press('Enter');
      return;
    }
    await sleep(250);
  }
  throw new Error(`nothing matching ${sel} ${re}`);
}

/** Right-click the nth element of `sel` with a real mouse, as a user does. */
async function rightClick(page, sel, n = 0) {
  await page.waitForSelector(sel, { timeout: 15_000 });
  const at = await page.evaluate(
    ({ sel, n, kbd }) => {
      const el = document.querySelectorAll(sel)[n];
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      if (kbd) {
        el.focus({ preventScroll: true });
        (window.__kbOpeners ??= []).push(el);
      }
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { sel, n, kbd: KEYBOARD_OPEN }
  );
  if (!at) throw new Error(`no ${sel} #${n}`);
  await page.mouse.click(at.x, at.y, { button: 'right' });
}

const MENU = '[role=menu], .ctx-menu, .toolbar-popover-panel, .deck-editor-overflow-panel';

/**
 * Every overlay: where it lives, how to open it, what proves it is open, and
 * whether it is a menu (`menu: true` skips the Tab walk). `open(page)` runs
 * on a fresh load of `route`. Every overlay runs on both tiers: desktop gets
 * the axe theme and type-set sweeps and the Tab walk, the phone gets the touch
 * probes (44px hit-area floor, overlapping targets) with the overlay open, so
 * a control inside a sheet or popover is measured like one on a page.
 * `phone: true` items run on the phone tier only (the scanner is gated to
 * phones and tablets); `desktop: true` items on desktop only.
 */
function catalog({ deck, binder }) {
  const click = (sel, re) => (page) => clickMatch(page, sel, re);
  const then =
    (...steps) =>
    async (page) => {
      for (const s of steps) {
        await s(page);
        await sleep(350);
      }
    };
  /** A control that lives somewhere else on the phone: `phone` opens it there. */
  const tiered = (desktop, phone) => (page, layout) => (layout === 'phone' ? phone : desktop)(page);
  const deckActions = click('button', /^Deck actions/);
  const editList = click('button.toolbar-pill', /^Edit the list/);
  const cardMenu = then(
    (p) => rightClick(p, '.deck-row-open', 3),
    click('button.deck-row-menu-item', /^Edit printing/)
  );
  return [
    // --- Deck list
    {
      route: '/decks',
      name: 'page menu',
      open: click('button', /^More deck actions/),
      ready: MENU,
      menu: true,
    },
    {
      route: '/decks',
      name: 'deck card menu',
      open: click('button', /^Actions for /),
      ready: MENU,
      menu: true,
    },
    {
      route: '/decks',
      name: 'sort popover',
      open: click('button.toolbar-pill', /^Sort decks by/),
      ready: '[role=listbox]',
      menu: true,
    },
    {
      route: '/decks',
      name: 'filters popover',
      open: click('button.filter-popover-btn', /Filters/),
      ready: '.deck-filters-panel',
      menu: true,
    },
    {
      route: '/decks',
      name: 'import dialog',
      open: tiered(
        click('button.pill-btn', /^Import deck/),
        then(click('button', /^More deck actions/), click('button,[role=menuitem]', /^Import deck/))
      ),
      ready: '.import-deck-modal',
    },
    {
      route: '/decks',
      name: 'account menu',
      open: click('button.site-avatar-menu-trigger', /Account menu/),
      ready: MENU,
      menu: true,
      desktop: true, // on the phone "You" is a tab-bar link to /you, not a menu
    },
    {
      route: '/decks',
      name: 'keyboard shortcuts',
      open: click('button.footer-shortcuts-chip', /shortcuts/),
      ready: '.shortcuts-overlay',
      desktop: true, // the footer chip is a hardware-keyboard affordance
    },
    // --- Deck editor (the generated deck: it has cards to act on)
    {
      route: deck,
      name: 'deck actions menu',
      open: deckActions,
      ready: '.deck-editor-overflow-panel',
      menu: true,
    },
    {
      route: deck,
      name: 'export dialog',
      open: then(deckActions, click('button.deck-editor-overflow-item', /^Export/)),
      ready: '.export-dialog',
    },
    {
      route: deck,
      name: 'share dialog',
      open: click('button', /^Sharing:/),
      ready: '.share-dialog',
    },
    {
      route: deck,
      name: 'format sheet',
      open: click('button.deck-format-link', /Format:/),
      ready: '.deck-format-sheet',
    },
    {
      route: deck,
      name: 'add cards sheet',
      open: click('button.btn-primary', /^Add cards/),
      ready: '.deck-add-sheet',
    },
    {
      route: deck,
      name: 'sort popover',
      open: click('button.toolbar-pill', /^Sort/),
      ready: '[role=listbox]',
      menu: true,
    },
    {
      route: deck,
      name: 'view options popover',
      open: click('button.toolbar-pill', /^View/),
      ready: '.toolbar-popover-panel',
      menu: true,
    },
    { route: deck, name: 'edit list menu', open: editList, ready: MENU, menu: true },
    {
      route: deck,
      name: 'paste cards dialog',
      open: then(editList, click('button.deck-row-menu-item', /^Paste cards/)),
      ready: '.import-deck-modal',
    },
    {
      route: deck,
      name: 'card row menu',
      open: click('button.deck-row-menu-trigger', /Card actions/),
      ready: MENU,
      menu: true,
    },
    {
      route: deck,
      name: 'card context menu',
      open: (p) => rightClick(p, '.deck-row-open', 3),
      ready: '.ctx-menu',
      menu: true,
      desktop: true, // a phone opens the same actions from the row's Card actions button
    },
    {
      route: deck,
      name: 'printing picker',
      open: cardMenu,
      ready: '[role=dialog], .modal, .card-picker-sheet',
    },
    // --- Collection
    {
      route: '/collection',
      name: 'filters popover',
      open: click('button.filter-popover-btn', /Filters/),
      ready: '[role=dialog], .filter-popover-panel',
      menu: true,
      kbdKind: 'dialog', // the collection filters are a centered modal dialog
    },
    {
      route: '/collection',
      name: 'sort popover',
      open: click('button.toolbar-pill', /^Sort/),
      ready: '[role=listbox]',
      menu: true,
    },
    {
      route: '/collection',
      name: 'group popover',
      open: click('button.toolbar-pill', /^Group by/),
      ready: '[role=listbox]',
      menu: true,
    },
    {
      route: '/collection',
      name: 'details popover',
      open: click('button.toolbar-pill', /^Details/),
      ready: '.toolbar-popover-panel',
      menu: true,
      desktop: true, // the phone folds Details into the View options popover below
    },
    {
      route: '/collection',
      name: 'view options popover',
      open: click('button', /^View options/),
      ready: '.toolbar-popover-panel',
      menu: true,
      phone: true,
    },
    {
      route: '/collection',
      name: 'export dialog',
      open: tiered(
        click('button.pill-btn', /^Export/),
        then(
          click('button', /^More collection actions/),
          click('button,[role=menuitem]', /^Export/)
        )
      ),
      ready: '[role=dialog], .modal',
    },
    {
      route: '/collection',
      name: 'add cards sheet',
      open: click('button.pill-btn-primary', /^Add cards/),
      ready: '[role=dialog], .modal, .card-picker-sheet',
    },
    {
      route: '/collection',
      name: 'page menu',
      open: click('button', /^More collection actions/),
      ready: MENU,
      menu: true,
    },
    {
      route: '/collection',
      name: 'card menu',
      open: (p) => rightClick(p, '.collection-grid-open', 0),
      ready: MENU,
      menu: true,
    },
    {
      route: '/collection',
      name: 'edit card sheet',
      open: then(
        (p) => rightClick(p, '.collection-grid-open', 0),
        click('button.deck-row-menu-item', /^Edit card/)
      ),
      ready: '[role=dialog], .modal, .card-picker-sheet',
      desktop: true,
    },
    // The scanner is phone and tablet only (useCanScan); the browser runs with a fake camera.
    {
      route: '/collection',
      name: 'card scanner',
      touch: true, // needs a coarse pointer, as the app gates it
      open: click('button.scan-fab-btn', /./),
      ready: '.scanner-root',
      phone: true,
      timeout: 45_000,
    },
    // Tab strips on the page itself: the overlay checks don't apply, the arrow keys do.
    {
      route: deck,
      name: 'deck tab strip',
      open: async () => {},
      ready: '[role=tablist]',
      tabsOnly: true,
    },
    {
      route: '/decks/discover',
      name: 'discover tab strip',
      open: async () => {},
      ready: '[role=tablist]',
      tabsOnly: true,
    },
    ...(binder
      ? [
          {
            route: binder,
            name: 'binder pages viewer',
            open: click('.binder-summary button', /^Browse/),
            ready: '.binder-pages-slide.is-active',
          },
          {
            route: binder,
            name: 'binder tab strip',
            open: async () => {},
            ready: '[role=tab]', // the tablist itself is display: contents
            tabsOnly: true,
            desktop: true, // the phone hides the strip (responsive-nav.css); "All binders" is its switcher
          },
        ]
      : []),
  ];
}

/** Back at the table: a game in progress asks to resume, a fresh one opens on the hand sheet. */
async function toTable(page) {
  await clickMatch(page, 'button', /^(Resume|Keep hand)$/, { timeout: 8_000 }).catch(() => {});
  await page.waitForSelector('.playtest-pile__open', { timeout: 15_000 });
  await sleep(600);
}

/** The opening-hand sheet, then the table after a draw and a play. */
function playtestSteps(deck) {
  const route = `${deck}/playtest`;
  const click = (sel, re) => (page) => clickMatch(page, sel, re);
  const table = (open) => async (page) => {
    await toTable(page);
    await open(page);
  };
  return [
    {
      route,
      name: 'opening hand sheet',
      open: async () => {},
      ready: '.playtest-opening-sheet',
      noEscape: true, // non-dismissable: keep or mulligan is the way out
    },
    {
      route,
      name: 'table after a draw and a play',
      open: table(async (page) => {
        await clickMatch(page, 'button.playtest-pile__open', /^Draw a card/);
        await sleep(500);
        await rightClick(page, '.playtest-hand__cards .playtest-card', 0);
        await clickMatch(page, 'button.playtest-ctx-action', /^Move to/);
        await sleep(400);
        await clickMatch(page, 'button.playtest-ctx-action', /^Battlefield(?!, tapped)/);
        await sleep(600);
      }),
      ready: '.playtest-main .playtest-card',
      scope: 'body', // the table is the surface here
    },
    {
      route,
      name: 'resume game dialog',
      open: async () => {},
      ready: '[role=dialog], [role=alertdialog]',
      // Start fresh (Escape) deals a new game, whose opening hand is also a dialog.
      kbdReady: '[role=dialog]:not(.playtest-opening-sheet), [role=alertdialog]',
      // Escape here is "Start fresh", which clears the saved game the keyboard pass reopens.
      noPostEscape: true,
    },
    {
      route,
      name: 'game menu',
      open: table(click('button.playtest-corner-btn', /Game menu/)),
      ready: '.playtest-game-menu',
    },
    {
      route,
      name: 'hand menu',
      open: table(click('button.playtest-hand-menu-btn', /Hand/)),
      ready: '.ctx-menu',
      menu: true,
    },
    {
      route,
      name: 'hand card menu',
      // A middle card: the leftmost one opens its menu over the life panel.
      open: table((p) => rightClick(p, '.playtest-hand__cards .playtest-card', 3)),
      ready: '.ctx-menu',
      menu: true,
    },
    {
      route,
      name: 'hand card submenu',
      open: table(async (p) => {
        await rightClick(p, '.playtest-hand__cards .playtest-card', 3);
        await clickMatch(p, 'button.playtest-ctx-action', /^Move to/);
      }),
      ready: '.playtest-ctx-action--submenu.is-open',
      kbdReady: '[data-menu-panel="1"]',
      menu: true,
    },
    {
      route,
      name: 'battlefield card menu',
      open: table((p) => rightClick(p, '.playtest-main .playtest-card', 0)),
      ready: '.ctx-menu',
      menu: true,
    },
    {
      route,
      name: 'life details',
      open: table(click('button.playtest-life-table__total', /life/)),
      ready: '[role=dialog], .modal, .card-picker-sheet',
    },
    {
      route,
      name: 'graveyard',
      open: table(click('button.playtest-pile__open', /graveyard/)),
      ready: '[role=dialog], .modal, .card-picker-sheet',
    },
  ];
}

/**
 * Walk every overlay on this tier. `ctx` is journey.mjs's own page helpers:
 * `visit`-style navigation is done here so each overlay starts from a clean load.
 */
export async function overlayWalk({
  page,
  tierName,
  base,
  settleMs,
  consoleErrors,
  record,
  assertPage,
  deck,
  binder,
}) {
  // JOURNEY_OVERLAYS=<regex> walks only the overlays whose "name route" matches,
  // for iterating on one fix without the 10-minute full walk.
  const only = process.env.JOURNEY_OVERLAYS ? new RegExp(process.env.JOURNEY_OVERLAYS, 'i') : null;
  const items = [...catalog({ deck, binder }), ...(deck ? playtestSteps(deck) : [])].filter(
    (it) => !only || only.test(`${it.name} ${it.route}`)
  );
  for (const it of items) {
    if (!it.route) continue;
    // The app picks its layout by width (640 and under is the phone layout), so a
    // 200% zoom of a 1280 window gets the phone's overlays with a mouse in hand.
    const def = TIERS[tierName] ?? ZOOM_TIERS[tierName];
    const layout = def.width <= 640 ? 'phone' : 'desktop';
    const phoneLike = layout === 'phone';
    if (it.phone && !phoneLike) continue;
    if (it.desktop && phoneLike) continue;
    if (it.touch && !def.hasTouch) continue;
    consoleErrors.length = 0;
    // The table is a landscape surface on a phone (portrait asks to "Turn your
    // phone sideways"), so a phone walks it in landscape.
    const { fontSize: _text, ...t } = TIERS[tierName] ?? ZOOM_TIERS[tierName];
    const landscape = phoneLike && it.route.endsWith('/playtest');
    const load = async () => {
      await page.setViewport(landscape ? { ...t, width: t.height, height: t.width } : t);
      await page.goto(base + it.route, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await sleep(settleMs);
    };
    const openIt = async () => {
      await it.open(page, layout);
      await page.waitForSelector(it.ready, { visible: true, timeout: it.timeout ?? 15_000 });
      await sleep(settleMs / 2);
    };
    await load();
    let err = null;
    try {
      await openIt();
    } catch (e) {
      err = String(e.message ?? e).slice(0, 160);
      if (process.env.JOURNEY_OVERLAYS) {
        const seen = await page.evaluate(() =>
          [...document.querySelectorAll('button,[role=button],a[href]')]
            .filter((b) => b.getBoundingClientRect().width > 0)
            .map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 28))
            .join(' | ')
        );
        console.log(`        visible controls: ${seen}`);
      }
    }
    const label = `${it.route.replace(/deck_[0-9a-f-]+/, '{deck}').replace(/\/binders\/.*/, '/binders/{binder}')} (${it.name})`;
    // The phone's touch floor is measured inside the overlay (`scope`, default:
    // what proves it open); the page behind is the route walk's.
    const rec = await record(label, {
      keyboard: !it.menu && !(tierName in ZOOM_TIERS),
      scope: it.scope ?? it.ready,
    });
    await assertPage(rec, `${it.name} opens`, async () => ({
      ok: !err,
      expected: it.ready,
      observed: err ?? it.ready,
    }));
    if (!it.noPostEscape) {
      await page.keyboard.press('Escape');
      await sleep(400);
    }
    // Keys beyond Tab, on a fresh load opened by keyboard. The table surface
    // itself (`scope: 'body'`) is not an overlay, so it has none.
    if (!err && !it.scope && !(tierName in ZOOM_TIERS)) {
      KEYBOARD_OPEN = true;
      try {
        const found = await keyboardChecks(page, it, async () => {
          await load();
          await openIt();
        });
        for (const f of found) {
          rec.a11y.keyboard.push(f);
          rec.fail = true;
          console.log(`        keyboard (${f.kind}): ${f.el}`);
        }
      } catch (e) {
        const msg = `${it.name}: keyboard pass failed: ${String(e.message ?? e).slice(0, 140)}`;
        rec.a11y.keyboard.push({ kind: 'pass-error', el: msg });
        rec.fail = true;
        console.log(`        keyboard (pass-error): ${msg}`);
      } finally {
        KEYBOARD_OPEN = false;
      }
      await page.keyboard.press('Escape');
    }
  }
  const ran = Object.entries(tally)
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');
  console.log(`keyboard checks run (${tierName}, overlays): ${ran}`);
}
