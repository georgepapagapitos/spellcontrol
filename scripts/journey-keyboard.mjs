// The keyboard half of the overlay walk (E536 step 2). journey.mjs's Tab walk
// proves every stop has a ring; it says nothing about what the OTHER keys do.
// For each overlay this opens it the way a keyboard user does and checks:
//
//   focus-in      focus is inside the overlay once it is open
//   arrows        a menu or listbox moves focus with ArrowDown/ArrowUp, and
//                 Home/End jump to the first/last item
//   activate      Enter and Space on the focused item click it
//   trap          Tab never leaves a modal dialog or sheet (a popover or a
//                 menu must let focus go: Tab closes it or moves on)
//   tabs          a tablist moves between tabs with ArrowRight/ArrowLeft and
//                 Home/End, and keeps one tab stop (roving tabindex)
//   escape        Escape closes the overlay
//   focus-return  focus goes back to the opener; if the opener is gone, to the
//                 nearest opener before it that still is (a dialog opened from
//                 a menu item returns to the menu's trigger). Never to <body>.
//
// Findings are returned as `{ kind, el }` and ride the journey's existing
// keyboard channel into a11y.json.

/**
 * How many overlays each check actually ran on. A check that finds nothing
 * because nothing reached it would read as green, so the walk prints this.
 */
export const tally = {};
const ran = (k) => (tally[k] = (tally[k] ?? 0) + 1);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ITEM_SEL =
  '[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[role=option],[role=radio]';
// What Home/End may land on: the items, or any button the menu also roves over
// (the sort listbox ends in a "Reverse sort order" button).
const ROVE_SEL = `${ITEM_SEL},button`;

/** Everything the page-side helpers share, installed once per load. */
const HELPERS = `
  window.__kb = {
    // A tablist wrapped in display: contents has no box of its own: its tabs do.
    stripVisible(list) {
      return (
        window.__kb.visible(list) ||
        [...list.querySelectorAll('[role=tab]')].some((t) => window.__kb.visible(t))
      );
    },
    visible(el) {
      if (!el || !el.isConnected) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none';
    },
    describe(el) {
      if (!el) return 'nothing';
      if (el === document.body) return 'body';
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/)[0] : '';
      const name = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30);
      return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + ' "' + name + '"';
    },
    panel(sel) {
      return [...document.querySelectorAll(sel)].find((e) => window.__kb.visible(e)) ?? null;
    },
    // The box focus must stay in: the dialog around the proof-of-open node.
    root(panel) {
      return panel.closest('[role=dialog],[role=alertdialog],[aria-modal=true],.modal') ?? panel;
    },
    // Where the keyboard is: a roving focus, or an aria-activedescendant highlight.
    current() {
      const a = document.activeElement;
      const id = a && a.getAttribute && a.getAttribute('aria-activedescendant');
      return (id && document.getElementById(id)) || a;
    },
  };
`;

async function install(page) {
  await page.evaluate(HELPERS);
}

/** Press a key and let the handlers (and rAF-deferred focus moves) land. */
async function press(page, key, ms = 90) {
  await page.keyboard.press(key);
  await sleep(ms);
}

/** What the page-side `panel`/`root` resolve to, plus the overlay's kind. */
async function inspect(page, it) {
  return page.evaluate(
    ({ ready, menu, itemSel, forceDialog }) => {
      const k = window.__kb;
      const panel = k.panel(ready);
      if (!panel) return null;
      const menuEl = panel.matches('[role=menu]') ? panel : panel.querySelector('[role=menu]');
      const listEl = panel.matches('[role=listbox]')
        ? panel
        : panel.querySelector('[role=listbox]');
      const host = menuEl ?? listEl ?? panel;
      const items = [...host.querySelectorAll(itemSel)].filter(
        (e) => k.visible(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true'
      );
      const kind = menuEl
        ? 'menu'
        : listEl
          ? 'listbox'
          : menu && !forceDialog
            ? 'popover'
            : 'dialog';
      const root = k.root(panel);
      const a = document.activeElement;
      return {
        kind,
        items: items.length,
        tabs: [...root.querySelectorAll('[role=tablist]')].filter((t) => k.stripVisible(t)).length,
        focusInside: !!a && a !== document.body && root.contains(a),
        active: k.describe(a),
        rootTab: root.getAttribute('tabindex'),
        rootDesc: k.describe(root),
      };
    },
    { ready: it.ready, menu: !!it.menu, itemSel: ITEM_SEL, forceDialog: it.kbdKind === 'dialog' }
  );
}

/** Move through the items with the arrow keys, Home and End. */
async function checkArrows(page, it, kind, out) {
  const read = () =>
    page.evaluate(
      ({ ready, itemSel, roveSel }) => {
        const k = window.__kb;
        const panel = k.panel(ready);
        if (!panel) return null;
        const host =
          (panel.matches('[role=menu],[role=listbox]')
            ? panel
            : panel.querySelector('[role=menu],[role=listbox]')) ?? panel;
        const live = (e) =>
          k.visible(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true';
        const items = [...host.querySelectorAll(itemSel)].filter(live);
        // The listbox sits in a panel that also holds the footer's buttons.
        const surface = host.closest('.toolbar-popover-panel') ?? host.parentElement ?? host;
        const rove = [...surface.querySelectorAll(roveSel)].filter(live);
        const cur = k.current();
        return {
          at: items.indexOf(cur),
          n: items.length,
          // Home/End target either list's ends.
          first: cur === items[0] || cur === rove[0],
          last: cur === items[items.length - 1] || cur === rove[rove.length - 1],
          moved: items.indexOf(cur) >= 0 || rove.indexOf(cur) >= 0,
          cur: k.describe(cur),
          inside: !!cur && host.contains(cur),
        };
      },
      { ready: it.ready, itemSel: ITEM_SEL, roveSel: ROVE_SEL }
    );
  const start = await read();
  // Nothing to move between, or focus began outside the roving list (a dialog
  // panel of mixed controls whose menu list sits further down): the arrows are
  // not the way into it, so there is no way back to compare against.
  if (!start || start.n < 2 || start.at < 0) return false;
  await press(page, 'ArrowDown');
  const down = await read();
  if (!down?.inside || !down.moved || down.cur === start.cur) {
    out.push({
      kind: 'arrow-down',
      el: `${it.name}: ArrowDown from ${start.cur} did not move to the next item (now ${down?.cur})`,
    });
    return true;
  }
  await press(page, 'ArrowUp');
  const up = await read();
  if (!up || up.cur !== start.cur) {
    out.push({
      kind: 'arrow-up',
      el: `${it.name}: ArrowUp did not come back to ${start.cur} (now ${up?.cur})`,
    });
  }
  await press(page, 'End');
  const end = await read();
  if (!end?.last) {
    out.push({
      kind: 'end',
      el: `${it.name}: End did not reach the last item (now ${end?.cur})`,
    });
  }
  await press(page, 'Home');
  const home = await read();
  if (!home?.first) {
    out.push({
      kind: 'home',
      el: `${it.name}: Home did not reach the first item (now ${home?.cur})`,
    });
  }
  return true;
}

/**
 * Enter and Space on the focused item must click it. The click is caught and
 * cancelled at the document, so the check never fires the item's action.
 */
async function checkActivate(page, it, out) {
  const target = await page.evaluate(
    ({ ready, itemSel }) => {
      const k = window.__kb;
      const panel = k.panel(ready);
      if (!panel) return null;
      const host =
        (panel.matches('[role=menu],[role=listbox]')
          ? panel
          : panel.querySelector('[role=menu],[role=listbox]')) ?? panel;
      const el = [...host.querySelectorAll(itemSel)].find(
        (e) => k.visible(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true'
      );
      if (!el) return null;
      el.focus({ preventScroll: true });
      window.__kbClicks = [];
      window.__kbCatch = (e) => {
        window.__kbClicks.push(e.target);
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      document.addEventListener('click', window.__kbCatch, true);
      return k.describe(el);
    },
    { ready: it.ready, itemSel: ITEM_SEL }
  );
  if (!target) return;
  for (const key of ['Enter', ' ']) {
    await page.evaluate(() => (window.__kbClicks.length = 0));
    await press(page, key, 150);
    const hit = await page.evaluate(() => {
      const t = window.__kbClicks[0];
      const a = document.activeElement;
      return !!t && !!a && (t === a || a.contains(t) || t.contains(a));
    });
    if (!hit) {
      out.push({
        kind: 'activate',
        el: `${it.name}: ${key === ' ' ? 'Space' : 'Enter'} on ${target} did not activate it`,
      });
    }
  }
  await page.evaluate(() => document.removeEventListener('click', window.__kbCatch, true));
}

/** A modal keeps Tab inside; a menu or popover lets it go. */
async function checkTab(page, it, kind, out) {
  const probe = () =>
    page.evaluate((ready) => {
      const k = window.__kb;
      const panel = k.panel(ready);
      if (!panel) return { closed: true };
      const a = document.activeElement;
      return {
        closed: false,
        inside: !!a && a !== document.body && k.root(panel).contains(a),
        cur: k.describe(a),
      };
    }, it.ready);
  const modal = kind === 'dialog';
  const stops = await page.evaluate(
    (ready) => document.querySelectorAll('button,a[href],input,select,textarea,[tabindex]').length,
    it.ready
  );
  const presses = Math.min(stops + 3, 45);
  let left = null;
  let before = null;
  for (let i = 0; i < presses; i++) {
    before = (await probe()).cur;
    await press(page, 'Tab', 50);
    const p = await probe();
    if (p.closed || !p.inside) {
      left = { ...p, cur: `${p.cur} (Tab ${i + 1} of ${presses}, from ${before})` };
      break;
    }
  }
  if (modal && left) {
    out.push({
      kind: 'trap-leak',
      el: `${it.name}: Tab left the modal ${left.closed ? '(it closed)' : `for ${left.cur}`}`,
    });
  }
  if (!modal && !left) {
    out.push({
      kind: 'popover-trap',
      el: `${it.name}: ${presses} Tab presses never left the ${kind} (a non-modal popover must not trap focus)`,
    });
  }
}

/** Arrow keys, Home and End between the tabs of every visible tablist. */
async function checkTabs(page, it, out) {
  // A page's own tab strip is no overlay: the whole document is the scope.
  const lists = await page.evaluate(
    ({ ready, whole }) => {
      const k = window.__kb;
      const panel = k.panel(ready);
      if (!panel) return 0;
      return [...(whole ? document : k.root(panel)).querySelectorAll('[role=tablist]')].filter(
        (t) => k.stripVisible(t)
      ).length;
    },
    { ready: it.ready, whole: !!it.tabsOnly }
  );
  for (let n = 0; n < lists; n++) {
    const setup = await page.evaluate(
      ({ ready, n, whole }) => {
        const k = window.__kb;
        const panel = k.panel(ready);
        const list = [
          ...(whole ? document : k.root(panel)).querySelectorAll('[role=tablist]'),
        ].filter((t) => k.stripVisible(t))[n];
        const tabs = [...list.querySelectorAll('[role=tab]')].filter((t) => k.visible(t));
        if (tabs.length < 2) return null;
        const stops = tabs.filter((t) => t.tabIndex >= 0).length;
        const sel = tabs.find((t) => t.getAttribute('aria-selected') === 'true') ?? tabs[0];
        sel.focus({ preventScroll: true });
        return {
          stops,
          n: tabs.length,
          vertical: list.getAttribute('aria-orientation') === 'vertical',
          label: list.getAttribute('aria-label') ?? k.describe(list),
        };
      },
      { ready: it.ready, n, whole: !!it.tabsOnly }
    );
    if (!setup) continue;
    // The strip can re-render under a tab change (a route tab navigates), so
    // it is found again by position each time, not held.
    const whereNow = () =>
      page.evaluate(
        ({ ready, n, whole }) => {
          const k = window.__kb;
          const panel = k.panel(ready);
          const lists = [
            ...(whole || !panel ? document : k.root(panel)).querySelectorAll('[role=tablist]'),
          ].filter((t) => k.stripVisible(t));
          const tabs = [...(lists[n]?.querySelectorAll('[role=tab]') ?? [])].filter((t) =>
            k.visible(t)
          );
          return { at: tabs.indexOf(document.activeElement), n: tabs.length };
        },
        { ready: it.ready, n, whole: !!it.tabsOnly }
      );
    // A route tab loads its page lazily: give the new strip a moment to appear.
    const where = async () => {
      let w = await whereNow();
      for (let i = 0; i < 20 && w.at < 0; i++) {
        await sleep(100);
        w = await whereNow();
      }
      return w;
    };
    if (setup.stops !== 1) {
      out.push({
        kind: 'tabs-roving',
        el: `${it.name}: tablist "${setup.label}" has ${setup.stops} tab stops, expected 1 (roving tabindex)`,
      });
    }
    const [next, prev] = setup.vertical ? ['ArrowDown', 'ArrowUp'] : ['ArrowRight', 'ArrowLeft'];
    const first = await where();
    await press(page, first.at === first.n - 1 ? prev : next, 150);
    const moved = await where();
    if (moved.at < 0 || moved.at === first.at) {
      out.push({
        kind: 'tabs-arrow',
        el: `${it.name}: ${next} did not move between the tabs of "${setup.label}"`,
      });
      continue;
    }
    await press(page, 'End', 150);
    const end = await where();
    if (end.at !== end.n - 1)
      out.push({
        kind: 'tabs-end',
        el: `${it.name}: End did not reach the last tab of "${setup.label}"`,
      });
    await press(page, 'Home', 150);
    const home = await where();
    if (home.at !== 0)
      out.push({
        kind: 'tabs-home',
        el: `${it.name}: Home did not reach the first tab of "${setup.label}"`,
      });
  }
}

/** Escape closes it, and focus goes back to where the person was. */
async function checkEscape(page, it, out) {
  await press(page, 'Escape', 700);
  const after = await page.evaluate(
    ({ ready, expectFocus }) => {
      const k = window.__kb;
      const open = !!k.panel(ready);
      const openers = (window.__kbOpeners ?? []).filter((e) => e.isConnected && k.visible(e));
      const want = openers[openers.length - 1] ?? null;
      const a = document.activeElement;
      return {
        open,
        want: want ? k.describe(want) : null,
        got: k.describe(a),
        ok: want ? a === want : !!a && a !== document.body,
        expectFocus,
      };
    },
    { ready: it.ready, expectFocus: !it.noRestore }
  );
  if (it.noEscape) {
    // A must-answer sheet (keep or mulligan): Escape is deliberately dead.
    if (!after.open)
      out.push({ kind: 'escape', el: `${it.name}: Escape closed a must-answer overlay` });
    return;
  }
  if (after.open) {
    out.push({ kind: 'escape', el: `${it.name}: Escape did not close it` });
    return;
  }
  if (!after.ok && after.expectFocus) {
    out.push({
      kind: 'focus-return',
      el: `${it.name}: after Escape focus is on ${after.got}, expected ${after.want ?? 'something other than the page body'}`,
    });
  }
}

/**
 * Run every check on one overlay. `reopen()` loads the screen and opens the
 * overlay again (a check that closes it, or whose key press acted on it,
 * starts from a clean one). Returns the findings.
 */
export async function keyboardChecks(page, it, reopen) {
  const out = [];
  // An overlay whose proof-of-open node is not the box focus lives in (a
  // submenu's trigger button) names the real one.
  it = { ...it, ready: it.kbdReady ?? it.ready };
  const fresh = async () => {
    await reopen();
    await install(page);
    return inspect(page, it);
  };

  // 1. focus-in, arrows, Home/End, tabs: one open.
  let info = await fresh();
  if (!info) return [{ kind: 'open', el: `${it.name}: not open for the keyboard pass` }];
  if (it.tabsOnly) {
    // A tab strip on the page, not an overlay: arrows and roving tabindex only.
    ran('tablist arrows');
    await checkTabs(page, it, out);
    return out;
  }
  if (!info.focusInside) {
    out.push({
      kind: 'focus-in',
      el: `${it.name}: focus is on ${info.active} after open, outside the ${info.kind} (${info.rootDesc}, tabindex ${info.rootTab})`,
    });
  }
  ran(`focus-in (${info.kind})`);
  if ((info.kind === 'menu' || info.kind === 'listbox') && info.items > 0) {
    if (await checkArrows(page, it, info.kind, out)) ran('arrows, Home, End');
  }
  if (info.tabs > 0) {
    ran('tablist arrows');
    await checkTabs(page, it, out);
  }

  // 2. Enter and Space on an item.
  if ((info.kind === 'menu' || info.kind === 'listbox') && info.items > 0) {
    info = await fresh();
    if (info) {
      ran('Enter and Space');
      await checkActivate(page, it, out);
    }
  }

  // 3. Tab: trapped in a modal, released from a popover or a menu.
  info = await fresh();
  if (info) {
    ran(info.kind === 'dialog' ? 'Tab trapped' : 'Tab released');
    await checkTab(page, it, info.kind, out);
  }

  // 4. Escape, then where focus went.
  info = await fresh();
  if (info) {
    ran('Escape and focus return');
    await checkEscape(page, it, out);
  }
  return out;
}
