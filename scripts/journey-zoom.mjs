// The resize-text half of the journey's a11y walk (E536 step 4): every route and
// overlay at the sizes a low-vision user actually runs, checked for clipped text.
//
//   zoom        640 x 360 CSS px, dpr 2   WCAG 1.4.4 resize text: a 1280 x 720 window at 200% page zoom
//   reflow      320 x 568 CSS px          WCAG 1.4.10 reflow: 320 CSS px wide, no sideways scroll
//   text        1440 x 900, root 24px     WCAG 1.4.4 in the other direction: the browser's "very large"
//   phone-text  390 x 844, root 24px      font size, so rem text grows and px text does not
//
// The large-text tiers launch their own Chrome with `default_font_size` in the
// profile (the real setting, not an injected rule), see launchPrefs below.
//
// zoomProbe runs inside the page and returns per-check counts next to the
// findings, so a check that inspected nothing is visible in the log instead of
// passing quietly. What it flags:
//
//   clipped-text   a line of text cut by an `overflow: hidden | clip` ancestor. Deliberate
//                  truncation is not a defect: a single-line `text-overflow: ellipsis` and a
//                  `-webkit-line-clamp` box are counted as `ellipsis` and listed as findings
//                  only when nothing names the full text (no title, no aria-label).
//   text-offscreen text pushed past the viewport edge where nothing scrolls to it
//   text-overlap   two text lines painted over each other
//   control-cut    a control partly hidden by a clipping ancestor or the viewport edge
//   chrome-share   fixed/sticky bars at the top and bottom edge taking over half the viewport height
//   fixed-px-text  text whose computed size does not move when the root font size doubles (1.4.4)

export const ZOOM_TIERS = {
  zoom: { width: 640, height: 360, deviceScaleFactor: 2 },
  reflow: { width: 320, height: 568, deviceScaleFactor: 1 },
  text: { width: 1440, height: 900, deviceScaleFactor: 1, fontSize: 24 },
  'phone-text': {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    fontSize: 24,
  },
};

/**
 * Findings that are the design, by `<kind> <selector>`, with the reason. A new
 * entry needs the same: this list is how a real defect would hide.
 *   - The table's hand tray fans its cards under the bottom edge and lifts one on
 *     hover, so a card (and the P/T plate printed on it) is cut there on purpose.
 */
export const ZOOM_BY_DESIGN = new Set([
  'control-cut div.playtest-card.playtest-card--sm',
  'clipped-text span.playtest-card__pt-half',
]);

/** Chrome profile files that set the browser's default font size, as the settings page does. */
export function launchPrefs(fontSize) {
  return { webkit: { webprefs: { default_font_size: fontSize, minimum_logical_font_size: 6 } } };
}

/**
 * Runs in the page. `opts.scalesWithRoot`: also run the fixed-px check (it
 * rewrites the root font size twice, so it only runs where that is the point).
 */
export function zoomProbe(opts) {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const counts = {
    textLines: 0,
    clipBoxes: 0,
    ellipsis: 0,
    controls: 0,
    overlapPairs: 0,
    fixedBars: 0,
    sizedElements: 0,
  };
  const findings = [];
  const seen = new Set();
  const add = (kind, el, detail) => {
    const key = describe(el);
    const id = `${kind} ${key}`;
    if (seen.has(id)) return;
    seen.add(id);
    findings.push({ kind, key, sel: describe(el, false), detail });
  };

  function describe(el, withLabel = true) {
    const cls = [...el.classList].slice(0, 2).join('.');
    if (!withLabel)
      return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${el.id ? '#' + el.id : ''}`;
    const label = (el.getAttribute('aria-label') || el.textContent || '')
      .trim()
      .replace(/\s+/g, ' ');
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${el.id ? '#' + el.id : ''} "${label.slice(0, 28)}"`;
  }
  const named = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement)
      if (e.getAttribute('title') || e.getAttribute('aria-label')) return true;
    return false;
  };
  const shown = (el) =>
    el.checkVisibility({
      checkOpacity: true,
      checkVisibilityCSS: true,
      contentVisibilityAuto: true,
    });
  const clipsAxis = (v) => v === 'hidden' || v === 'clip';
  const scrollsAxis = (v) => v === 'auto' || v === 'scroll';

  /**
   * Walk the ancestors a rect is painted inside and return what survives the
   * clips: `cuts` lists the clipping ancestors that hide part of it, `vis` is
   * the visible remainder, `fixed` says the chain left the document flow.
   * An absolutely positioned box is only clipped from its containing block up,
   * a fixed one by nothing but the viewport.
   */
  function clipWalk(start, rect) {
    let vis = { l: rect.left, t: rect.top, r: rect.right, b: rect.bottom };
    const cuts = [];
    const scrolled = { x: false, y: false };
    let skipStatic = false;
    let fixed = false;
    for (let el = start; el && el !== document.documentElement; el = el.parentElement) {
      const cs = getComputedStyle(el);
      const positioned =
        cs.position !== 'static' ||
        cs.transform !== 'none' ||
        cs.contain.includes('paint') ||
        cs.willChange.includes('transform');
      if (!fixed && !(skipStatic && !positioned)) {
        if (positioned) skipStatic = false;
        const cx = clipsAxis(cs.overflowX);
        const cy = clipsAxis(cs.overflowY);
        const sx = scrollsAxis(cs.overflowX);
        const sy = scrollsAxis(cs.overflowY);
        if (cx || cy || sx || sy) {
          const r = el.getBoundingClientRect();
          const box = {
            l: r.left + el.clientLeft,
            t: r.top + el.clientTop,
            r: r.left + el.clientLeft + el.clientWidth,
            b: r.top + el.clientTop + el.clientHeight,
          };
          // A collapsed box (accordion, closed drawer) hides everything on purpose.
          const collapsed = box.r - box.l < 2 || box.b - box.t < 2;
          if (!collapsed) {
            const outX = vis.l < box.l - 1 || vis.r > box.r + 1;
            const outY = vis.t < box.t - 1 || vis.b > box.b + 1;
            // A scroller reaches what is past its edge, so that axis is judged no further up.
            if (!scrolled.x) {
              if (cx && outX) cuts.push({ el, axis: 'x' });
              if (sx && outX) scrolled.x = true;
              else if (cx || sx) {
                vis.l = Math.max(vis.l, box.l);
                vis.r = Math.min(vis.r, box.r);
              }
            }
            if (!scrolled.y) {
              if (cy && outY) cuts.push({ el, axis: 'y' });
              if (sy && outY) scrolled.y = true;
              else if (cy || sy) {
                vis.t = Math.max(vis.t, box.t);
                vis.b = Math.min(vis.b, box.b);
              }
            }
          }
        }
      }
      if (cs.position === 'absolute') skipStatic = true;
      else if (cs.position === 'fixed') fixed = true;
    }
    return { vis, cuts, fixed, scrolled };
  }

  /** The visually-hidden pattern (clip / clip-path on the element or an ancestor): hidden on purpose. */
  function hiddenByClip(el) {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if ((cs.clip !== 'auto' && cs.position === 'absolute') || cs.clipPath.startsWith('inset(50%'))
        return true;
    }
    return false;
  }

  // --- Text: clipped, off-screen, overlapping ------------------------------------------------
  const lines = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const seenClip = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.data.trim()) continue;
    const parent = n.parentElement;
    if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TITLE)$/.test(parent.tagName) || !shown(parent))
      continue;
    // A skeleton shimmer keeps the card name only until the art paints.
    if (hiddenByClip(parent) || parent.closest('.is-pending')) continue;
    range.selectNodeContents(n);
    const fs = parseFloat(getComputedStyle(parent).fontSize);
    // The range box is the font's content area, up to 1.8em tall in a fallback
    // face and taller than the ink; judge a one-em band at its middle, the glyphs
    // rather than the leading, so a tight line-height box is not a cut.
    const rects = [...range.getClientRects()]
      .filter((r) => r.width > 1 && r.height > 1)
      .map((r) => new DOMRect(r.x, r.y + r.height / 2 - fs / 2, r.width, fs));
    if (!rects.length) continue;
    // Visually hidden text (sr-only) is 1px by design and filtered above; a
    // text box wider than 2 lines of nothing is real text.
    counts.textLines += rects.length;
    const verdicts = rects.map((r) => clipWalk(parent, r));
    // A cut line: some rect is partly outside a clipping ancestor. A rect fully
    // outside one (a slide that is not showing) is not a cut; a node with lines
    // both in and out of it (a fixed-height box) is.
    const cutters = new Map();
    verdicts.forEach((v, i) => {
      for (const c of v.cuts) {
        const r = rects[i];
        const box = c.el.getBoundingClientRect();
        const inside =
          c.axis === 'x'
            ? r.right > box.left && r.left < box.right
            : r.bottom > box.top && r.top < box.bottom;
        const entry = cutters.get(c.el) ?? {
          axis: c.axis,
          partial: inside,
          out: !inside,
          in: false,
        };
        if (inside) entry.partial = true;
        cutters.set(c.el, entry);
      }
    });
    for (const [el, entry] of cutters) {
      if (!entry.partial && !(entry.out && verdicts.some((v) => !v.cuts.some((c) => c.el === el))))
        continue;
      const textBlock = parent;
      const ellipsisX =
        entry.axis === 'x' &&
        [textBlock, el].some((e) => getComputedStyle(e).textOverflow === 'ellipsis');
      const clamp =
        entry.axis === 'y' &&
        [textBlock, el].some((e) => getComputedStyle(e).webkitLineClamp !== 'none');
      if (!seenClip.has(el)) {
        seenClip.add(el);
        counts.clipBoxes += 1;
      }
      if (ellipsisX || clamp) {
        counts.ellipsis += 1;
        if (!named(textBlock))
          add(
            'ellipsis-unnamed',
            textBlock,
            `${entry.axis} cut by ${describe(el)}, no title or aria-label`
          );
        continue;
      }
      add('clipped-text', parent, `${entry.axis} cut by ${describe(el)}`);
    }
    // Off-screen: what is left after the clips still pokes past the edge where nothing scrolls.
    rects.forEach((r, i) => {
      const v = verdicts[i];
      const pastX = !v.scrolled.x && (v.vis.l < -1 || v.vis.r > vw + 1);
      const pastY = v.fixed && !v.scrolled.y && (v.vis.t < -1 || v.vis.b > vh + 1);
      if ((pastX || pastY) && v.vis.r > v.vis.l && v.vis.b > v.vis.t)
        add(
          'text-offscreen',
          parent,
          `${pastX ? 'x' : 'y'} ${Math.round(v.vis.l)}..${Math.round(v.vis.r)} of ${vw}x${vh}`
        );
      if (v.vis.r - v.vis.l > 1 && v.vis.b - v.vis.t > 1 && lines.length < 4000)
        lines.push({ parent, l: v.vis.l, t: v.vis.t, r: v.vis.r, b: v.vis.b });
    });
  }

  // Overlap: two lines of text painted over each other.
  lines.sort((a, b) => a.l - b.l);
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length && lines[j].l < lines[i].r; j++) {
      const a = lines[i];
      const b = lines[j];
      if (a.parent === b.parent) continue;
      const w = Math.min(a.r, b.r) - b.l;
      const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (w <= 0 || h <= 0) continue;
      const small = Math.min((a.r - a.l) * (a.b - a.t), (b.r - b.l) * (b.b - b.t));
      if (w * h < 0.3 * small || w * h < 6) continue;
      counts.overlapPairs += 1;
      if (a.parent.contains(b.parent) || b.parent.contains(a.parent)) continue;
      // Real only if each line is what the eye reaches at that spot with the other
      // one out of the way: text under an opaque bar or a dialog is covered, not overlapped.
      const x = (Math.max(a.l, b.l) + Math.min(a.r, b.r)) / 2;
      const y = (Math.max(a.t, b.t) + Math.min(a.b, b.b)) / 2;
      const reaches = (keep, away) => {
        const prev = away.style.visibility;
        away.style.visibility = 'hidden';
        const top = document.elementFromPoint(x, y);
        away.style.visibility = prev;
        return Boolean(top && keep.contains(top));
      };
      if (!reaches(a.parent, b.parent) || !reaches(b.parent, a.parent)) continue;
      add('text-overlap', a.parent, `over ${describe(b.parent)}`);
    }
  }

  // --- Controls cut by a clip or pushed past the edge ----------------------------------------
  const CONTROLS =
    'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=switch], [role=checkbox], [role=radio], [role=link], [role=option]';
  for (const el of document.querySelectorAll(CONTROLS)) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    counts.controls += 1;
    const v = clipWalk(el.parentElement ?? el, r);
    const area = r.width * r.height;
    const w = v.scrolled.x ? r.width : Math.max(0, Math.min(v.vis.r, vw) - Math.max(v.vis.l, 0));
    // Vertical is judged for a box that leaves the flow: the page scrolls to the rest.
    const h = v.scrolled.y
      ? r.height
      : v.fixed
        ? Math.max(0, Math.min(v.vis.b, vh) - Math.max(v.vis.t, 0))
        : v.vis.b - v.vis.t;
    // A control under a screen-covering fixed layer (the rotate prompt, a dialog's
    // scrim) is not reachable now whatever it measures; the layer is what is on screen.
    const hit = document.elementFromPoint(
      Math.min(Math.max(r.left + r.width / 2, 0), vw - 1),
      Math.min(Math.max(r.top + r.height / 2, 0), vh - 1)
    );
    if (hit && !el.contains(hit) && !hit.contains(el)) {
      let covered = false;
      for (let e = hit; e && e !== document.body; e = e.parentElement) {
        if (getComputedStyle(e).position !== 'fixed') continue;
        const b = e.getBoundingClientRect();
        if (b.width * b.height >= vw * vh * 0.5) covered = true;
      }
      if (covered) continue;
    }
    const seenArea = Math.min(w, r.width) * Math.min(h, r.height);
    const frac = seenArea / area;
    if (frac > 0.05 && frac < 0.9) add('control-cut', el, `${Math.round(frac * 100)}% visible`);
  }

  // --- Bars pinned to the top and bottom edge ------------------------------------------------
  let top = 0;
  let bottom = 0;
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < vw * 0.6 || r.height < 8 || r.height > vh * 0.6) continue;
    counts.fixedBars += 1;
    if (r.top <= 1) top = Math.max(top, r.bottom);
    else if (r.bottom >= vh - 1) bottom = Math.max(bottom, vh - r.top);
  }
  if (top + bottom > vh * 0.5)
    findings.push({
      kind: 'chrome-share',
      key: 'fixed bars',
      sel: 'fixed bars',
      detail: `${Math.round(top)}px top + ${Math.round(bottom)}px bottom of ${vh}px`,
    });

  // --- Text that ignores the browser's text size ----------------------------------------------
  if (opts?.scalesWithRoot) {
    const html = document.documentElement;
    const owners = new Map();
    const w2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w2.nextNode(); n; n = w2.nextNode()) {
      const p = n.parentElement;
      if (!n.data.trim() || !p || owners.has(p) || owners.size > 3000) continue;
      // aria-hidden text is a decorative glyph in a fixed box (the avatar initial), not copy.
      if (
        /^(SCRIPT|STYLE|NOSCRIPT|TITLE)$/.test(p.tagName) ||
        !shown(p) ||
        p.closest('[aria-hidden=true]')
      )
        continue;
      owners.set(p, parseFloat(getComputedStyle(p).fontSize));
    }
    const base = parseFloat(getComputedStyle(html).fontSize);
    const prev = html.style.fontSize;
    html.style.fontSize = `${base * 2}px`;
    for (const [p, before] of owners) {
      counts.sizedElements += 1;
      const after = parseFloat(getComputedStyle(p).fontSize);
      if (before > 1 && Math.abs(after - before) < 0.01)
        add('fixed-px-text', p, `${before}px at root ${base}px and at root ${base * 2}px`);
    }
    html.style.fontSize = prev;
  }

  return { counts, findings };
}
