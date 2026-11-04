// Popup placement walk (--popups). On a screen the route walk already
// visits, finds every popup trigger (InfoTip ⓘ, aria-haspopup buttons, the
// toolbar pills and the legend), opens each with a real hover/focus (tooltips)
// or click (menus), measures the panel against its trigger and closes it.
// The rule is in journey-popups-judge.mjs; a panel off-screen, or not beside
// its trigger, fails the screen with the route, tier, trigger and offsets.
//
// Modals and sheets are meant to be centered or docked, so they are exempt by
// their primitive (aria-modal, or a sheet/modal class), never by route.
// Cost is bounded: CAP triggers of each kind per screen are opened and the rest
// are logged as skipped. Which CAP rotates by day (pickWindow), so a screen with
// more than CAP of a kind has every trigger opened over a few nights. Set
// POPUP_ROTATION=<n> to pick the window by hand.

import { judgePlacement, pickWindow } from './journey-popups-judge.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Triggers opened per kind per screen. */
export const CAP = 8;
/** The window of each kind's triggers this run opens: the day number by default. */
export const ROTATION = process.env.POPUP_ROTATION
  ? Number(process.env.POPUP_ROTATION)
  : Math.floor(Date.now() / 86_400_000);

// By what the trigger says it opens. Not `.toolbar-pill`: that class is also
// every plain toolbar button (Select, Done), and clicking Select left the
// collection grid in select mode, which hid every row's menu from the rest of
// the walk (E1109). The pill popovers (ToolbarPopover, Legend) carry
// aria-haspopup, so they are found by it.
const TRIGGER =
  '.info-tip-btn, [aria-haspopup]:not([aria-haspopup="false"]), .legend-trigger, .overflow-menu-trigger';
const PANEL =
  '[role=tooltip], [role=menu], [role=listbox], [role=dialog], .toolbar-popover-panel, .filter-popover-panel, .legend-popover, .overflow-menu-popover, .deck-editor-overflow-panel, .ctx-menu';
const EXEMPT = '[aria-modal="true"], [class*="sheet"], [class*="modal"], [class*="Sheet"]';

/**
 * Runs in the page: tag the visible triggers and describe them. Each kind's
 * triggers are numbered in DOM order; only the indices in `pick[kind]` are
 * tagged, so the walk opens the window pickWindow chose.
 */
function collect({ trigger, pick }) {
  const seen = new Set();
  const out = [];
  const perKind = {};
  let n = 0;
  for (const el of document.querySelectorAll(trigger)) {
    el.removeAttribute('data-popup-probe');
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (el.disabled || r.width < 4 || r.height < 4 || cs.visibility === 'hidden') continue;
    if (el.closest('[inert], [aria-hidden="true"]')) continue;
    const kind = el.classList.contains('info-tip-btn')
      ? 'tooltip'
      : `popup:${el.getAttribute('aria-haspopup') ?? el.className.toString().split(' ')[0]}`;
    const label = (el.getAttribute('aria-label') || el.textContent || el.className.toString())
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 60);
    const key = `${kind}|${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const k = perKind[kind] ?? 0;
    perKind[kind] = k + 1;
    if (pick && !(pick[kind] ?? []).includes(k)) continue;
    el.setAttribute('data-popup-probe', String(n));
    out.push({ i: n, kind, label });
    n++;
  }
  return { triggers: out, perKind };
}

/** Runs in the page, after opening: the new panel's rect, or why there is none. */
function measure({ i, panelSel, exemptSel, before, t0 }) {
  const trig = document.querySelector(`[data-popup-probe="${i}"]`);
  if (!trig) return { none: 'trigger gone' };
  const fresh = [...document.querySelectorAll(panelSel)].filter((e) => {
    const r = e.getBoundingClientRect();
    return (
      r.width > 0 &&
      r.height > 0 &&
      getComputedStyle(e).visibility !== 'hidden' &&
      !before.includes(e.__probeId)
    );
  });
  // The outermost new panel: a listbox inside a popover panel is the same popup.
  const top = fresh.filter((e) => !fresh.some((o) => o !== e && o.contains(e)));
  if (top.length === 0) return { none: 'no panel opened' };
  const panel = top[0];
  const pos = getComputedStyle(panel).position;
  if (panel.matches(exemptSel) || panel.closest(exemptSel))
    return { exempt: `${panel.tagName.toLowerCase()}.${panel.className.toString().split(' ')[0]}` };
  if (pos !== 'fixed' && pos !== 'absolute') return { exempt: `in-flow (${pos})` };
  const now = trig.getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  const box = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  // The panel was placed against the trigger as it stood when clicked; judge
  // against that, and report separately when the page moved under the panel.
  return {
    t: t0,
    moved: { dx: now.left - t0.left, dy: now.top - t0.top },
    p: box(p),
    vp: { width: window.innerWidth, height: window.innerHeight },
    panel: `${panel.tagName.toLowerCase()}.${panel.className.toString().split(' ')[0] || panel.getAttribute('role')}`,
  };
}

/**
 * @returns {Promise<{findings: string[], checked: number, exempt: number, skipped: string}>}
 */
export async function popupProbe(page, { tierName, label, shot }) {
  const startPath = await page.evaluate(() => location.pathname + location.search);
  // Count each kind first, then tag only this run's window of it.
  const { perKind } = await page.evaluate(collect, { trigger: TRIGGER, pick: null });
  const pick = {};
  const skipped = {};
  for (const [kind, count] of Object.entries(perKind)) {
    pick[kind] = pickWindow(count, CAP, ROTATION);
    if (count > pick[kind].length) skipped[kind] = count - pick[kind].length;
  }
  const { triggers } = await page.evaluate(collect, { trigger: TRIGGER, pick });
  const findings = [];
  let checked = 0;
  let exempt = 0;
  const unreachable = [];
  for (const t of triggers) {
    const handle = await page.$(`[data-popup-probe="${t.i}"]`);
    if (!handle) continue;
    try {
      // 'instant' beats a smooth-scroll rule, and the wait lets the trigger stop
      // moving: a panel placed while the page still scrolls lands where the
      // trigger WAS, which a user clicking a settled page never sees.
      await handle.evaluate(async (el) => {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        let last = '';
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => requestAnimationFrame(r));
          const r = el.getBoundingClientRect();
          const now = `${r.left},${r.top}`;
          if (now === last) break;
          last = now;
        }
      });
      // Mark what is already open so only the new panel is measured.
      const before = await page.evaluate((sel) => {
        let k = 0;
        const ids = [];
        for (const e of document.querySelectorAll(sel)) {
          e.__probeId ??= `p${Date.now()}-${k++}`;
          const r = e.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden')
            ids.push(e.__probeId);
        }
        return ids;
      }, PANEL);
      const tooltip = t.kind === 'tooltip';
      // A mouse is on a menu's trigger before it clicks, and hover can move the
      // trigger (a pile opens to the full card): judge against where it stood
      // under the pointer, which is where the user saw it.
      if (!tooltip && tierName !== 'phone') {
        await handle.hover();
        await sleep(200);
      }
      const t0 = await page.evaluate((i) => {
        const r = document.querySelector(`[data-popup-probe="${i}"]`).getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }, t.i);
      if (tooltip) {
        if (tierName === 'phone') await handle.focus();
        else await handle.hover();
      } else {
        await handle.click();
      }
      await sleep(tooltip ? 160 : 320);
      const m = await page.evaluate(measure, {
        i: t.i,
        panelSel: PANEL,
        exemptSel: EXEMPT,
        before,
        t0,
      });
      if (m.t) {
        checked++;
        const why = judgePlacement(m.t, m.p, m.vp);
        // POPUP_SHOTS=1: keep a picture of every popup that was open, to eyeball what
        // the rule cannot say (clipped text, an arrow at nothing).
        if (process.env.POPUP_SHOTS && !why && shot) await shot(`ok-${t.i}-${t.label}`);
        if (Math.abs(m.moved.dy) > 4 || Math.abs(m.moved.dx) > 4)
          findings.push(
            `${label} [${tierName}] ${t.kind} "${t.label}": the page moved ${Math.round(m.moved.dx)},${Math.round(m.moved.dy)}px under the open ${m.panel}`
          );
        if (why) {
          const file = shot ? await shot(`popup-${t.i}-${t.label}`) : null;
          findings.push(
            `${label} [${tierName}] ${t.kind} "${t.label}" -> ${m.panel}: ${why}${file ? ` (${file})` : ''}`
          );
        }
      } else if (m.exempt) exempt++;
    } catch (e) {
      // Not clickable, detached, covered: the trigger could not be opened, which
      // is not a placement finding. Counted and logged so it cannot hide.
      unreachable.push(`${t.kind} "${t.label}": ${String(e).slice(0, 80)}`);
    } finally {
      // Close: Escape, drop focus and hover; then undo any navigation.
      await page.keyboard.press('Escape').catch(() => {});
      await page.evaluate(() => document.activeElement?.blur?.()).catch(() => {});
      await page.mouse.move(1, 1).catch(() => {});
      await sleep(60);
      const now = await page
        .evaluate(() => location.pathname + location.search)
        .catch(() => startPath);
      if (process.env.POPUP_DEBUG)
        console.log(`        [popup-debug] ${t.kind} "${t.label}" -> ${now}`);
      if (now !== startPath) {
        await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await sleep(600);
        // Re-tag: the page reloaded its DOM.
        await page.evaluate(collect, { trigger: TRIGGER, pick }).catch(() => {});
      }
    }
  }
  const skippedStr = Object.entries(skipped)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  // A popup left a trace (focus, a toggled row, a route change): reload so the
  // steps after this screen's record() start from the page they expect.
  if (checked + exempt + unreachable.length > 0) {
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(1500);
  }
  return { findings, checked, exempt, unreachable, skipped: skippedStr, total: triggers.length };
}
