/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, f), 'utf8');
const gridSlots = read('binder-grid-slots.css');
const cardMgmt = read('binder-card-management.css');
const rulesEditor = read('binder-rules-editor.css');
const forms = read('forms-banners.css');

/**
 * Playtest sweep, batch 4 (binders). Every assertion here was written against
 * a MEASURED box from a real browser at the phone tier
 * (`.claude/tools/binder-manage-probe.mjs`, `e320-e321-measure.mjs`), never
 * from reading the CSS — three static CSS reads in that session were wrong.
 *
 * The recurring judgement these pin down is *ghost vs grow*, which is not a
 * style preference. It depends on what is next to the control:
 *
 *  - `.section-header-toggle` GHOSTS. 66 per binder page with ~312px of
 *    section content between them: nothing to collide with, and growing it
 *    would add ~264px of scroll to the product's headline page.
 *  - `.binder-card-editor-remove` and `.binder-card-editor-drag` GROW. Their
 *    rows are 42px tall and butt together with zero gap, so a ghost would
 *    overhang the neighbouring row — and for Remove, the thing it would
 *    overlap is the next row's *destructive* control.
 *  - Text inputs GROW. A caret and a selection live on the real box; a ghost
 *    cannot receive them.
 */
describe('binder editor coarse-pointer touch targets', () => {
  /** Every body declared for a selector, joined — a selector legitimately
   *  appears in both the base sheet and a `@media (pointer: coarse)` block. */
  function ruleBody(css: string, selector: string): string | null {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const bodies = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map(
      (m) => m[1]
    );
    return bodies.length > 0 ? bodies.join('\n') : null;
  }

  /** The body of every `@media (pointer: coarse)` block in a stylesheet. */
  function coarseBlocks(css: string): string {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out: string[] = [];
    const re = /@media[^{]*\(pointer:\s*coarse\)[^{]*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped))) {
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      while (i < stripped.length && depth > 0) {
        if (stripped[i] === '{') depth++;
        else if (stripped[i] === '}') depth--;
        i++;
      }
      out.push(stripped.slice(start, i - 1));
    }
    return out.join('\n');
  }

  it('reads the stylesheets at all', () => {
    // Guard the guard — an empty read would pass everything below vacuously.
    for (const [name, css] of [
      ['binder-grid-slots.css', gridSlots],
      ['binder-card-management.css', cardMgmt],
      ['binder-rules-editor.css', rulesEditor],
      ['forms-banners.css', forms],
    ] as const) {
      expect(css.length, `${name} read empty`).toBeGreaterThan(500);
    }
  });

  // ── E320 — the section header toggle ghosts ──────────────────────────────
  it('.section-header-toggle carries a >=44px ghost, not a grown box', () => {
    const body = ruleBody(gridSlots, '.section-header-toggle::after');
    expect(
      body,
      '.section-header-toggle measured 374x40 at phone, 66 per binder page. ' +
        'It needs a coarse-pointer hit area.'
    ).toBeTruthy();
    expect(body!).toMatch(/min-height:\s*44px/);
    expect(body!, 'a ghost that is not absolutely positioned collapses onto the page').toContain(
      'position: absolute'
    );
    expect(body!, 'the ghost must centre on its own button').toContain('translateY(-50%)');
    // It only centres against the button if the button is a containing block.
    expect(gridSlots).toMatch(/\.section-header-toggle\s*\{[^}]*position:\s*relative/);
    // `height: 100%` + `min-height` rather than a flat height, so the 12
    // sections that already compute 57px keep their larger target.
    expect(body!, 'a flat height would SHRINK the 57px section headers to 44').toMatch(
      /height:\s*100%/
    );
    // And it must live in a coarse block — a ghost on a mouse eats hover.
    expect(coarseBlocks(gridSlots)).toContain('.section-header-toggle::after');
  });

  it('.section-header-toggle is NOT grown, which would cost ~264px of scroll', () => {
    const base = ruleBody(gridSlots, '.section-header-toggle');
    expect(base).toBeTruthy();
    expect(
      /min-height:\s*44px/.test(coarseBlocks(gridSlots).split('::after')[0] ?? ''),
      '66 toggles x 4px is ~264px of extra scroll on the binder page — the ' +
        'ghost exists precisely to avoid that. If you meant to grow it, delete ' +
        'the ghost and this assertion together, with the scroll cost in the commit.'
    ).toBe(false);
  });

  // ── E322 / E323 — the card editor's two per-row controls grow ────────────
  it('the floor lives on the ROW, not stacked on top of its padding', () => {
    const row = ruleBody(coarseBlocks(cardMgmt), '.binder-card-editor-row');
    expect(
      row,
      'a min-height on the CONTROLS alone stacks 44px on top of the row’s own ' +
        '0.55rem block padding and blows the row out to 63px — measured, and ' +
        '~13,000px of extra scroll over 627 rows. The row carries the floor.'
    ).toBeTruthy();
    expect(row!).toMatch(/min-height:\s*44px/);
    expect(row!, 'without collapsing the padding, 44 becomes 61').toMatch(/padding-block:\s*0/);
  });

  it('.binder-card-editor-remove is 44 wide and stretches to the floored row', () => {
    const coarse = coarseBlocks(cardMgmt);
    expect(
      coarse.includes('.binder-card-editor-remove'),
      '.binder-card-editor-remove measured 17x15 at phone, 627 per binder — a ' +
        'destructive control under WCAG 2.5.8 (24x24) as well as the 44px floor.'
    ).toBe(true);
    const pair = coarse.match(
      /\.binder-card-editor-drag,\s*\.binder-card-editor-remove\s*\{([^}]*)\}/
    );
    expect(pair, 'the two per-row controls share one coarse rule').toBeTruthy();
    expect(pair![1]).toMatch(/min-width:\s*44px/);
    expect(pair![1], 'height comes from stretching into the floored row').toMatch(
      /align-self:\s*stretch/
    );
  });

  it('.binder-card-editor-remove does NOT use a ghost', () => {
    expect(
      ruleBody(cardMgmt, '.binder-card-editor-remove::after'),
      'the editor rows are 42px and butt together with zero gap, so a 44px ' +
        "ghost overhangs into the NEXT row's remove button. Two destructive " +
        'hit areas must not overlap — this control grows instead.'
    ).toBeNull();
  });

  it('.binder-card-editor-drag grows, like the file’s other drag target', () => {
    const coarse = coarseBlocks(cardMgmt);
    expect(
      coarse.includes('.binder-card-editor-drag'),
      '.binder-card-editor-drag measured 22x14. This file already carries the ' +
        'ruling for `.sort-value-order-chip`: a drag listener lives on the real ' +
        'box, so a ghost cannot stand in and the control has to grow.'
    ).toBe(true);
    expect(
      ruleBody(cardMgmt, '.binder-card-editor-drag::after'),
      'a drag listener lives on the real box — a ghost cannot receive it'
    ).toBeNull();
  });

  it('both drag targets in this file are floored, not just the older one', () => {
    // The defect was the rule existing for one of two sibling controls. Assert
    // the pair, so adding a third drag target without a floor fails here.
    const coarse = coarseBlocks(cardMgmt);
    for (const sel of ['.sort-value-order-chip', '.binder-card-editor-drag']) {
      expect(coarse, `${sel} has no coarse-pointer floor`).toContain(sel);
    }
  });

  // ── E321 — text inputs grow, on the shared rule ──────────────────────────
  it('bare form controls carry the floor on the SHARED rule, not per surface', () => {
    const coarse = coarseBlocks(forms);
    expect(
      coarse,
      'the binder editor’s "Binder name" field is a bare <input type="text"> ' +
        'with no class of its own — it measured 42px. The floor belongs on the ' +
        'shared rule in forms-banners.css, or every surface has to remember it.'
    ).toMatch(/input\[type='text'\]/);
    const m = coarse.match(/input\[type='search'\]\s*\{([^}]*)\}/);
    expect(m, 'the shared coarse rule lost its selector list').toBeTruthy();
    expect(m![1]).toMatch(/min-height:\s*44px/);
  });

  it('.filter-group-name is floored despite escaping the shared rule', () => {
    // It has NO `type` attribute, so `input[type='text']` never matched it —
    // which is exactly why it measured 38px while its neighbours read 42.
    const body = ruleBody(coarseBlocks(rulesEditor), '.filter-group-name');
    expect(
      body,
      '.filter-group-name measured 300x38. It is an <input> with no type ' +
        'attribute, so the shared input[type=’text’] rule does not reach it.'
    ).toBeTruthy();
    expect(body!).toMatch(/min-height:\s*44px/);
  });
});
