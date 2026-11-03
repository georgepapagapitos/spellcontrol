/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// computePopoverPlacement no longer clamps a panel that is taller than the room
// beside its trigger up over that trigger (the popup walk caught Discover's
// Filters panel and the search syntax cheatsheet doing exactly that). It keeps
// the panel adjacent and publishes the room as `--panel-room`; the panel must cap
// itself to it, or a tall one runs off the screen edge instead.
// If this fails: a panel class lost its `var(--panel-room` cap, or a component
// that anchors a panel to a trigger stopped publishing the room. Fix the panel,
// don't add it to the exemptions.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function files(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...files(full, ext));
    else if (e.name.endsWith(ext) && !e.name.includes('.test.')) out.push(full);
  }
  return out;
}

const css = files(srcRoot, '.css')
  .map((f) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
  .join('\n');

/** The body of the (first) rule whose selector list ends in exactly `sel`. */
function rule(sel: string): string {
  const esc = sel.replace(/[.[\]]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n|,\\s*)${esc}\\s*(?:,[^{]*)?\\{([^}]*)\\}`));
  expect(m, `${sel} rule`).not.toBeNull();
  return m![1];
}

describe('anchored panels cap themselves to --panel-room', () => {
  for (const sel of [
    '.deck-row-menu-popover',
    '.toolbar-popover-panel',
    '.deck-editor-overflow-panel',
    '.search-syntax-panel.toolbar-popover-panel',
    '.filter-popover-panel',
  ]) {
    it(`${sel} reads var(--panel-room) in its max-height and scrolls`, () => {
      const body = rule(sel);
      expect(body).toMatch(/max-height:[^;]*var\(--panel-room/);
      // The cheatsheet's overflow lives on the .toolbar-popover-panel base it extends.
      if (!sel.startsWith('.search-syntax-panel')) expect(body).toMatch(/overflow-y:\s*auto/);
    });
  }
});

describe('components that anchor a panel publish the room', () => {
  // Own sizing, reviewed: InfoTip's bubble is a few lines of text and
  // ReactionPicker's is one row of six emotes; Legend and SelectMenu size to the
  // room themselves (inline maxHeight).
  const OWN_SIZING = ['InfoTip.tsx', 'Legend.tsx', 'SelectMenu.tsx', 'ReactionPicker.tsx'];
  const callers = files(srcRoot, '.tsx').filter((f) =>
    /computePopoverPlacement\(/.test(readFileSync(f, 'utf8'))
  );
  it('finds the anchored-panel components', () => {
    expect(callers.length).toBeGreaterThanOrEqual(6);
  });
  for (const f of callers) {
    const name = f.split('/').pop()!;
    if (OWN_SIZING.includes(name)) continue;
    it(`${name} spreads panelRoomStyle`, () => {
      expect(readFileSync(f, 'utf8')).toContain('panelRoomStyle(');
    });
  }
});
