/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'play-counters-panel.css'), 'utf8');

/** The declaration block of the first rule whose selector list matches `selector` exactly. */
function rule(selector: string): string {
  const escaped = selector.replace(/[\\^$.*+?()[\]{}|-]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  expect(m, selector).not.toBeNull();
  return m![1];
}

/**
 * A seat in a dungeon shows the dungeon's name and the room it stands in. Both
 * are long ("Lost Mine of Phandelver", "Cradle of the Death God") and the
 * badge was capped at 9rem with the room unable to shrink, so the dungeon's
 * name collapsed to a 0px label and the board never said which dungeon a seat
 * was in (found in a real-browser pass, 2026-11-02). The badge stacks the two
 * and each truncates on its own against the seat width.
 */
describe('dungeon badge on the seat', () => {
  it('stacks the dungeon and the room, bounded by the seat', () => {
    const body = rule('.pp-counter-badge.is-dungeon');
    expect(body).toMatch(/flex-direction:\s*column/);
    expect(body).toMatch(/max-width:\s*100%/);
  });

  it('the badge row is bound on both sides so 100% means the seat width', () => {
    const body = rule('.player-panel-counters');
    expect(body).toMatch(/left:/);
    expect(body).toMatch(/right:/);
    expect(body).toMatch(/flex-wrap:\s*wrap/);
  });
});
