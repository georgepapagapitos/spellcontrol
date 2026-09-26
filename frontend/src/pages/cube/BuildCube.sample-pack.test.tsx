// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CubeResult } from './BuildCube';
import type { GeneratedCube, Pick } from '../../lib/cube/generate';
import { BUCKET_ORDER } from './shared';

function pick(i: number): Pick {
  return {
    card: {
      name: `Card ${i}`,
      oracleId: `oracle-${i}`,
      colors: ['U'],
      cmc: 2,
      typeLine: 'Creature',
      role: null,
    },
    bucket: 'U',
    reason: 'goodstuff',
  };
}

const ZERO_BUCKETS = Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0])) as Record<
  (typeof BUCKET_ORDER)[number],
  number
>;

const CUBE: GeneratedCube = {
  size: 180,
  format: 'limited',
  picks: Array.from({ length: 20 }, (_, i) => pick(i)),
  byBucket: ZERO_BUCKETS,
  targetByBucket: ZERO_BUCKETS,
  gaps: [],
  shortfall: 0,
  poolSize: 20,
};

const NOOP_STRING = () => 'unowned' as const;
const NOOP_ARR = () => [];

describe('CubeResult sample pack', () => {
  it('is closed by default and opens 15 tiles on demand', () => {
    render(
      <CubeResult
        cube={CUBE}
        onCopy={() => {}}
        onSave={() => {}}
        loaded={null}
        ownershipFor={NOOP_STRING}
        committedFor={NOOP_ARR}
        enrichedMap={new Map()}
      />
    );
    const toggle = screen.getByRole('button', { name: 'Sample pack' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.cube-sample-pack-body')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const body = document.querySelector('.cube-sample-pack-body') as HTMLElement;
    expect(body).not.toBeNull();
    expect(within(body).getAllByRole('button', { name: /^Card \d+/ })).toHaveLength(15);
  });

  it('deals a different pack on "Deal another pack"', () => {
    render(
      <CubeResult
        cube={CUBE}
        onCopy={() => {}}
        onSave={() => {}}
        loaded={null}
        ownershipFor={NOOP_STRING}
        committedFor={NOOP_ARR}
        enrichedMap={new Map()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sample pack' }));
    const namesOf = () =>
      Array.from(document.querySelectorAll('.cube-sample-pack-body .collection-grid-item')).map(
        (el) => el.getAttribute('aria-label')
      );
    const first = namesOf();
    fireEvent.click(screen.getByRole('button', { name: 'Deal another pack' }));
    const second = namesOf();
    expect(second).toHaveLength(15);
    expect(second).not.toEqual(first);
  });
});
