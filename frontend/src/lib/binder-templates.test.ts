import { describe, it, expect } from 'vitest';
import { STARTER_TEMPLATES } from './binder-templates';
import { cleanFilter } from './clean-filter';
import { SORT_PRESETS } from './sorting';

describe('STARTER_TEMPLATES', () => {
  it('every template is either an action or applies a real (non-empty) constraint', () => {
    // The trap this guards: a `filter` template whose constraint cleans down to
    // empty would silently match the whole collection (the original broken
    // "A set binder" pre-filled `setCodes: []`). Each template must either be
    // an explicit action (revealSets) or survive cleanFilter with content.
    for (const tpl of STARTER_TEMPLATES) {
      if (tpl.revealSets || tpl.colorPick) {
        expect(
          tpl.filter,
          `${tpl.id}: action/color-pick template must not also carry a filter`
        ).toBeUndefined();
        continue;
      }
      expect(tpl.filter, `${tpl.id}: needs a filter, revealSets or colorPick`).toBeDefined();
      const cleaned = cleanFilter(tpl.filter!);
      expect(
        Object.keys(cleaned).length,
        `${tpl.id}: filter cleans to empty (would match all)`
      ).toBeGreaterThan(0);
    }
  });

  it('every grouped template names a real SORT_PRESETS id', () => {
    // The chooser tile shows this preset's name as the order it will use
    // (E495) — an id that doesn't exist would silently show "Custom" instead.
    const presetIds = new Set(SORT_PRESETS.map((p) => p.id));
    for (const tpl of STARTER_TEMPLATES) {
      expect(presetIds.has(tpl.sortPreset), `${tpl.id}: sortPreset "${tpl.sortPreset}"`).toBe(true);
    }
  });

  it('has unique ids', () => {
    const ids = STARTER_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('oracle-tag templates carry lowercase kebab tag values', () => {
    const tagTemplates = STARTER_TEMPLATES.filter((t) => t.filter?.oracleTagChips);
    expect(tagTemplates.length).toBeGreaterThan(0);
    for (const tpl of tagTemplates) {
      for (const chip of tpl.filter!.oracleTagChips!.chips) {
        expect(chip.value, `${tpl.id}`).toMatch(/^[a-z]+(-[a-z]+)*$/);
      }
    }
  });
});
