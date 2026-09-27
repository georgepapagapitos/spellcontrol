// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CubeResult } from './CubeResult';
import type { GeneratedCube, Pick } from '../../lib/cube/generate';
import type { LegendPick } from '../../lib/cube/legend';
import { BUCKET_ORDER } from './shared';

function pick(i: number): Pick {
  return {
    card: {
      name: `Spell ${i}`,
      oracleId: `spell-${i}`,
      colors: ['U'],
      cmc: 2,
      typeLine: 'Creature',
      role: null,
    },
    bucket: 'U',
    reason: 'goodstuff',
  };
}

function legend(i: number, identity: LegendPick['identity'] = 'G'): LegendPick {
  return {
    card: {
      name: `Legend ${i}`,
      oracleId: `legend-${i}`,
      colors: [identity as string].filter((c) => c.length === 1),
      cmc: 3,
      typeLine: 'Legendary Creature — Test',
      role: null,
    },
    identity,
    reason: 'G legend (1 of 5)',
  };
}

const ZERO_BUCKETS = Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0])) as Record<
  (typeof BUCKET_ORDER)[number],
  number
>;

function cube(over: Partial<GeneratedCube>): GeneratedCube {
  return {
    size: 180,
    format: 'limited',
    picks: Array.from({ length: 20 }, (_, i) => pick(i)),
    byBucket: ZERO_BUCKETS,
    targetByBucket: ZERO_BUCKETS,
    gaps: [],
    shortfall: 0,
    poolSize: 20,
    ...over,
  };
}

const NOOP_STRING = () => 'unowned' as const;
const NOOP_ARR = () => [];

function renderCube(c: GeneratedCube) {
  return render(
    <CubeResult
      cube={c}
      onCopy={() => {}}
      onSave={() => {}}
      loaded={null}
      ownershipFor={NOOP_STRING}
      committedFor={NOOP_ARR}
      enrichedMap={new Map()}
    />
  );
}

describe('CubeResult — Commanders section (board #12, PR3)', () => {
  it('a limited cube shows neither the Commanders section nor coverage — Draftability stays', () => {
    renderCube(cube({ format: 'limited' }));
    expect(document.querySelector('.cube-commanders')).toBeNull();
    expect(document.querySelector('.cube-commander-coverage')).toBeNull();
    expect(screen.getByRole('button', { name: 'Draftability' })).toBeTruthy();
  });

  it('a Commander cube with a real legend section shows it above the spell buckets, and coverage replaces Draftability', () => {
    const legends = [legend(1, 'G'), legend(2, 'G'), legend(3, 'WU')];
    renderCube(cube({ format: 'commander', legends }));

    const commanders = document.querySelector('.cube-commanders');
    expect(commanders).not.toBeNull();
    expect(within(commanders as HTMLElement).getByText('3')).toBeTruthy();
    expect(within(commanders as HTMLElement).getAllByRole('button')).toHaveLength(3);

    // Above the spell buckets: Commanders' own header precedes "The cards".
    const headings = [...document.querySelectorAll('h3, h4')].map((h) => h.textContent?.trim());
    const commandersAt = headings.findIndex((h) => h?.startsWith('Commanders'));
    const cardsAt = headings.indexOf('The cards');
    expect(commandersAt).toBeGreaterThanOrEqual(0);
    expect(cardsAt).toBeGreaterThan(commandersAt);

    expect(screen.queryByRole('button', { name: 'Draftability' })).toBeNull();
    expect(screen.getByText('Commander coverage')).toBeTruthy();
    expect(screen.getByText(/3 commanders across 2 colour identities/)).toBeTruthy();
  });

  it('empty state: a Commander cube saved before legends existed (`legends` undefined) explains itself', () => {
    renderCube(cube({ format: 'commander', legends: undefined }));
    expect(screen.getByText(/built before Commander cubes had a legend section/)).toBeTruthy();
    expect(screen.getByText(/No legend section yet/)).toBeTruthy();
    // No gallery/rows to render for a section with nothing to show.
    expect(document.querySelector('.cube-commanders .cube-gallery')).toBeNull();
  });

  it('empty state: a Commander cube whose pool had zero eligible legends says so, distinctly', () => {
    renderCube(cube({ format: 'commander', legends: [] }));
    expect(
      screen.getByText(/No legendary creatures in your collection were eligible/)
    ).toBeTruthy();
    expect(screen.getByText('No commanders in this cube.')).toBeTruthy();
  });

  it('short state: fewer legends than the size target shows the shortfall note, and renders a "short" gap when generateCube reported one', () => {
    // size 180 → LEGEND_TARGET 60; 10 legends is well short.
    const legends = Array.from({ length: 10 }, (_, i) => legend(i));
    const gapText =
      'Only 10 legendary creatures are eligible, 50 short of the 60-commander target. Own more legends to fill it out.';
    renderCube(
      cube({
        format: 'commander',
        size: 180,
        legends,
        gaps: [{ severity: 'short', text: gapText }],
      })
    );
    // The coverage panel's own note (derived straight from legends.length/target).
    expect(document.querySelector('.cube-commander-coverage-note')?.textContent).toMatch(
      /50 short of the 60-commander target/
    );
    // "Where your collection lands" renders whatever generateCube put in gaps —
    // see generate.test.ts for the real derivation of that gap's text.
    expect(screen.getByText(gapText)).toBeTruthy();
    expect(document.querySelector('.cube-gap-short')?.textContent).toBe(gapText);
  });

  it('the coverage grid flags a zero-count identity and never uses colour alone', () => {
    const legends = [legend(1, 'G'), legend(2, 'G')];
    renderCube(cube({ format: 'commander', legends }));
    const wCell = screen.getByText('W').closest('.cube-coverage-cell');
    expect(wCell?.className).toContain('is-low');
    expect(within(wCell as HTMLElement).getByText('0')).toBeTruthy();
    const gCell = screen.getAllByText('G')[0].closest('.cube-coverage-cell');
    expect(gCell?.className).not.toContain('is-low');
  });
});
