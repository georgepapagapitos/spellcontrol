// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
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
        copyFor={() => null}
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
        copyFor={() => null}
        enrichedMap={new Map()}
        supplierMap={supplierMap}
        myUsername="me"
      />
    );

    expect(screen.getByText('Who brings what')).toBeTruthy();
    expect(screen.queryByText('Sam')).toBeNull();

    // Lightning Bolt is owned by both of us but is one copy to bring: it goes
    // on my list only. Alex keeps a row (they're a source) at zero.
    const you = screen.getByText('You').closest('li') as HTMLElement;
    expect(within(you).getByText('2 cards')).toBeTruthy();
    within(you).getByText('Pull list').click();
    expect(within(you).getByText('Lightning Bolt')).toBeTruthy();

    const alex = screen.getByText('Alex').closest('li') as HTMLElement;
    expect(within(alex).getByText('0 cards')).toBeTruthy();
    expect(within(alex).queryByText('Pull list')).toBeNull();
  });

  it('puts a card only friends own on exactly one friend list', () => {
    const cube = cubeOf([pick('Counterspell', 'cs'), pick('Brainstorm', 'bs')]);
    const supplierMap = new Map<string, string[]>([
      ['cs', ['Alex', 'Sam']],
      ['bs', ['Alex', 'Sam']],
    ]);

    render(
      <CubeResult
        cube={cube}
        onCopy={() => {}}
        onSave={() => {}}
        loaded={null}
        ownershipFor={NOOP_STRING}
        committedFor={NOOP_ARR}
        copyFor={() => null}
        enrichedMap={new Map()}
        supplierMap={supplierMap}
        myUsername="me"
      />
    );

    const panel = screen.getByText('Who brings what').closest('div') as HTMLElement;
    for (const name of ['Alex', 'Sam']) {
      const row = within(panel).getByText(name).closest('li') as HTMLElement;
      expect(within(row).getByText('1 card')).toBeTruthy();
    }
    // Each card appears once across every pull list.
    for (const card of ['Counterspell', 'Brainstorm']) {
      expect(within(panel).getAllByText(card)).toHaveLength(1);
    }
    // The card list's chip (list view) names the same friend the pull list does.
    act(() => screen.getByLabelText('List view (with reasons)').click());
    expect(screen.getByLabelText('Supplied by Alex')).toBeTruthy();
    expect(screen.getByLabelText('Supplied by Sam')).toBeTruthy();
  });
});
