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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Click the first visible element whose aria-label or text matches. */
async function clickMatch(page, sel, re, { timeout = 15_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const hit = await page.evaluate(
      ({ sel, src, flags }) => {
        const rx = new RegExp(src, flags);
        const el = [...document.querySelectorAll(sel)].find(
          (e) =>
            e.getBoundingClientRect().width > 0 &&
            !e.disabled &&
            rx.test(((e.getAttribute('aria-label') ?? '') + ' ' + (e.textContent ?? '')).trim())
        );
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        el.click();
        return true;
      },
      { sel, src: re.source, flags: re.flags }
    );
    if (hit) return;
    await sleep(250);
  }
  throw new Error(`nothing matching ${sel} ${re}`);
}

/** Right-click the nth element of `sel` with a real mouse, as a user does. */
async function rightClick(page, sel, n = 0) {
  await page.waitForSelector(sel, { timeout: 15_000 });
  const at = await page.evaluate(
    ({ sel, n }) => {
      const el = document.querySelectorAll(sel)[n];
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { sel, n }
  );
  if (!at) throw new Error(`no ${sel} #${n}`);
  await page.mouse.click(at.x, at.y, { button: 'right' });
}

const MENU = '[role=menu], .ctx-menu, .toolbar-popover-panel, .deck-editor-overflow-panel';

/**
 * Every overlay: where it lives, how to open it, what proves it is open, and
 * whether it is a menu (`menu: true` skips the Tab walk). `open(page)` runs
 * on a fresh load of `route`. Everything runs on the desktop tier, where the
 * axe theme and type-set sweeps run; `phone: true` items run on the phone tier
 * only (the scanner is gated to phones and tablets). The phone's own touch
 * probes (44px floor and friends) are not run inside overlays: the deck page
 * behind them has its own findings there, tracked on E1000.
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
      open: click('button.pill-btn', /^Import deck/),
      ready: '.import-deck-modal',
    },
    {
      route: '/decks',
      name: 'account menu',
      open: click('button.site-avatar-menu-trigger', /Account menu/),
      ready: MENU,
      menu: true,
    },
    {
      route: '/decks',
      name: 'keyboard shortcuts',
      open: click('button.footer-shortcuts-chip', /shortcuts/),
      ready: '.shortcuts-overlay',
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
      open: click('button.deck-visibility-chip', /Sharing:/),
      ready: '.share-dialog',
    },
    {
      route: deck,
      name: 'format sheet',
      open: click('button.deck-format-link', /Format:/),
      ready: '.deck-format-sheet',
    },
    // Allowance (ratchet: shrinks only, and a stale one fails): each result row
    // is a listbox option that holds its own add / preview / dismiss buttons.
    // The fix is a different pattern (rows as a list, the input off the
    // listbox), tracked on E536.
    {
      route: deck,
      name: 'add cards sheet',
      open: click('button.btn-primary', /^Add cards/),
      ready: '.deck-add-sheet',
      allow: ['nested-interactive'],
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
      open: click('button.toolbar-pill', /^View options/),
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
    },
    {
      route: '/collection',
      name: 'export dialog',
      open: click('button.pill-btn', /^Export/),
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
      open: click('button.scan-fab-btn', /./),
      ready: '.scanner-root',
      phone: true,
      timeout: 45_000,
    },
    ...(binder
      ? [
          // Allowance: SnapCarousel slides are role=button and hold the page's tappable
          // cards. The fix is a slide role that is not a button when a slide has its
          // own controls (E536).
          {
            route: binder,
            name: 'binder pages viewer',
            open: click('.binder-summary button', /^Browse/),
            ready: '.binder-pages-slide.is-active',
            allow: ['nested-interactive'],
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
    { route, name: 'opening hand sheet', open: async () => {}, ready: '.playtest-opening-sheet' },
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
    },
    {
      route,
      name: 'resume game dialog',
      open: async () => {},
      ready: '[role=dialog], [role=alertdialog]',
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
      open: table((p) => rightClick(p, '.playtest-hand__cards .playtest-card', 0)),
      ready: '.ctx-menu',
      menu: true,
    },
    {
      route,
      name: 'hand card submenu',
      open: table(async (p) => {
        await rightClick(p, '.playtest-hand__cards .playtest-card', 0);
        await clickMatch(p, 'button.playtest-ctx-action', /^Move to/);
      }),
      ready: '.playtest-ctx-action--submenu.is-open',
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
  const items = [...catalog({ deck, binder }), ...(deck ? playtestSteps(deck) : [])];
  for (const it of items) {
    if (!it.route) continue;
    if (it.phone ? tierName !== 'phone' : tierName !== 'desktop') continue;
    consoleErrors.length = 0;
    await page.goto(base + it.route, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await sleep(settleMs);
    let err = null;
    try {
      await it.open(page);
      await page.waitForSelector(it.ready, { visible: true, timeout: it.timeout ?? 15_000 });
      await sleep(settleMs / 2);
    } catch (e) {
      err = String(e.message ?? e).slice(0, 160);
    }
    const label = `${it.route.replace(/deck_[0-9a-f-]+/, '{deck}').replace(/\/binders\/.*/, '/binders/{binder}')} (${it.name})`;
    const rec = await record(label, { keyboard: !it.menu, allow: it.allow });
    await assertPage(rec, `${it.name} opens`, async () => ({
      ok: !err,
      expected: it.ready,
      observed: err ?? it.ready,
    }));
    if (it.allow) {
      await assertPage(rec, `${it.name} still needs its allowance`, async () => ({
        ok: rec.allowed > 0,
        expected: `${it.allow.join(', ')} still fires (then keep the allowance)`,
        observed: rec.allowed > 0 ? rec.allowed : 'it no longer fires: delete the allowance',
      }));
    }
    await page.keyboard.press('Escape');
    await sleep(400);
  }
}
