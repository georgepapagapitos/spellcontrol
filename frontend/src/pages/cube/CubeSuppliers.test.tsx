// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CubeResult } from './CubeResult';
import type { GeneratedCube, Pick } from '../../lib/cube/generate';
import { BUCKET_ORDER } from './shared';

function pick(name: string, oracleId: string): Pick {
  return {
    card: { name, oracleId, colors: ['U'], cmc: 2, typeLine: 'Creature', role: null },
    bucket: 'U',
    reason: 'goodstuff',
  };
}

const ZERO_BUCKETS = Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0])) as Record<
  (typeof BUCKET_ORDER)[number],
  number
>;

function cubeOf(picks: Pick[]): GeneratedCube {
  return {
    size: 180,
    format: 'limited',
    picks,
    byBucket: ZERO_BUCKETS,
    targetByBucket: ZERO_BUCKETS,
    gaps: [],
    shortfall: 0,
    poolSize: picks.length,
  };
}

const NOOP_STRING = () => 'unowned' as const;
const NOOP_ARR = () => [];

describe('CubeResult — Who brings what', () => {
  it('renders nothing when the cube has no friend contributions', () => {
    render(
      <CubeResult
        cube={cubeOf([pick('Sol Ring', 'sol-ring')])}
        onCopy={() => {}}
        onSave={() => {}}
        loaded={null}
        ownershipFor={NOOP_STRING}
        committedFor={NOOP_ARR}
        enrichedMap={new Map()}
      />
    );
    expect(screen.queryByText('Who brings what')).toBeNull();
  });

  it('shows a per-person supply breakdown and a pull list, ignoring stale supplier entries', () => {
    const cube = cubeOf([pick('Sol Ring', 'sol-ring'), pick('Lightning Bolt', 'lb-oracle')]);
    const supplierMap = new Map<string, string[]>([
      ['sol-ring', ['me']],
      ['lb-oracle', ['me', 'Alex']],
      // A pick that was banned/swapped out after this cube was built — no
      // longer in cube.picks. Must not surface as a phantom supplier row.
      ['stale-oracle', ['Sam']],
    ]);

    render(
      <CubeResult
        cube={cube}
        onCopy={() => {}}
        onSave={() => {}}
        loaded={null}
        ownershipFor={NOOP_STRING}
        committedFor={NOOP_ARR}
        enrichedMap={new Map()}
        supplierMap={supplierMap}
        myUsername="me"
      />
    );

    expect(screen.getByText('Who brings what')).toBeTruthy();
    expect(screen.queryByText('Sam')).toBeNull();

    const you = screen.getByText('You').closest('li') as HTMLElement;
    expect(within(you).getByText('2 cards')).toBeTruthy();

    const alex = screen.getByText('Alex').closest('li') as HTMLElement;
    expect(within(alex).getByText('1 card')).toBeTruthy();
    within(alex).getByText('Pull list').click();
    expect(within(alex).getByText('Lightning Bolt')).toBeTruthy();
  });
});
