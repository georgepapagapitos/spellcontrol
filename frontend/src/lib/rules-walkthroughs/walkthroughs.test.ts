import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WALKTHROUGHS, WALKTHROUGH_GROUPS, getWalkthrough } from './index';
import { checkWalkthrough } from './steps';

/**
 * Every walkthrough is checked against the rules it teaches: its states must
 * follow from each other (checkWalkthrough), and every rule number it cites
 * must exist in the bundled Comprehensive Rules the page links into. A rules
 * update that renumbers a rule fails here, naming the step to re-cite.
 */
const bundlePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../public/comprehensive-rules.json'
);
const RULE_NUMBERS = new Set(
  (JSON.parse(readFileSync(bundlePath, 'utf8')) as { rules: { number: string }[] }).rules.map(
    (r) => r.number
  )
);

describe('walkthroughs', () => {
  it.each(WALKTHROUGHS.map((w) => [w.id, w] as const))('%s is consistent', (_id, w) => {
    expect(checkWalkthrough(w)).toEqual([]);
  });

  it('cite only rules that exist in the bundle', () => {
    const missing = WALKTHROUGHS.flatMap((w) =>
      w.steps.flatMap((s, i) =>
        s.cr.filter((n) => !RULE_NUMBERS.has(n)).map((n) => `${w.id} step ${i}: ${n}`)
      )
    );
    expect(missing).toEqual([]);
  });

  it('have unique, URL-safe ids', () => {
    const ids = WALKTHROUGHS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('end the way the index promises: every group has walkthroughs, every walkthrough has steps', () => {
    for (const g of WALKTHROUGH_GROUPS) expect(g.walkthroughs.length).toBeGreaterThan(0);
    for (const w of WALKTHROUGHS) expect(w.steps.length).toBeGreaterThan(1);
  });

  it('looks a walkthrough up by id', () => {
    expect(getWalkthrough('hold-priority')?.title).toBe('Hold priority');
    expect(getWalkthrough('nope')).toBeUndefined();
    expect(getWalkthrough(undefined)).toBeUndefined();
  });
});
