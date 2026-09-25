// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CubeHealthPanel } from './CubeHealthPanel';
import type { GeneratedCube, Pick } from '../../lib/cube/generate';
import { BUCKET_ORDER } from './shared';

const ZERO_BUCKETS = Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0])) as Record<
  (typeof BUCKET_ORDER)[number],
  number
>;

function pick(i: number, overrides: Partial<Pick['card']> = {}): Pick {
  return {
    card: {
      name: `Card ${i}`,
      oracleId: `oracle-${i}`,
      colors: ['U'],
      cmc: 2,
      typeLine: 'Creature',
      role: null,
      ...overrides,
    },
    bucket: 'U',
    reason: 'goodstuff',
  };
}

function cubeOf(picks: Pick[], size: GeneratedCube['size'] = 360): GeneratedCube {
  return {
    size,
    format: 'limited',
    picks,
    byBucket: ZERO_BUCKETS,
    targetByBucket: ZERO_BUCKETS,
    gaps: [],
    shortfall: 0,
    poolSize: picks.length,
  };
}

describe('CubeHealthPanel', () => {
  it('renders every group heading and one row per curve/type/role slot plus fixing', () => {
    const picks = Array.from({ length: 300 }, (_, i) => pick(i));
    render(<CubeHealthPanel cube={cubeOf(picks)} />);

    expect(screen.getByRole('heading', { name: 'Cube health' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Mana curve' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Card types' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Roles' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Fixing' })).toBeTruthy();

    // 8 curve slots + 6 types + 4 roles + 1 fixing = 19 rows.
    expect(document.querySelectorAll('.cube-health-row')).toHaveLength(19);
    expect(screen.getByText('Removal')).toBeTruthy();
    expect(screen.getByText('Fixing lands')).toBeTruthy();
    expect(screen.getByText('7+ CMC')).toBeTruthy();
  });

  it('states the count and the corpus range in words for every row', () => {
    const picks = Array.from({ length: 100 }, (_, i) => pick(i));
    render(<CubeHealthPanel cube={cubeOf(picks)} />);
    // 100 creatures, 0 lands: the creature row reads its count and a real-360s range.
    const captions = Array.from(document.querySelectorAll('.cube-health-row-caption')).map(
      (el) => el.textContent
    );
    expect(captions.some((t) => t?.startsWith('100 · real 360s run '))).toBe(true);
  });

  it('flags an out-of-range row with an icon and "Off target" text, not color alone', () => {
    // No removal at all in a 300-card nonland-heavy pool: removal reads low.
    const picks = Array.from({ length: 300 }, (_, i) => pick(i));
    render(<CubeHealthPanel cube={cubeOf(picks)} />);
    const removalRow = screen.getByText('Removal').closest('.cube-health-row')!;
    expect(removalRow.classList.contains('is-low')).toBe(true);
    expect(removalRow.querySelector('.cube-health-row-flag')).not.toBeNull();
    expect(removalRow.textContent).toContain('Off target');
  });

  it('says "real cubes" (not "real 180s") for a size whose band is reused from 360', () => {
    const picks = Array.from({ length: 100 }, (_, i) => pick(i));
    render(<CubeHealthPanel cube={cubeOf(picks, 180)} />);
    expect(screen.getAllByText(/real cubes run/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/real 180s run/)).toBeNull();
  });

  it('renders for a saved cube with no format recorded', () => {
    const picks = Array.from({ length: 50 }, (_, i) => pick(i));
    const cube = cubeOf(picks);
    // Simulates a cube saved before `format` shipped (an optional field).
    delete cube.format;
    render(<CubeHealthPanel cube={cube} />);
    expect(screen.getByRole('heading', { name: 'Cube health' })).toBeTruthy();
  });
});
