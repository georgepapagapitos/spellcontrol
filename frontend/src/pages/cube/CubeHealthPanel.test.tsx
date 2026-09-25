// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

/** Open the disclosure and return its body element. */
function openBody(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: /Cube health/ }));
  const body = document.getElementById('cube-health-body');
  if (!body) throw new Error('cube-health-body did not render after opening');
  return body;
}

describe('CubeHealthPanel — disclosure', () => {
  it('is collapsed by default with one always-visible summary line, no full breakdown', () => {
    const picks = Array.from({ length: 300 }, (_, i) => pick(i));
    render(<CubeHealthPanel cube={cubeOf(picks)} />);

    const toggle = screen.getByRole('button', { name: /Cube health/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('cube-health-body')).toBeNull();

    // The compact summary is always there, collapsed or not.
    const summary = document.querySelector('.cube-health-summary');
    expect(summary).not.toBeNull();
    expect(summary!.textContent!.length).toBeGreaterThan(0);
  });

  it('opens the full breakdown on click, with the sample-pack disclosure contract', () => {
    const picks = Array.from({ length: 300 }, (_, i) => pick(i));
    render(<CubeHealthPanel cube={cubeOf(picks)} />);
    const toggle = screen.getByRole('button', { name: /Cube health/ });

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('cube-health-body');
    const body = document.getElementById('cube-health-body');
    expect(body).not.toBeNull();

    expect(screen.getByRole('heading', { name: 'Mana curve' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Card types' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Roles' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Fixing' })).toBeTruthy();
  });

  it('names off-target measures in the summary line, curve slots as "N-drops"', () => {
    // 300 2-CMC creatures, no lands, no roles: every other curve slot, most
    // types and every role read off target.
    const picks = Array.from({ length: 300 }, (_, i) => pick(i));
    render(<CubeHealthPanel cube={cubeOf(picks)} />);
    const summary = document.querySelector('.cube-health-summary')!.textContent!;
    expect(summary.startsWith('Off target:')).toBe(true);
    expect(summary).toContain('1-drops');
    expect(summary).not.toContain('1 CMC');
    expect(summary).toContain('removal');
  });
});

describe('CubeHealthPanel — mana curve chart', () => {
  it('renders the curve as 8 histogram columns, not rows', () => {
    const picks = Array.from({ length: 300 }, (_, i) => pick(i));
    render(<CubeHealthPanel cube={cubeOf(picks)} />);
    const body = openBody();
    expect(body.querySelectorAll('.deck-curve-phases-bar-col')).toHaveLength(8);
    // Curve is no longer part of the row list (11 = 6 types + 4 roles + 1 fixing).
    expect(body.querySelectorAll('.cube-health-row')).toHaveLength(11);
  });

  it('draws a range band and a median dash on every column', () => {
    const picks = Array.from({ length: 300 }, (_, i) => pick(i));
    render(<CubeHealthPanel cube={cubeOf(picks)} />);
    const body = openBody();
    expect(body.querySelectorAll('.deck-curve-phases-bar-band')).toHaveLength(8);
    expect(body.querySelectorAll('.deck-curve-phases-bar-target')).toHaveLength(8);
  });

  it('flags an off-target column with an icon and screen-reader text, not color alone', () => {
    // Every card at 2 CMC: the 1-CMC column (key '1') is off target (0 cards).
    const picks = Array.from({ length: 300 }, (_, i) => pick(i));
    render(<CubeHealthPanel cube={cubeOf(picks)} />);
    const body = openBody();
    const cols = Array.from(body.querySelectorAll('.deck-curve-phases-bar-col'));
    const oneDrop = cols[1]; // slots render in order 0..7+
    expect(oneDrop.querySelector('.cube-health-curve-flag')).not.toBeNull();
    expect(oneDrop.textContent).toContain('off target');
  });
});

describe('CubeHealthPanel — rows', () => {
  it('states the count and a "typical lo–hi" range, not "real Ns run"', () => {
    const picks = Array.from({ length: 100 }, (_, i) => pick(i));
    render(<CubeHealthPanel cube={cubeOf(picks)} />);
    const body = openBody();
    const captions = Array.from(body.querySelectorAll('.cube-health-row-caption')).map(
      (el) => el.textContent
    );
    expect(captions.some((t) => t?.startsWith('100 · typical '))).toBe(true);
    expect(captions.some((t) => t?.includes('real'))).toBe(false);
  });

  it('flags an out-of-range row with an icon and "Off target" text, not color alone', () => {
    const picks = Array.from({ length: 300 }, (_, i) => pick(i));
    render(<CubeHealthPanel cube={cubeOf(picks)} />);
    const body = openBody();
    const removalRow = Array.from(body.querySelectorAll('.cube-health-row')).find((el) =>
      el.textContent?.includes('Removal')
    )!;
    expect(removalRow.classList.contains('is-low')).toBe(true);
    expect(removalRow.querySelector('.cube-health-row-flag')).not.toBeNull();
    expect(removalRow.textContent).toContain('Off target');
  });

  it('the sub line says "real cubes" (not "real 180s") for a size whose band is reused from 360', () => {
    const picks = Array.from({ length: 100 }, (_, i) => pick(i));
    render(<CubeHealthPanel cube={cubeOf(picks, 180)} />);
    const body = openBody();
    expect(body.querySelector('.cube-health-sub')!.textContent).toContain('real cubes');
    expect(body.querySelector('.cube-health-sub')!.textContent).not.toContain('real 180s');
  });
});

describe('CubeHealthPanel — saved cube compatibility', () => {
  it('renders for a saved cube with no format recorded', () => {
    const picks = Array.from({ length: 50 }, (_, i) => pick(i));
    const cube = cubeOf(picks);
    // Simulates a cube saved before `format` shipped (an optional field).
    delete cube.format;
    render(<CubeHealthPanel cube={cube} />);
    expect(screen.getByRole('button', { name: /Cube health/ })).toBeTruthy();
  });
});
