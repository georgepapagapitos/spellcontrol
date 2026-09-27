/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// T153: a copy's details were picked through toolbar pills ("Condition Not
// set ▾"), which hid every option but one and read as a filter chip, not a
// form. Two kit rules replaced them, and both are CSS nothing else checks:
//   1. a SelectMenu inside a Field is a field-width rect on the segmented
//      track's surface, never the round toolbar pill;
//   2. a `fill` segmented track spans its field and shares it equally, which
//      is what keeps all five condition grades whole at 320px.
const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(src, 'components', 'shared', 'form.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);

function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} rule is missing`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
}

describe('form kit field controls', () => {
  it('draws a SelectMenu inside a Field as a field-width rect, not a pill', () => {
    const trigger = rule('.form-field > .toolbar-popover > .toolbar-pill');
    expect(trigger).toMatch(/width:\s*100%/);
    expect(trigger).toMatch(/border-radius:\s*var\(--radius-lg\)/);
    expect(trigger).not.toMatch(/999px/);
    expect(rule('.form-field > .toolbar-popover')).toMatch(/align-self:\s*stretch/);
  });

  it('keeps the field select on the touch floor', () => {
    const coarse = css.slice(
      css.indexOf('@media (pointer: coarse)', css.indexOf('.form-field > .toolbar-popover'))
    );
    expect(coarse.slice(0, 200)).toMatch(/\.toolbar-pill\s*\{\s*min-height:\s*44px/);
  });

  it('lets a fill track share its width equally', () => {
    expect(rule('.segmented--fill')).toMatch(/width:\s*100%/);
    const option = rule('.segmented--fill .segmented-option');
    expect(option).toMatch(/flex:\s*1 1 0/);
    expect(option).toMatch(/min-width:\s*0/);
  });

  it('uses fill for both copy controls', () => {
    const controls = readFileSync(join(src, 'components', 'CopyControls.tsx'), 'utf8');
    expect(controls.match(/<SegmentedControl<[^>]+>\s+fill/g)).toHaveLength(2);
  });
});
